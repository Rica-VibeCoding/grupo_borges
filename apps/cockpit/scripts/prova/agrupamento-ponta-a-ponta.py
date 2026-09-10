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
from playwright.sync_api import Error as ErroDeTela, sync_playwright  # noqa: E402

BASE = 'http://127.0.0.1:3008'
# Claude nativo é o destino de ida: ele não depende de proxy nenhum de pé, e
# trocar para ele é o que esvazia o modelo e o esforço no painel (a sessão viva
# está num motor de outra família) — o caso exato que o Rica gravou na tela.
# Kimi é o destino de ida porque é nele que o painel consegue REFLETIR a escolha:
# o modelo persiste em `state_model` e volta no painel. Em Claude nativo a Tara
# fica num estado que o back não consegue descrever — a sessão viva é Codex (ver
# `BOOT_IGNORA_FAMILIA`), e com modelo incompatível `_build_claude_painel_effort`
# devolve branco para sempre, então nenhuma escolha de esforço fecha o pacote.
DESTINO = ('kimi', 'Kimi')
ROTULO_DA_FAMILIA = {'anthropic': 'Anthropic', 'codex-proxy': 'Codex',
                     'kimi': 'Kimi', 'opencode': 'OpenCode'}

# Agentes cujo boot NÃO lê a família escolhida no cockpit — a gaveta Motor grava,
# e o religar sobe no motor de sempre. Na Tara é `subir_tara()` (`subir-frota.sh`):
# ele fixa `ANTHROPIC_BASE_URL` no proxy e valida o modelo contra o rail `gpt-*`,
# caindo em `gpt-5.6-sol[1m]` quando a escolha é de outra família. Medido em
# 10/09 pelo journal: boot 01:32:37 com a família gravada como `anthropic` e o
# processo subindo Codex. O pacote e o esforço, esses o boot respeita — é o que
# esta prova mede aqui.
BOOT_IGNORA_FAMILIA = {'tara': 'subir_tara() fixa o proxy Codex e o rail gpt-*'}


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


ABERTO = '[role="menu"][data-state="open"]'


def menu_aberto(pg):
    pg.wait_for_selector(f'{ABERTO} [role="menuitem"]', timeout=10_000)
    pg.wait_for_timeout(250)


def opcoes(pg):
    """Os itens escolhíveis do menu que está na tela — sem o '‹ voltar' do topo.

    O `data-state="open"` não é detalhe: o DOM guarda os menus fechados montados,
    e sem ele a lista lida é a de outro controle, com itens invisíveis.
    """
    return [i for i in pg.query_selector_all(f'{ABERTO} [role="menuitem"]')
            if '‹' not in (i.inner_text() or '')]


def escolher(pg, rotulo):
    for item in opcoes(pg):
        if rotulo in (item.inner_text() or ''):
            item.click()
            pg.wait_for_timeout(400)
            return True
    return False


def esperar_ponteiro_livre(pg, tentativas=40):
    """Menu aberto do Radix põe `pointer-events: none` no `body` — e com ele todo
    clique FORA do menu vai para o `<html>`, que o Playwright relata como
    "intercepts pointer events" sem dizer a causa. Um Escape solta."""
    for n in range(tentativas):
        if pg.evaluate("() => getComputedStyle(document.body).pointerEvents !== 'none'"
                       " && !document.querySelector('[role=menu][data-state=open]')"):
            return True
        if n % 4 == 0:
            pg.keyboard.press('Escape')
        pg.wait_for_timeout(250)
    return False


def clicar_no_topo(pg, seletor):
    """Clica no elemento do seletor que está REALMENTE na frente.

    O fechar da gaveta existe três vezes com o mesmo rótulo: o X do topo, o X do
    cabeçalho (que fica atrás dele) e o fundo de 1280x900 que fecha ao toque. O
    primeiro do DOM é um coberto — clicar nele espera 30s e falha sem dizer por
    quê. `elementFromPoint` responde quem ganha o toque naquele ponto.
    """
    for el in pg.query_selector_all(seletor):
        caixa = el.bounding_box()
        if not caixa or not el.is_visible() or caixa['width'] > 400:
            continue
        centro = [caixa['x'] + caixa['width'] / 2, caixa['y'] + caixa['height'] / 2]
        if el.evaluate('(e, [x, y]) => { const t = document.elementFromPoint(x, y);'
                       ' return !!t && (e === t || e.contains(t)); }', centro):
            el.click()
            return True
    return False


