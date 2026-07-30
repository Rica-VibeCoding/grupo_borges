"""O p95 do G1 escala com o tamanho do histórico acumulado?

Pergunta única. Se escalar, é o argumento definitivo contra a biblioteca: o custo
cresce com o que o Rica acumula, e virtualizar não resolve por construção.

DESENHO. A janela medida é SEMPRE a mesma: a fase `medicao` inteira — 25 s a
50 Hz, 1250 eventos, mesmo banco, mesma semente. A única variável é quanto
histórico o cliente já tinha quando a medição começou, controlado por
`?historico=N`.

DUAS TENTATIVAS ANTERIORES MEDIRAM A MESMA CONDIÇÃO COM RÓTULOS DIFERENTES —
os três níveis abriam com 742 itens. A causa só apareceu em 30/07: o `limit` do
SSE dimensionava o PRIMEIRO LOTE do replay (os N eventos mais ANTIGOS), e o loop
live puxava todo o resto do banco logo em seguida, em ciclos de 500. Nenhum
`limit` do cliente conseguia segurar isso. O conserto é `recentes=1`, que faz o
replay entregar a CAUDA e o cursor já sair no topo.

RODE `portao_historico.py` ANTES DESTE. Se os três níveis não abrirem com
contagem diferente, o instrumento está quebrado de novo e o p95 daqui não vale
nada — foi assim que duas rodadas morreram.

BANCADA: mede contra o backend em produção (:8000) de propósito, e NÃO contra um
segundo uvicorn. Tentei subir um só da medição na :8001 para escapar do teto de
replay de 500 — cada processo traz o PRÓPRIO watcher de JSONL, os dois importam
o mesmo arquivo para o mesmo SQLite, e o banco ficou com cada evento em dobro
(1000 linhas, 500 uuids distintos; a biblioteca acusou "duplicate message id" no
console). Por isso os níveis cabem todos em 500.

O cuidado que sobra: o serviço roda sem `--reload`. Mexeu no backend, ou o
processo é reiniciado, ou ele continua servindo o código velho — e aí se mede o
comportamento antigo achando que é o novo. O portão pega isso.
"""
import re
import sqlite3
import statistics
import subprocess
import time

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3008/spike'
DIR = '/home/clawd/repos/grupo_borges/fixtures/cockpit-v2'
BANCO = '/home/clawd/repos/grupo_borges/apps/api/db/grupo_borges.db'
CARGA_ESPERADA = 1000  # 500 da fase histórico + 500 da fase preenchimento
# 10× de distância entre o menor e o maior, e todos dentro do teto de replay de
# 500 do backend em produção. NÃO suba um segundo uvicorn no mesmo SQLite para
# escapar do teto: cada processo traz o próprio watcher de JSONL e o mesmo
# arquivo entra duas vezes (aconteceu: 1000 linhas, 500 uuids distintos, e a
# biblioteca reclamando de "duplicate message id" no console).
NIVEIS = (50, 200, 500)
REPETICOES = 3
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
        raise SystemExit(f'gerador falhou: {(r.stderr or r.stdout)[-400:]}')


def estabiliza(alvo, limite_s=120):
    """Espera a ingestão PARAR no alvo — duas leituras iguais com 1 s de folga.

    A escrita passa pelo watcher de JSONL, que é assíncrono. O gerador valida a
    contagem entre as fases e aborta se ela não bate, então rodar a fase seguinte
    com a anterior ainda drenando mata a rodada por engano ("exige 500,
    encontrados 617" — aconteceu).
    """
    ate = time.monotonic() + limite_s
    while time.monotonic() < ate:
        if eventos_no_banco() == alvo:
            time.sleep(1)
            if eventos_no_banco() == alvo:
                return
        time.sleep(1)
    raise SystemExit(f'banco não estabilizou em {alvo}: {eventos_no_banco()} eventos')


def cabecalho(pg):
    txt = pg.locator('header').first.inner_text().replace('\n', ' ')
    msg = re.search(r'(\d+)\s+msg', txt)
    itens = re.search(r'(\d+)\s+itens', txt)
    if not msg or not itens:
        raise SystemExit(f'cabeçalho ilegível: {txt!r}')
    return int(msg.group(1)), int(itens.group(1))


