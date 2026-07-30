"""G1 pós-conserto, limpo (sem profiler — o sampler do V8 inflava o p95).

Sequência canônica do gate: reset+histórico já rodou fora daqui; aqui a página
sobe ANTES do preenchimento (o gerador exige SSE aberto), e a medição de 50 Hz
roda com o probe ligado. Só reporta se o feed tiver andado — p95 de página
congelada não mede nada.
"""
import subprocess, threading, time
from playwright.sync_api import sync_playwright

IPHONE = dict(viewport={'width': 393, 'height': 695}, device_scale_factor=3, is_mobile=True,
              has_touch=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) '
              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
DIR = '/home/clawd/repos/grupo_borges/fixtures/cockpit-v2'
res = {}


def carga():
    time.sleep(2)
    for fase, extra in (('preenchimento', []), ('medicao', ['--medicao-segundos', '25'])):
        r = subprocess.run(['python3', 'gerar-carga.py', '--fase', fase] + extra,
                           cwd=DIR, capture_output=True, text=True, timeout=200)
        res[fase] = (r.stdout or r.stderr).strip().splitlines()[-1:]


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(**IPHONE).new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto('http://127.0.0.1:3008/spike', wait_until='domcontentloaded')
    pg.wait_for_function('() => !!window.__GATE_PROBE__', timeout=20000)
    time.sleep(7)
    antes = pg.locator('header').first.inner_text().replace('\n', ' | ')

    pg.evaluate('() => window.__GATE_PROBE__.iniciar()')
    t = threading.Thread(target=carga); t.start()
    time.sleep(45)
    t.join(timeout=200)
    pg.evaluate('() => window.__GATE_PROBE__.parar()')
    r = pg.evaluate('() => window.__GATE_PROBE__.resultado()')
    depois = pg.locator('header').first.inner_text().replace('\n', ' | ')
    b.close()

g1, g4 = r['g1_cadencia_de_frame'], r['g4_repintura_cirurgica']
print(f'antes : {antes}')
print(f'depois: {depois}')
print(f'carga : {res}')
print(f'\nFEED ANDOU? {"SIM" if antes != depois else "NAO — curto-circuito de identidade"}')
print(f'G1  frames {g1["frames"]} · p95 {g1["p95_ms"]} ms · pior {g1["pior_frame_ms"]} · mediana {g1["mediana_ms"]}')
print(f'    corte 32 / 250 → passou: {g1["passou"]}')
print(f'G4  seladas acima do corte: {g4["seladas_acima_do_corte"]} · observadas {g4["mensagens_observadas"]}')
print(f'erros de página: {erros or "nenhum"}')
