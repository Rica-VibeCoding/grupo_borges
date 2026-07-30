"""OS TRÊS BRAÇOS NA MESMA SESSÃO — biblioteca, esqueleto e feed real.

POR QUE ESTE SCRIPT EXISTE. O `RESULTADO-feed-real.md` cravou a régua: "rode o
controle na mesma sessão, não compare com número de outro dia" — porque o mesmo
esqueleto mediu 33,4 ms na rodada da manhã e 49,9 ms na da tarde, com o código
idêntico. O piso da máquina subiu ~1,5×.

Só que a decisão de MATAR a assistant-ui está apoiada nos 400 / 400 / 724,9 ms
dela, medidos ANTES de o piso subir e nunca remedidos. A régua condena a própria
conclusão que a criou. Este script fecha esse furo: os TRÊS braços, mesma carga,
mesma janela, mesma sessão do navegador, mesma hora.

O QUE MUDA EM RELAÇÃO A RODAR OS TRÊS SCRIPTS ENCADEADOS. Encadear (braço A
inteiro, depois B, depois C) reintroduz exatamente o viés que a rotação de
níveis matou lá dentro: a bancada degrada ao longo de rodadas consecutivas
(frames caíram de 217 para 91 e a mediana subiu de 16,7 para 266,7 dentro de uma
mesma série), então o último braço leva a degradação inteira na conta dele — e a
comparação ENTRE BRAÇOS é justamente o que este script existe para produzir.

Por isso a sequência intercala: os três braços do MESMO nível ficam adjacentes.
Assim eles pegam praticamente o mesmo estado de máquina, e a rotação distribui
quem entra primeiro do trio. Nunca em paralelo — cada rodada chama
`gerar-carga.py --reset` no mesmo SQLite e uma destruiria a fase da outra.

O RESTO DO MÉTODO é o de `escala_g1.py`, sem alteração: janela fixa de 25 s a
50 Hz, `?historico=N&recentes=1` como única variável, iPhone 393×695 @3x, e a
prova no fim de que os níveis abriram com contagens diferentes (se empatarem, o
instrumento quebrou e o p95 não vale nada — foi assim que duas rodadas morreram).

UMA CORREÇÃO DE INSTRUMENTO. Os scripts anteriores abortavam o processo inteiro
quando a ingestão não estabilizava ("banco não estabilizou em 1000: 1001
eventos" — um evento a mais entrou durante a espera). Perdi 8 rodadas boas por
causa da nona. Aqui a rodada que falha é DESCARTADA e a série continua; o total
de descartes sai no resumo, porque amostra menor sem aviso é amostra falsa.
"""
import re
import sqlite3
import statistics
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

RAIZ = 'http://127.0.0.1:3008'
DIR = '/home/clawd/repos/grupo_borges/fixtures/cockpit-v2'
BANCO = '/home/clawd/repos/grupo_borges/apps/api/db/grupo_borges.db'
CARGA_ESPERADA = 1000  # 500 da fase histórico + 500 da fase preenchimento

# Os três braços da comparação, na ordem em que a história aconteceu.
BRACOS = (
    ('lib', '/spike'),           # com assistant-ui — o que o gate condenou
    ('sem-lib', '/spike/sem-lib'),  # esqueleto: virtualizador + DOM feio
    ('feed', '/spike/feed'),        # components/feed/** com renderers de verdade
)
# 10× de distância entre o menor e o maior, e todos dentro do teto de replay de
# 500 do backend em produção. NÃO suba um segundo uvicorn no mesmo SQLite para
# escapar do teto: cada processo traz o próprio watcher de JSONL e o mesmo
# arquivo entra duas vezes (aconteceu: 1000 linhas, 500 uuids distintos).
NIVEIS = (50, 200, 500)
REPETICOES = 3

# Uso: escala_g1_tres_bracos.py [braço,braço,...] [repetições]
# Comparar dois braços com mais repetições vale mais que três com poucas quando
# a diferença é pequena: o p95 é quantizado em degraus de 16,67 ms e a mediana
# de 3 rodadas pula um degraio inteiro com facilidade — foi o que aconteceu na
# primeira série (o feed deu 100,1 ms numa e 50 ms noutra, mesmo código).
if len(sys.argv) > 1:
    pedidos = sys.argv[1].split(',')
    BRACOS = tuple(b for b in BRACOS if b[0] in pedidos)
    if len(BRACOS) != len(pedidos):
        raise SystemExit(f'braço desconhecido em {pedidos}')
if len(sys.argv) > 2:
    REPETICOES = int(sys.argv[2])

IPHONE = dict(viewport={'width': 393, 'height': 695}, device_scale_factor=3, is_mobile=True,
              has_touch=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) '
              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')