def rodada(navegador, historico):
    # Banco sempre nos mesmos 1000 eventos antes da medição: o que muda é só
    # quanto disso o CLIENTE carrega.
    carga('--reset', '--fase', 'historico')
    estabiliza(500)
    carga('--fase', 'preenchimento')
    estabiliza(CARGA_ESPERADA)

    pg = navegador.new_context(**IPHONE).new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(f'{BASE}?historico={historico}', wait_until='domcontentloaded')
    pg.wait_for_function('() => !!window.__GATE_PROBE__', timeout=20000)
    pg.wait_for_timeout(8000)

    msg_inicio, itens_inicio = cabecalho(pg)
    pg.evaluate('() => window.__GATE_PROBE__.iniciar()')
    carga('--fase', 'medicao', '--medicao-segundos', '25')
    pg.wait_for_timeout(3000)
    pg.evaluate('() => window.__GATE_PROBE__.parar()')
    r = pg.evaluate('() => window.__GATE_PROBE__.resultado()')
    msg_fim, itens_fim = cabecalho(pg)
    pg.context.close()

    g1 = r['g1_cadencia_de_frame']
    if erros:
        print(f'    ⚠️ erros de página: {erros}')
    return dict(msg_inicio=msg_inicio, msg_fim=msg_fim, itens_inicio=itens_inicio,
                itens_fim=itens_fim, p95=g1['p95_ms'], pior=g1['pior_frame_ms'],
                mediana=g1['mediana_ms'], frames=g1['frames'])


resultados = {n: [] for n in NIVEIS}
with sync_playwright() as p:
    b = p.chromium.launch()
    # Ordem ROTACIONADA, não só intercalada. A bancada degrada ao longo de
    # rodadas consecutivas (frames caíram de 217 para 91 e a mediana subiu de
    # 16,7 para 266,7 entre a primeira e a última de uma série), então a POSIÇÃO
    # na sequência é uma variável escondida. Intercalar por repetição não basta:
    # com a ordem fixa 50/200/500, o nível 500 cai sempre em terceiro e leva a
    # degradação inteira na conta dele — foi o que a primeira passagem produziu.
    # Rotacionando, cada nível ocupa cada posição exatamente uma vez.
    for repeticao in range(1, REPETICOES + 1):
        giro = (repeticao - 1) % len(NIVEIS)
        for nivel in NIVEIS[giro:] + NIVEIS[:giro]:
            print(f'  histórico {nivel} · rodada {repeticao} ...', flush=True)
            r = rodada(b, nivel)
            resultados[nivel].append(r)
            print(f'    msg {r["msg_inicio"]}→{r["msg_fim"]} · itens '
                  f'{r["itens_inicio"]}→{r["itens_fim"]} · p95 {r["p95"]} ms · '
                  f'pior {r["pior"]} · mediana {r["mediana"]} · frames {r["frames"]}',
                  flush=True)
    b.close()

print('\n' + '=' * 78)
print('PROVA DE QUE O PARÂMETRO MORDE (contagem no início da janela medida)')
for nivel, rs in resultados.items():
    inicios = sorted({r['msg_inicio'] for r in rs})
    print(f'  histórico {nivel:>5} → msg {inicios} · itens '
          f'{sorted({r["itens_inicio"] for r in rs})}')
if len({rs[0]['msg_inicio'] for rs in resultados.values()}) < len(NIVEIS):
    raise SystemExit('\n❌ níveis empataram — instrumento quebrado, p95 inválido.')

print('\n' + '=' * 78)
print(f'{"histórico":>10} {"itens no início":>16} {"p95 das rodadas":>26} {"mediana":>10}')
resumo = {}
for nivel, rs in resultados.items():
    p95s = [r['p95'] for r in rs]
    resumo[nivel] = statistics.median(p95s)
    print(f'{nivel:>10} {rs[0]["itens_inicio"]:>16} {str(p95s):>26} {resumo[nivel]:>9.1f} ms')

menor, maior = NIVEIS[0], NIVEIS[-1]
f_feed = resultados[maior][0]['itens_inicio'] / max(1, resultados[menor][0]['itens_inicio'])
f_p95 = resumo[maior] / max(0.1, resumo[menor])
print(f'\nfeed inicial {f_feed:.1f}× maior  →  p95 {f_p95:.2f}× maior')
print('CONCLUSÃO:', 'ESCALA com o histórico acumulado' if f_p95 >= 1.5
      else ('NÃO escala — o custo é por evento que CHEGA, não por evento guardado'
            if f_p95 <= 1.2 else 'inconclusivo — repetir com mais rodadas'))
