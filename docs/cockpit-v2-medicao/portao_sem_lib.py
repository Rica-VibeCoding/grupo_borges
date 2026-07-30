"""BRAÇO DE CONTROLE — mesma bancada, SEM a assistant-ui (/spike/sem-lib).

Derivado de portao_historico.py (mesmo método, mesma janela, mesma rotação);
a única diferença é a rota medida. A pergunta: o joelho de p95 do G1 é
da biblioteca ou da nossa própria camada? Ver docs/cockpit-v2-gate.md.

Doc original do método, abaixo.
---
PORTÃO: o `?historico=N` move a variável independente? Roda ANTES de medir.

Duas rodadas de medição de escala já foram invalidadas por medir a mesma
condição com três rótulos diferentes — os níveis 250/500/1000 abriam todos com
742 itens. Enquanto os três níveis não abrirem com contagem DIFERENTE, qualquer
p95 tirado dali é inválido por construção, não por medida.

Este script não mede nada. Só abre a bancada nos três níveis, com o mesmo banco,
e imprime quanto cada um carregou. Se der o mesmo número, o instrumento continua
quebrado e a medição não deve nem começar.
"""
import pathlib
import re
import sqlite3
import subprocess
import time

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3008/spike/sem-lib'
DIR = '/home/clawd/repos/grupo_borges/fixtures/cockpit-v2'
# 10× de distância entre o menor e o maior, e todos dentro do teto de replay de
# 500 do backend em produção — é contra ele que se mede, porque subir um segundo
# uvicorn no mesmo SQLite duplica o watcher de JSONL e cada evento entra DUAS
# vezes (aconteceu: 1000 linhas, 500 uuids distintos).
NIVEIS = (50, 200, 500)
IPHONE = dict(viewport={'width': 393, 'height': 695}, device_scale_factor=3, is_mobile=True,
              has_touch=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) '
              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')


BANCO = '/home/clawd/repos/grupo_borges/apps/api/db/grupo_borges.db'
CARGA_ESPERADA = 1000  # 500 da fase histórico + 500 da fase preenchimento


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


def prepara_banco():
    """Só regera se precisar — e espera a ingestão PARAR antes de conferir.

    O gerador valida a contagem entre as fases e aborta se ela não bate. A
    escrita passa pelo watcher de JSONL, que é assíncrono: rodar a fase seguinte
    com a anterior ainda drenando faz o gerador ver um número intermediário
    (aconteceu: "exige 500, encontrados 617") e matar a rodada por engano.
    """
    if eventos_no_banco() != CARGA_ESPERADA:
        carga('--reset', '--fase', 'historico')
        estabiliza(500)
        carga('--fase', 'preenchimento')
    estabiliza(CARGA_ESPERADA)


def estabiliza(alvo, limite_s=90):
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


# Banco idêntico para os três: o que muda é só quanto disso o CLIENTE carrega.
prepara_banco()
print(f'banco pronto: {eventos_no_banco()} eventos do canário\n')

lidos = {}
with sync_playwright() as p:
    navegador = p.chromium.launch()
    for nivel in NIVEIS:
        pg = navegador.new_context(**IPHONE).new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.goto(f'{BASE}?historico={nivel}', wait_until='domcontentloaded')
        pg.wait_for_function('() => !!window.__GATE_PROBE__', timeout=20000)
        # 8s é o mesmo tempo de acomodação da medição: se o polling live fosse
        # drenar o resto do banco por cima do teto, é aqui que apareceria.
        pg.wait_for_timeout(8000)
        msg, itens = cabecalho(pg)
        lidos[nivel] = (msg, itens)
        print(f'  histórico {nivel:>5} → {msg:>5} msg · {itens:>5} itens'
              + (f'  ⚠️ erros: {erros}' if erros else ''), flush=True)
        pg.context.close()
    navegador.close()

distintos = len({v[0] for v in lidos.values()})
print('\n' + '=' * 60)
if distintos == len(NIVEIS):
    print('PORTÃO ABERTO — os três níveis carregaram quantidades diferentes.')
else:
    print(f'PORTÃO FECHADO — só {distintos} contagem(ns) distinta(s) em '
          f'{len(NIVEIS)} níveis. O parâmetro NÃO morde; não meça.')
    raise SystemExit(1)