def trocar_motor(pg, rotulo):
    assert esperar_ponteiro_livre(pg), 'a tela ficou presa com um menu aberto'
    if not pg.query_selector('section[aria-label="Motor da família"]'):
        pg.click('a[aria-label^="Abrir detalhes de"]')
    pg.wait_for_selector('section[aria-label="Motor da família"]', timeout=10_000)
    pg.click('section[aria-label="Motor da família"] button[aria-haspopup="menu"]')
    menu_aberto(pg)
    assert escolher(pg, rotulo), f'não achei o motor {rotulo} no menu'
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(1_500)


def abrir_gaveta_do_composer(pg, tentativas=4):
    assert esperar_ponteiro_livre(pg), 'a tela ficou presa com um menu aberto'
    # A gaveta de detalhes cobre o composer — e é o caminho dele também: trocar o
    # motor ali e sair para escolher o modelo. Era exatamente aqui que o gatilho
    # antigo religava o agente, ao fechar uma gaveta no meio da escolha.
    if clicar_no_topo(pg, 'a[aria-label^="Fechar detalhes"]'):
        pg.wait_for_timeout(800)
    pg.wait_for_selector('button[aria-label^="Configurar"]', timeout=15_000)
    # O toque pode cair na animação de fechamento do menu anterior e não abrir
    # nada — a gaveta tem `ck-menu-fechado` em curso e o Radix engole o clique.
    for _ in range(tentativas):
        pg.click('button[aria-label^="Configurar"]')
        try:
            menu_aberto(pg)
            return
        except ErroDeTela:
            pg.wait_for_timeout(1_000)
    raise AssertionError('a gaveta do composer não abriu')


def menus_abertos(pg):
    return pg.query_selector_all(f'{ABERTO}')


def itens(menu):
    return [i for i in menu.query_selector_all('[role="menuitem"]')
            if '‹' not in (i.inner_text() or '')]


def item_focado(pg):
    """O texto do ITEM em foco — vazio se o foco está no menu e não num item.

    A distinção custou uma rodada: ao abrir, o foco fica no `[role=menu]`, cujo
    `innerText` contém todos os rótulos. Procurar o campo ali dá sempre positivo,
    e a seta nunca desce.
    """
    return ' '.join((pg.evaluate('''() => {
        const alvo = document.activeElement;
        const papel = alvo && alvo.getAttribute && alvo.getAttribute('role');
        return (papel === 'menuitem' || papel === 'menuitemradio') ? alvo.innerText : '';
    }''') or '').split())


def focar_item(pg, contendo, passos=10):
    """Desce pelo menu com a seta até o item pedido ficar em foco."""
    for _ in range(passos):
        if contendo in item_focado(pg):
            return True
        pg.keyboard.press('ArrowDown')
        pg.wait_for_timeout(250)
    return contendo in item_focado(pg)


def escolher_campo(pg, campo):
    """Abre a gaveta e escolhe, pelo TECLADO, o primeiro valor diferente do atual.

    Por teclado e não por ponteiro: o submenu do Radix (`DropdownMenuSubTrigger`)
    abre no hover e fecha quando o ponteiro sai do par trigger/conteúdo, e depois
    de uma interação por teclado — qualquer Escape antes — ele para de abrir no
    hover. Seta e Enter são o caminho que o Radix garante, e é um caminho real de
    quem usa a tela.

    Abre de novo para cada campo de propósito: fechar a gaveta não religa mais
    nada, e é justamente isso que custou as duas versões anteriores.
    """
    for tentativa in range(3):
        assert esperar_ponteiro_livre(pg), 'a tela ficou presa com um menu aberto'
        abrir_gaveta_do_composer(pg)
        if any('›' in (i.inner_text() or '') for i in opcoes(pg)):
            break
        pg.wait_for_timeout(1_000)
    else:
        raise AssertionError('a gaveta do composer abriu sem os campos de motor')

    assert focar_item(pg, campo), f'a gaveta não ofereceu {campo}'
    pg.keyboard.press('ArrowRight')
    pg.wait_for_timeout(700)

    opcoes_do_campo = [' '.join((i.inner_text() or '').split()) for i in opcoes(pg)
                       if '›' not in (i.inner_text() or '')]
    assert opcoes_do_campo, f'a lista de {campo} não abriu — na gaveta havia ' \
        f'{[" ".join((i.inner_text() or "").split()) for i in opcoes(pg)]}'
    alvo = next((o for o in opcoes_do_campo if '✓' not in o), None)
    assert alvo, f'{campo} só oferece o valor que já está valendo'

    assert focar_item(pg, alvo, passos=len(opcoes_do_campo) + 2), \
        f'não consegui chegar em {alvo}'
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(1_500)
    return alvo