class RodadaInvalida(Exception):
    """A rodada não mediu a condição que dizia medir — descartar, não usar."""


def eventos_no_banco():
    with sqlite3.connect(BANCO) as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM task_events WHERE agent_slug = 'canario'"
        ).fetchone()[0]


def carga(*args):
    r = subprocess.run(['python3', 'gerar-carga.py', *args],
                       cwd=DIR, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise RodadaInvalida(f'gerador falhou: {(r.stderr or r.stdout)[-200:]}')


def estabiliza(alvo, limite_s=120):
    """Espera a ingestão PARAR no alvo — duas leituras iguais com 1 s de folga.

    A escrita passa pelo watcher de JSONL, que é assíncrono. O gerador valida a
    contagem entre as fases e aborta se ela não bate, então rodar a fase seguinte
    com a anterior ainda drenando mata a rodada por engano.
    """
    ate = time.monotonic() + limite_s
    while time.monotonic() < ate:
        if eventos_no_banco() == alvo:
            time.sleep(1)
            if eventos_no_banco() == alvo:
                return
        time.sleep(1)
    raise RodadaInvalida(f'banco não estabilizou em {alvo}: {eventos_no_banco()} eventos')


def cabecalho(pg):
    txt = pg.locator('header').first.inner_text().replace('\n', ' ')
    msg = re.search(r'(\d+)\s+msg', txt)
    itens = re.search(r'(\d+)\s+itens', txt)
    if not msg or not itens:
        raise RodadaInvalida(f'cabeçalho ilegível: {txt!r}')
    return int(msg.group(1)), int(itens.group(1))


def rodada(navegador, rota, historico):
    # Banco sempre nos mesmos 1000 eventos antes da medição: o que muda é só
    # quanto disso o CLIENTE carrega.
    carga('--reset', '--fase', 'historico')
    estabiliza(500)
    carga('--fase', 'preenchimento')
    estabiliza(CARGA_ESPERADA)

    contexto = navegador.new_context(**IPHONE)
    pg = contexto.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    try:
        pg.goto(f'{RAIZ}{rota}?historico={historico}', wait_until='domcontentloaded')
        pg.wait_for_function('() => !!window.__GATE_PROBE__', timeout=20000)
        pg.wait_for_timeout(8000)

        msg_inicio, itens_inicio = cabecalho(pg)
        pg.evaluate('() => window.__GATE_PROBE__.iniciar()')
        carga('--fase', 'medicao', '--medicao-segundos', '25')
        pg.wait_for_timeout(3000)
        pg.evaluate('() => window.__GATE_PROBE__.parar()')
        r = pg.evaluate('() => window.__GATE_PROBE__.resultado()')
        msg_fim, itens_fim = cabecalho(pg)
    finally:
        contexto.close()

    g1 = r['g1_cadencia_de_frame']
    if erros:
        print(f'    ⚠️ erros de página: {erros[:2]}', flush=True)
    return dict(msg_inicio=msg_inicio, msg_fim=msg_fim, itens_inicio=itens_inicio,
                itens_fim=itens_fim, p95=g1['p95_ms'], pior=g1['pior_frame_ms'],
                mediana=g1['mediana_ms'], frames=g1['frames'])


resultados = {braco: {n: [] for n in NIVEIS} for braco, _ in BRACOS}
descartes = []

with sync_playwright() as p:
    b = p.chromium.launch()
    for repeticao in range(1, REPETICOES + 1):
        giro_n = (repeticao - 1) % len(NIVEIS)
        for posicao, nivel in enumerate(NIVEIS[giro_n:] + NIVEIS[:giro_n]):
            # Os três braços do mesmo nível, adjacentes: eles pegam o mesmo
            # estado de máquina, que é o que torna a comparação entre eles
            # legítima. O giro muda quem do trio entra primeiro.
            giro_b = (repeticao - 1 + posicao) % len(BRACOS)
            for braco, rota in BRACOS[giro_b:] + BRACOS[:giro_b]:
                print(f'  {braco:>8} · histórico {nivel} · rodada {repeticao} ...', flush=True)
                try:
                    r = rodada(b, rota, nivel)
                # Largo de propósito: um timeout do Playwright num braço não pode
                # matar a série inteira e levar junto as rodadas boas dos outros
                # dois. Toda descartada é impressa na hora e recontada no fim.
                except Exception as erro:  # noqa: BLE001
                    descartes.append(f'{braco}/{nivel}/r{repeticao}: {erro}')
                    print(f'    ❌ descartada — {erro}', flush=True)
                    continue
                resultados[braco][nivel].append(r)
                print(f'    msg {r["msg_inicio"]}→{r["msg_fim"]} · itens '
                      f'{r["itens_inicio"]}→{r["itens_fim"]} · p95 {r["p95"]} ms · '
                      f'pior {r["pior"]} · mediana {r["mediana"]} · frames {r["frames"]}',
                      flush=True)
    b.close()

print('\n' + '=' * 78)
print('PROVA DE QUE O PARÂMETRO MORDE (contagem no início da janela medida)')
quebrado = False
for braco, _ in BRACOS:
    aberturas = {}
    for nivel in NIVEIS:
        rs = resultados[braco][nivel]
        aberturas[nivel] = sorted({r['msg_inicio'] for r in rs}) if rs else []
        print(f'  {braco:>8} · histórico {nivel:>5} → msg {aberturas[nivel]} · itens '
              f'{sorted({r["itens_inicio"] for r in rs})}')
    primeiros = {a[0] for a in aberturas.values() if a}
    if len(primeiros) < len([a for a in aberturas.values() if a]):
        print(f'  ❌ {braco}: níveis empataram — p95 deste braço é inválido.')
        quebrado = True

print('\n' + '=' * 78)
print(f'{"braço":>9} {"histórico":>10} {"itens":>7} {"p95 das rodadas":>26} {"mediana":>10}')
resumo = {}
frames = {}
for braco, _ in BRACOS:
    for nivel in NIVEIS:
        rs = resultados[braco][nivel]
        if not rs:
            print(f'{braco:>9} {nivel:>10} {"—":>7} {"sem rodada válida":>26}')
            continue
        p95s = [r['p95'] for r in rs]
        resumo[(braco, nivel)] = statistics.median(p95s)
        frames[(braco, nivel)] = statistics.median([r['frames'] for r in rs])
        print(f'{braco:>9} {nivel:>10} {rs[0]["itens_inicio"]:>7} {str(p95s):>26} '
              f'{resumo[(braco, nivel)]:>9.1f} ms')

print('\n' + '=' * 78)
print('OS TRÊS BRAÇOS PAREADOS — mesma sessão, mesma máquina, mesma hora')
print(f'{"histórico":>10} ' + ' '.join(f'{braco:>12}' for braco, _ in BRACOS))
for nivel in NIVEIS:
    linha = f'{nivel:>10} '
    for braco, _ in BRACOS:
        v = resumo.get((braco, nivel))
        linha += f'{(f"{v:.1f} ms" if v is not None else "—"):>12} '
    print(linha)

# O p95 é quantizado em múltiplos de 16,67 ms, então uma diferença de um frame
# aparece como salto de 50% e uma real pode sumir dentro do degrau. Frames
# ENTREGUES na janela é contínuo, não tem degrau, e mede a mesma coisa que
# importa: quanta tela o Rica recebeu enquanto o feed trabalhava.
print('\n' + '=' * 78)
print('FRAMES ENTREGUES NA JANELA — mediana; contínuo, sem o degrau do p95')
print(f'{"histórico":>10} ' + ' '.join(f'{braco:>12}' for braco, _ in BRACOS))
for nivel in NIVEIS:
    linha = f'{nivel:>10} '
    for braco, _ in BRACOS:
        v = frames.get((braco, nivel))
        linha += f'{(f"{v:.0f}" if v is not None else "—"):>12} '
    print(linha)

menor, maior = NIVEIS[0], NIVEIS[-1]
print()
for braco, _ in BRACOS:
    a, z = resumo.get((braco, menor)), resumo.get((braco, maior))
    if a is None or z is None:
        print(f'  {braco:>8}: escala indeterminada — faltou rodada válida')
        continue
    f = z / max(0.1, a)
    veredito = ('ESCALA com o histórico' if f >= 1.5
                else ('NÃO escala' if f <= 1.2 else 'inconclusivo'))
    print(f'  {braco:>8}: 10× de histórico → p95 {f:.2f}× — {veredito}')

controle = resumo.get(('sem-lib', maior))
if controle:
    print('\nDISTÂNCIA ATÉ O ESQUELETO (nível 500, tudo da mesma janela):')
    for braco, _ in BRACOS:
        v = resumo.get((braco, maior))
        if v is not None:
            print(f'  {braco:>8}: p95 {v / controle:.2f}× o controle', end='')
            f_base, f_v = frames.get(('sem-lib', maior)), frames.get((braco, maior))
            if f_base and f_v:
                print(f'  ·  entrega {100 * f_v / f_base:.0f}% dos frames dele')
            else:
                print()

if descartes:
    print(f'\n⚠️ {len(descartes)} rodada(s) descartada(s) — amostra menor do que o desenho:')
    for d in descartes:
        print(f'  · {d}')
if quebrado:
    raise SystemExit('\n❌ ao menos um braço teve níveis empatados — leia a prova acima.')
