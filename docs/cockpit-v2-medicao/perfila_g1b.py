"""Perfil COM carga de verdade. Abre o SSE antes do preenchimento (o protocolo
do gerador exige), depois roda preenchimento + medição de 50 Hz perfilando.
Só reporta se o feed tiver andado — perfil de página parada não vale nada.
"""
import collections, subprocess, threading, time
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
    pg.goto('http://127.0.0.1:3008/spike', wait_until='domcontentloaded')
    pg.wait_for_function('() => !!window.__GATE_PROBE__', timeout=20000)
    time.sleep(7)
    antes = pg.locator('header').first.inner_text().replace('\n', ' | ')

    cdp = pg.context.new_cdp_session(pg)
    cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 200})
    pg.evaluate('() => window.__GATE_PROBE__.iniciar()')
    cdp.send('Profiler.start')

    t = threading.Thread(target=carga); t.start()
    time.sleep(45)
    t.join(timeout=200)

    prof = cdp.send('Profiler.stop')['profile']
    pg.evaluate('() => window.__GATE_PROBE__.parar()')
    r = pg.evaluate('() => window.__GATE_PROBE__.resultado()')
    depois = pg.locator('header').first.inner_text().replace('\n', ' | ')
    b.close()

print(f'antes : {antes}\ndepois: {depois}\ncarga : {res}')
g1 = r['g1_cadencia_de_frame']
print(f'\nG1 frames {g1["frames"]} · p95 {g1["p95_ms"]} ms · pior {g1["pior_frame_ms"]} · mediana {g1["mediana_ms"]}\n')

nos = {n['id']: n for n in prof['nodes']}
ticks = collections.Counter(prof.get('samples', []))
dt = (prof['endTime'] - prof['startTime']) / 1000 / max(1, len(prof.get('samples', [])))
por = collections.Counter()
for nid, c in ticks.items():
    cf = nos[nid]['callFrame']
    url = cf['url'].split('/')[-1].split('?')[0] if cf['url'] else '(nativo)'
    por[f'{cf["functionName"] or "(anônimo)"}  ·  {url}:{cf["lineNumber"]}'] += c
tot = sum(por.values())
print('SELF TIME — top 16 (sem idle):')
for nome, c in por.most_common(20):
    if '(idle)' in nome: continue
    print(f'  {c*dt:8.0f} ms  {100*c/tot:5.1f}%   {nome}')