def aviso_da_tela(pg):
    textos = [e.inner_text() for e in pg.query_selector_all('[role="status"], [role="alert"]')]
    vistos = []
    for t in textos:
        t = (t or '').strip()
        if t and t not in vistos:
            vistos.append(t)
    return ' | '.join(vistos)


def esperar_boot(slug, marco, segundos=40):
    for _ in range(segundos):
        if boots_desde(slug, marco) >= 1:
            time.sleep(15)  # a sessão nova leva ~14s depois de a unit subir
            return True
        time.sleep(1)
    return False


def esperar_sem_veu(pg, tentativas=60):
    """A trava de tela cobre o viewport enquanto o agente religa — é o `VeuDeOperacao`,
    e ele engole o clique no Enviar. Ela sai quando o painel prova que o agente
    voltou."""
    for _ in range(tentativas):
        if not pg.query_selector('[role="alertdialog"]'):
            return True
        pg.wait_for_timeout(500)
    return False


def falar_com_o_agente(pg, slug):
    desde = time.time()
    assert esperar_sem_veu(pg), 'a trava de tela não saiu depois do religar'
    assert esperar_ponteiro_livre(pg), 'a tela ficou presa com um menu aberto'
    # A gaveta de detalhes cobre o composer inteiro — o Enviar fica atrás dela.
    if clicar_no_topo(pg, 'a[aria-label^="Fechar detalhes"]'):
        pg.wait_for_timeout(800)
    pg.wait_for_selector('textarea[aria-label^="Mensagem para"]', timeout=20_000)
    pg.fill('textarea[aria-label^="Mensagem para"]',
            'Teste automático do cockpit: responda só OK, sem usar ferramenta.')
    pg.click('button[aria-label^="Enviar para"]')
    for _ in range(90):
        time.sleep(2)
        modelo = modelo_que_respondeu(slug, desde)
        if modelo:
            return modelo
    return None


CAMPO_NA_TELA = {'o modelo': 'Modelo', 'o esforço': 'Esforço'}


def campos_em_branco(p):
    """A mesma régua de `faltaEscolher()` no cockpit, lida do back. É ela que diz
    se este ciclo exercita o agrupamento (campo em branco) ou o caso de religar
    no toque (pacote já fechado) — assumir um dos dois é como eu errei antes."""
    falta = []
    if (p.get('model') or {}).get('allowed') and not p['model'].get('value'):
        falta.append('o modelo')
    if (p.get('effort') or {}).get('allowed') and not p['effort'].get('value'):
        falta.append('o esforço')
    return falta


