#!/usr/bin/env python3
"""
O PACOTE DE MOTOR DE PONTA A PONTA — do clique real até o LLM que respondeu.

As outras provas param antes da tela: `operacao-de-motor.test.ts` mede a régua
sem React, `operacao-unica.test.cjs` monta o componente com a rede fingida.
Nenhuma responde "trocar o motor, o modelo e o esforço na tela custa quantas
reiniciadas, e o agente volta falando com o LLM certo?" — que é a pergunta do
Rica (10/09), e a que eu já errei duas vezes respondendo por leitura de código.

Aqui o clique é de mouse, o cockpit é o publicado, o agente é real, a contagem
de boots sai do journal do systemd e o modelo que respondeu sai do JSONL da
sessão — que registra o que a API devolveu, não o que a tela diz.

⚠️ ISTO TROCA O MOTOR DE UM AGENTE DE VERDADE, duas vezes: leva ao destino e
devolve ao estado em que estava. O slug é obrigatório, sem default.

    python3 scripts/prova/agrupamento-ponta-a-ponta.py tara
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path.home() / '.local/lib/python3.12/site-packages'))
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = 'http://127.0.0.1:3008'
# Claude nativo é o destino de ida: ele não depende de proxy nenhum de pé, e
# trocar para ele é o que esvazia o modelo e o esforço no painel (a sessão viva
# está num motor de outra família) — o caso exato que o Rica gravou na tela.
DESTINO = ('anthropic', 'Claude')


def painel(slug):
    with urllib.request.urlopen(f'{BASE}/api/agents/{slug}/painel', timeout=20) as r:
        return json.load(r)


def agora():
    return subprocess.run(['date', '+%Y-%m-%d %H:%M:%S'], capture_output=True, text=True).stdout.strip()


def boots_desde(slug, marco):
    saida = subprocess.run(
        ['journalctl', '--user', '-u', f'cockpit-ligar-{slug}.service', '--since', marco, '--no-pager'],
        capture_output=True, text=True).stdout
    return sum(1 for l in saida.splitlines() if f'Started cockpit-ligar-{slug}' in l)


def motor_do_processo(slug):
    """O que o processo vivo carrega — a única fonte que não mente sobre modelo
    e esforço (a statusline de agente com motor trocado mente)."""
    for pid in (p.name for p in Path('/proc').iterdir() if p.name.isdigit()):
        try:
            if f'/{slug}' not in Path(f'/proc/{pid}/cwd').resolve().as_posix():
                continue
            if 'bin/claude' not in Path(f'/proc/{pid}/cmdline').read_text():
                continue
            env = dict(
                l.split('=', 1) for l in Path(f'/proc/{pid}/environ').read_text().split('\0')
                if '=' in l)
            return {'pid': pid, 'modelo': env.get('ANTHROPIC_MODEL'),
                    'esforco': env.get('CLAUDE_CODE_EFFORT_LEVEL')}
        except (OSError, ValueError):
            continue
    return None


def modelo_que_respondeu(slug, desde):
    """O modelo que a API devolveu no último turno do agente, lido do JSONL da
    sessão. `<synthetic>` é mensagem que o CC fabrica sem chamar LLM — não
    prova nada, e é justamente o que apareceria se o agente só ecoasse."""
    raiz = Path.home() / '.claude/projects' / f'-home-clawd-repos-ze-claude-{slug}'
    achado = None
    for arquivo in raiz.glob('*.jsonl'):
        if arquivo.stat().st_mtime < desde:
            continue
        for linha in arquivo.read_text(errors='ignore').splitlines():
            try:
                reg = json.loads(linha)
            except ValueError:
                continue
            modelo = (reg.get('message') or {}).get('model')
            if modelo and modelo != '<synthetic>':
                achado = modelo
    return achado


def menu_aberto(pg):
    pg.wait_for_selector('[role="menu"] [role="menuitem"]', timeout=10_000)
    pg.wait_for_timeout(250)


def opcoes(pg):
    """Os itens escolhíveis do menu na tela — sem o '‹ voltar' do topo."""
    return [i for i in pg.query_selector_all('[role="menu"] [role="menuitem"]')
            if '‹' not in (i.inner_text() or '')]


def escolher(pg, rotulo):
    for item in opcoes(pg):
        if rotulo in (item.inner_text() or ''):
            item.click()
            pg.wait_for_timeout(400)
            return True
    return False


def primeira_diferente(pg):
    """A primeira opção que não é a que já está valendo (o ✓ marca a atual)."""
    for item in opcoes(pg):
        texto = item.inner_text() or ''
        if '✓' not in texto:
            item.click()
            pg.wait_for_timeout(400)
            return texto.strip()
    return None


def trocar_motor(pg, slug, rotulo):
    pg.click(f'a[aria-label^="Abrir detalhes de"]')
    pg.wait_for_selector('section[aria-label="Motor da família"]', timeout=10_000)
    pg.click('section[aria-label="Motor da família"] button[aria-haspopup="menu"]')
    menu_aberto(pg)
    assert escolher(pg, rotulo), f'não achei a família {rotulo} no menu'
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(1_500)


def abrir_gaveta_do_composer(pg):
    pg.keyboard.press('Escape')
    pg.wait_for_selector('button[aria-label^="Configurar"]', timeout=15_000)
    pg.click('button[aria-label^="Configurar"]')
    menu_aberto(pg)


def escolher_campo(pg, campo):
    """Entra na tela do campo e pega a primeira opção diferente da atual."""
    assert escolher(pg, campo), f'a gaveta não ofereceu {campo}'
    menu_aberto(pg)
    valor = primeira_diferente(pg)
    assert valor, f'{campo} não tinha segunda opção para escolher'
    return valor


def aviso_da_tela(pg):
    textos = [e.inner_text() for e in pg.query_selector_all('[role="status"], [role="alert"]')]
    return ' | '.join(t.strip() for t in textos if t and t.strip())


def esperar_boot(slug, marco, segundos=40):
    for _ in range(segundos):
        if boots_desde(slug, marco) >= 1:
            time.sleep(14)  # a sessão nova leva ~14s depois da unit subir
            return True
        time.sleep(1)
    return False


def falar_com_o_agente(pg, slug, nome):
    desde = time.time()
    pg.wait_for_selector(f'textarea[aria-label^="Mensagem para"]', timeout=20_000)
    pg.fill('textarea[aria-label^="Mensagem para"]',
            'Teste automático do cockpit: responda só OK, sem usar ferramenta.')
    pg.click('button[aria-label^="Enviar para"]')
    for _ in range(90):
        time.sleep(2)
        modelo = modelo_que_respondeu(slug, desde)
        if modelo:
            return modelo
    return None


def ciclo(pg, slug, familia, rotulo, etapa):
    """Leva o motor até `familia` pela tela e devolve o que foi escolhido."""
    print(f'\n=== {etapa}: motor → {rotulo} ===')
    marco = agora()
    time.sleep(1)

    trocar_motor(pg, slug, rotulo)
    assert boots_desde(slug, marco) == 0, 'religou na troca de motor — o pacote nem começou'
    print(f'✓ motor gravado sem religar — tela diz: {aviso_da_tela(pg)!r}')

    abrir_gaveta_do_composer(pg)
    modelo = escolher_campo(pg, 'Modelo')
    bootou = boots_desde(slug, marco)
    print(f'• modelo escolhido: {modelo} (boots até aqui: {bootou})')

    esforco = None
    if bootou == 0:
        # Faltava mais de um campo: o esforço é o que fecha o pacote.
        abrir_gaveta_do_composer(pg)
        esforco = escolher_campo(pg, 'Esforço')
        print(f'• esforço escolhido: {esforco}')

    assert esperar_boot(slug, marco), 'o pacote fechou e ninguém religou'
    boots = boots_desde(slug, marco)
    assert boots == 1, f'{boots} reiniciadas para um pacote — era uma'
    print(f'✓ UMA reiniciada para motor + modelo{" + esforço" if esforco else ""}')

    processo = motor_do_processo(slug)
    assert processo, 'o agente não voltou depois do religar'
    print(f'✓ processo novo: pid {processo["pid"]}, {processo["modelo"]} + {processo["esforco"]}')
    return {'modelo': modelo, 'esforco': esforco, 'processo': processo}


def main():
    if len(sys.argv) < 2:
        print('uso: agrupamento-ponta-a-ponta.py <slug>  (o agente É religado)', file=sys.stderr)
        return 2
    slug = sys.argv[1]

    antes = painel(slug)
    origem = antes['motor']['familia']
    assert antes['vida'].get('processo'), f'{slug} não está de pé — a prova precisa dele vivo'
    assert origem != DESTINO[0], f'{slug} já está em {DESTINO[1]} — escolha outro agente'
    print(f'• {slug} em {origem}, modelo {antes["model"]["value"]}, esforço {antes["effort"]["value"]}')

    volta = {'anthropic': 'Claude', 'codex-proxy': 'Codex', 'kimi': 'Kimi'}[origem]
    with sync_playwright() as p:
        navegador = p.chromium.launch()
        pg = navegador.new_page(viewport={'width': 1280, 'height': 900})
        pg.goto(f'{BASE}/agente/{slug}', wait_until='networkidle')
        print(f'✓ cockpit aberto — dpl {pg.get_attribute("html", "data-dpl-id")}')

        ida = ciclo(pg, slug, *DESTINO, 'IDA')
        respondeu = falar_com_o_agente(pg, slug, slug)
        assert respondeu, 'o agente não respondeu nada depois do religar'
        print(f'✓ o agente respondeu pelo LLM {respondeu}')
        assert not respondeu.startswith('gpt'), (
            f'voltou em {DESTINO[1]} mas respondeu com {respondeu} — o motor não pegou')

        # A volta é prova do outro sentido, e devolve o agente ao que era.
        ciclo(pg, slug, origem, volta, 'VOLTA')
        de_novo = falar_com_o_agente(pg, slug, slug)
        assert de_novo, 'o agente não respondeu depois de voltar'
        print(f'✓ de volta, respondeu pelo LLM {de_novo}')
        navegador.close()

    depois = painel(slug)
    assert depois['motor']['familia'] == origem, 'o agente não voltou para o motor de origem'
    print(f'\nTUDO CERTO — clique real, uma reiniciada por pacote, '
          f'e o agente falando pelo LLM de cada motor.')
    print(f'• {slug} voltou para {origem}: {depois["model"]["value"]} + {depois["effort"]["value"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
