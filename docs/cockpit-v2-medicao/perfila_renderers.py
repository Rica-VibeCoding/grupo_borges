"""ONDE O FEED REAL GASTA — perfil de CPU por função, com braço de controle.

A pergunta: os ~2× de p95 do feed real sobre o esqueleto saem de onde? O
`RESULTADO-feed-real.md` já descartou o que é estrutura (virtualizador,
estimativa em cache, classificador incremental — idênticos nos dois braços) e
apontou o `Thinking` pela composição da carga (503.272 chars de raciocínio
contra 11.880 de texto). Isso é hipótese. Isto aqui é atribuição.

MÉTODO. Perfil de amostragem do V8 (CDP `Profiler`, 100 µs) durante a MESMA
janela de medição das outras bancadas, nos dois braços:

  · /spike/sem-lib — infra pura: React, virtualizador, SSE, classificador
  · /spike/feed    — a mesma infra MAIS os renderers

O que aparece nos dois é infra e não explica a diferença. O que aparece só no
feed, ou aparece muito mais nele, é o custo dos renderers — e é essa coluna que
decide o que otimizar. Perfilar só o feed responderia "React é caro", que é
verdade e é inútil.

RESSALVA DO INSTRUMENTO. O perfil muda o que mede: amostrar a 100 µs pesa, e o
p95 daqui NÃO é comparável com o das outras bancadas. Serve para ordenar
funções entre si dentro da mesma rodada, não para cravar milissegundo. O número
que vale como p95 continua sendo o de `escala_g1_tres_bracos.py`, sem profiler.

NÃO RODAR junto com outra bancada: cada rodada chama `gerar-carga.py --reset` no
mesmo SQLite.
"""
import collections
import sqlite3
import subprocess
import time

from playwright.sync_api import sync_playwright

RAIZ = 'http://127.0.0.1:3008'
DIR = '/home/clawd/repos/grupo_borges/fixtures/cockpit-v2'
BANCO = '/home/clawd/repos/grupo_borges/apps/api/db/grupo_borges.db'
CARGA_ESPERADA = 1000
# O pior caso do gate: 500 de histórico é onde a distância entre os braços
# apareceu maior.
HISTORICO = 500
BRACOS = (('sem-lib', '/spike/sem-lib'), ('feed', '/spike/feed'))
IPHONE = dict(viewport={'width': 393, 'height': 695}, device_scale_factor=3, is_mobile=True,
              has_touch=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) '
              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')


def eventos_no_banco():
    with sqlite3.connect(BANCO) as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM task_events WHERE agent_slug = 'canario'"
        ).fetchone()[0]


def carga(*args):
    r = subprocess.run(['python3', 'gerar-carga.py', *args],
                       cwd=DIR, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise SystemExit(f'gerador falhou: {(r.stderr or r.stdout)[-300:]}')


def estabiliza(alvo, limite_s=120):
    ate = time.monotonic() + limite_s
    while time.monotonic() < ate:
        if eventos_no_banco() == alvo:
            time.sleep(1)
            if eventos_no_banco() == alvo:
                return
        time.sleep(1)
    raise SystemExit(f'banco não estabilizou em {alvo}: {eventos_no_banco()} eventos')


def self_time_por_funcao(perfil):
    """Tempo PRÓPRIO por função, em ms — não acumulado.

    O acumulado colocaria `performRenderPhase` no topo de tudo e não diria nada.
    O próprio responde 'onde a CPU estava quando a amostra caiu'.
    """
    nos = {n['id']: n for n in perfil['nodes']}
    amostras = collections.Counter(perfil['samples'])
    total_us = sum(perfil['timeDeltas'])
    # Amostras não são equidistantes: o delta correto é o do índice da amostra.
    us_por_no = collections.Counter()
    for indice, no_id in enumerate(perfil['samples']):
        us_por_no[no_id] += perfil['timeDeltas'][indice] if indice < len(perfil['timeDeltas']) else 0

    por_funcao = collections.Counter()
    for no_id, us in us_por_no.items():
        quadro = nos[no_id]['callFrame']
        nome = quadro.get('functionName') or '(anônima)'
        url = quadro.get('url') or ''
        curto = url.split('/')[-1].split('?')[0] if url else '(nativo)'
        linha = quadro.get('lineNumber', -1)
        por_funcao[f'{nome} · {curto}:{linha}'] += us / 1000.0
    return por_funcao, total_us / 1000.0, sum(amostras.values())


def perfila(navegador, rota):
    carga('--reset', '--fase', 'historico')
    estabiliza(500)
    carga('--fase', 'preenchimento')
    estabiliza(CARGA_ESPERADA)

    contexto = navegador.new_context(**IPHONE)
    pg = contexto.new_page()
    try:
        pg.goto(f'{RAIZ}{rota}?historico={HISTORICO}', wait_until='domcontentloaded')
        pg.wait_for_function('() => !!window.__GATE_PROBE__', timeout=20000)
        pg.wait_for_timeout(8000)

        cdp = contexto.new_cdp_session(pg)
        cdp.send('Profiler.enable')
        cdp.send('Profiler.setSamplingInterval', {'interval': 100})  # µs
        cdp.send('Profiler.start')

        pg.evaluate('() => window.__GATE_PROBE__.iniciar()')
        carga('--fase', 'medicao', '--medicao-segundos', '25')
        pg.wait_for_timeout(3000)
        pg.evaluate('() => window.__GATE_PROBE__.parar()')

        perfil = cdp.send('Profiler.stop')['profile']
    finally:
        contexto.close()
    return self_time_por_funcao(perfil)


with sync_playwright() as p:
    b = p.chromium.launch()
    colhido = {}
    for braco, rota in BRACOS:
        print(f'perfilando {braco} ({rota}) ...', flush=True)
        colhido[braco] = perfila(b, rota)
    b.close()

for braco, (por_funcao, total_ms, amostras) in colhido.items():
    print('\n' + '=' * 78)
    print(f'{braco} — {amostras} amostras, {total_ms:.0f} ms de janela')
    print(f'{"ms próprios":>12}  função')
    for chave, ms in por_funcao.most_common(20):
        print(f'{ms:>12.1f}  {chave}')

print('\n' + '=' * 78)
print('O QUE SÓ EXISTE NO FEED — a diferença é o custo dos renderers')
base = colhido['sem-lib'][0]
feed = colhido['feed'][0]
delta = collections.Counter()
for chave, ms in feed.items():
    delta[chave] = ms - base.get(chave, 0.0)
print(f'{"Δ ms":>10}  {"feed":>8}  {"sem-lib":>8}  função')
for chave, d in delta.most_common(25):
    if d <= 0.5:
        break
    print(f'{d:>10.1f}  {feed.get(chave, 0):>8.1f}  {base.get(chave, 0):>8.1f}  {chave}')