def pane_do_agente(slug):
    """O pane tmux do agente — socket por agente, nunca o `default` (sem `-L` o
    tmux obedece ao `$TMUX` de quem chama e mostra outra sessão)."""
    try:
        return subprocess.run(['tmux', '-L', f'borges-{slug}', 'capture-pane', '-p', '-t', slug],
                              capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return ''


def conferir_llm(pg, slug, processo):
    """Manda uma mensagem e confere que o LLM que respondeu é o do processo novo.

    É a pergunta do Rica (10/09): "garanta que o modelo responda alguma coisa no
    LLM correto". O JSONL da sessão guarda o `model` que a API devolveu em cada
    turno — o agente falando sobre si mesmo não serve de prova, e `<synthetic>` é
    mensagem que o CC fabrica sem chamar LLM nenhum.
    """
    respondeu = falar_com_o_agente(pg, slug)
    if not respondeu:
        # Distinguir "o cockpit não entregou" de "o provedor está fora" — sem isso
        # uma queda do upstream parece defeito da troca de motor.
        pane = pane_do_agente(slug)
        entregou = 'Teste automático do cockpit' in pane
        provedor = 'API error' in pane or 'Retrying' in pane
        raise AssertionError(
            f'o agente não respondeu. A mensagem {"CHEGOU" if entregou else "não chegou"} ao pane'
            + (' e o provedor está recusando (API error no pane) — isto é upstream,'
               ' não o cockpit.' if provedor else '.'))
    esperado = (processo['modelo'] or '').removesuffix('[1m]')
    assert esperado and esperado in respondeu, (
        f'o processo subiu com {processo["modelo"]} e a resposta veio de {respondeu}')
    print(f'✓ o agente respondeu, e o LLM foi {respondeu} — o mesmo do processo')


def esperar_familia(slug, familia, tentativas=20):
    """A gravação tem de estar no back antes de medir qualquer coisa. Sem esta
    espera, um toque que não pegou viraria leitura do painel ANTIGO — com tudo
    preenchido — e a prova concluiria 'nada em branco' sobre o motor errado."""
    for _ in range(tentativas):
        if painel(slug)['motor']['familia'] == familia:
            return True
        time.sleep(0.5)
    return False


def ciclo(pg, slug, familia, rotulo, etapa):
    """Leva o motor até `rotulo` pela tela e confere o custo em reiniciadas."""
    print(f'\n=== {etapa}: motor → {rotulo} ===')
    marco = agora()
    time.sleep(1)

    trocar_motor(pg, rotulo)
    assert esperar_familia(slug, familia), f'o toque em {rotulo} não gravou o motor'
    falta = campos_em_branco(painel(slug))
    print(f'• depois da troca, o back diz que falta: {falta or "nada"}')
    print(f'  tela: {aviso_da_tela(pg)!r}')

    escolhidos = []
    if falta:
        assert boots_desde(slug, marco) == 0, 'religou com campo em branco — a escolha nem acabou'
        print('✓ motor gravado sem religar')
        for n, campo in enumerate(falta):
            escolhidos.append(escolher_campo(pg, CAMPO_NA_TELA[campo]))
            if falta[n + 1:]:
                assert boots_desde(slug, marco) == 0, (
                    f'religou faltando {falta[n + 1:]} — é a reiniciada a mais que ele viu')
                print(f'• {campo} escolhido: {escolhidos[-1]} — sem religar, ainda falta {falta[n + 1:]}'
                      f' | tela: {aviso_da_tela(pg)!r}')
            else:
                print(f'• {campo} escolhido: {escolhidos[-1]} — pacote fechado'
                      f' | tela: {aviso_da_tela(pg)!r}')
    else:
        # Pacote já completo: a régua dele é religar no toque, "imediatamente".
        print('✓ nada em branco — este ciclo prova o religar imediato')

    assert esperar_boot(slug, marco), 'o pacote fechou e ninguém religou'
    boots = boots_desde(slug, marco)
    assert boots == 1, f'{boots} reiniciadas para um pacote — era uma'
    print(f'✓ UMA reiniciada para motor{"".join(" + " + c for c in falta)}')

    processo = motor_do_processo(slug)
    assert processo, 'o agente não voltou depois do religar'
    print(f'✓ processo novo: pid {processo["pid"]}, {processo["modelo"]} + {processo["esforco"]}')
    return processo


def main():
    if len(sys.argv) < 2:
        print('uso: agrupamento-ponta-a-ponta.py <slug>  (o agente É religado)', file=sys.stderr)
        return 2
    slug = sys.argv[1]

    antes = painel(slug)
    origem = antes['motor']['familia']
    assert antes['vida'].get('processo'), f'{slug} não está de pé — a prova precisa dele vivo'
    assert origem != DESTINO[0], f'{slug} já está em {DESTINO[1]} — devolva o motor antes'
    print(f'• {slug} em {origem}, modelo {antes["model"]["value"]}, esforço {antes["effort"]["value"]}')
    volta = ROTULO_DA_FAMILIA[origem]

    with sync_playwright() as p:
        navegador = p.chromium.launch()
        pg = navegador.new_page(viewport={'width': 1280, 'height': 900})
        servido = urllib.request.urlopen(f'{BASE}/', timeout=20).read().decode(errors='ignore')
        # O `data-dpl-id` vive no HTML servido e o React o descarta na hidratação:
        # lido do DOM ele volta `None` e a prova juraria que nada foi publicado.
        dpl = servido.split('data-dpl-id="')[1].split('"')[0] if 'data-dpl-id="' in servido else '?'
        pg.goto(f'{BASE}/agente/{slug}', wait_until='networkidle')
        print(f'✓ cockpit aberto — dpl {dpl}')

        processo = ciclo(pg, slug, DESTINO[0], DESTINO[1], 'IDA')
        conferir_llm(pg, slug, processo)
        if slug in BOOT_IGNORA_FAMILIA:
            print(f'⚠ {slug}: a família escolhida não chega ao boot — {BOOT_IGNORA_FAMILIA[slug]}')

        # A volta prova o outro sentido e devolve o agente ao que era.
        processo = ciclo(pg, slug, origem, volta, 'VOLTA')
        conferir_llm(pg, slug, processo)
        navegador.close()

    depois = painel(slug)
    assert depois['motor']['familia'] == origem, 'o agente não voltou para o motor de origem'
    print('\nTUDO CERTO — clique real, uma reiniciada por pacote, '
          'e o agente falando pelo LLM de cada motor.')
    print(f'• {slug} voltou para {origem}: {depois["model"]["value"]} + {depois["effort"]["value"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
