"""O p95 do G1 escala com o tamanho do histórico acumulado?

Pergunta única. Se escalar, é o argumento definitivo contra a biblioteca: o custo
cresce com o que o Rica acumula, e virtualizar não resolve por construção.

DESENHO. A janela medida é SEMPRE a mesma: a fase `medicao` inteira — 25 s a
50 Hz, 1250 eventos, mesmo banco, mesma semente. A única variável é quanto
histórico o cliente já tinha quando a medição começou, controlado por
`?historico=N` na bancada.

Três níveis em vez de dois, porque dois pontos não distinguem "escala" de
"ruído": 250, 500 e 1000 eventos de histórico. Duas repetições por nível — uma
rodada só de p95 é anedota.

TENTATIVA ANTERIOR, e por que falhou: eu tinha tentado variar o feed pela hora
de abrir a página, supondo que o replay do SSE estivesse limitado a 500 eventos.
Não está — os dois braços abriram com 742 itens e eu medi a mesma condição duas
vezes com dois rótulos. Fica registrado porque o resultado daquela rodada ("não
escala") era inválido por construção, não por medida.
"""
import re
import statistics
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3008/spike'
DIR = '/home/clawd/repos/grupo_borges/fixtures/cockpit-v2'
NIVEIS = (250, 500, 1000)
REPETICOES = 2
IPHONE = dict(viewport={'width': 393, 'height': 695}, device_scale_factor=3, is_mobile=True,
              has_touch=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) '
              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')


def carga(fase, *extra):
    r = subprocess.run(['python3', 'gerar-carga.py', '--fase', fase, *extra],
                       cwd=DIR, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise SystemExit(f'gerador falhou em {fase}: {(r.stderr or r.stdout)[-400:]}')


def itens(pg):
    txt = pg.locator('header').first.inner_text().replace('\n', ' ')
    achado = re.search(r'(\d+)\s+itens', txt)
    if not achado:
        raise SystemExit(f'não achei a contagem de itens no cabeçalho: {txt!r}')
    return int(achado.group(1))


def rodada(navegador, historico):
    # Banco sempre nos mesmos 1000 eventos antes da medição: o que muda é só
    # quanto disso o CLIENTE carrega.
    subprocess.run(['python3', 'gerar-carga.py', '--reset', '--fase', 'historico'],
                   cwd=DIR, capture_output=True, text=True, timeout=300)
    carga('preenchimento')

    pg = navegador.new_context(**IPHONE).new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(f'{BASE}?historico={historico}', wait_until='domcontentloaded')
    pg.wait_for_function('() => !!window.__GATE_PROBE__', timeout=20000)
    time.sleep(8)

    inicio = itens(pg)
    pg.evaluate('() => window.__GATE_PROBE__.iniciar()')
    carga('medicao', '--medicao-segundos', '25')
    time.sleep(3)
    pg.evaluate('() => window.__GATE_PROBE__.parar()')
    r = pg.evaluate('() => window.__GATE_PROBE__.resultado()')
    fim = itens(pg)
    pg.context.close()

    g1 = r['g1_cadencia_de_frame']
    if erros:
        print(f'    ⚠️ erros de página: {erros}')
    return (inicio, fim, g1['p95_ms'], g1['pior_frame_ms'], g1['mediana_ms'], g1['frames'])


resultados = {n: [] for n in NIVEIS}
with sync_playwright() as p:
    b = p.chromium.launch()
    for repeticao in range(1, REPETICOES + 1):
        for nivel in NIVEIS:
            print(f'  histórico {nivel} · rodada {repeticao} ...', flush=True)
            r = rodada(b, nivel)
            resultados[nivel].append(r)
            print(f'    feed {r[0]} → {r[1]} itens · p95 {r[2]} ms · pior {r[3]} · '
                  f'mediana {r[4]} · frames {r[5]}', flush=True)
    b.close()

print('\n' + '=' * 72)
print(f'{"histórico":>10} {"itens no início":>16} {"p95 das rodadas":>22} {"mediana":>10}')
resumo = {}
for nivel, rs in resultados.items():
    p95s = [r[2] for r in rs]
    resumo[nivel] = statistics.median(p95s)
    print(f'{nivel:>10} {rs[0][0]:>16} {str(p95s):>22} {resumo[nivel]:>9.1f} ms')

menor, maior = NIVEIS[0], NIVEIS[-1]
f_feed = resultados[maior][0][0] / max(1, resultados[menor][0][0])
f_p95 = resumo[maior] / max(0.1, resumo[menor])
print(f'\nfeed inicial {f_feed:.1f}× maior  →  p95 {f_p95:.2f}× maior')
print('CONCLUSÃO:', 'ESCALA com o histórico acumulado' if f_p95 >= 1.5
      else ('NÃO escala — o custo é por evento que CHEGA, não por evento guardado'
            if f_p95 <= 1.2 else 'inconclusivo — repetir com mais rodadas'))
