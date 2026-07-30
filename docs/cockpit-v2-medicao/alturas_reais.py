"""QUAL É A ALTURA REAL DOS ITENS — para escolher `estimateSize` com dado.

A doc do @tanstack/react-virtual, sobre `estimateSize` quando se mede de verdade
com `measureElement`:

    "If you are dynamically measuring your elements, it's recommended to
     estimate the largest possible size (width/height, within comfort) of your
     items. This will help the virtualizer calculate more accurate initial
     positions."

"Largest possible size, within comfort" é uma regra com duas pontas e nenhum
número. Chutar o número é o que estamos tentando parar de fazer. Então este
script mede a distribuição real de alturas na MESMA carga da bancada e deixa a
escolha apoiada em percentil.

MÉTODO. Abre o feed com o histórico cheio e rola do topo ao fim em passos,
colhendo `offsetHeight` de cada `[data-gate-message]` junto com o `data-index`
que o virtualizador escreve. O índice é o que permite deduplicar: o mesmo item
reaparece em passos vizinhos por causa do overscan, e contá-lo duas vezes
enviesaria a distribuição para o que está no meio da lista.

POR QUE ROLAR. O feed é virtualizado — só ~15 itens existem no DOM de cada vez.
Ler uma tela só descreveria a cauda da lista, não a lista.

NÃO RODAR junto com uma bancada: não altera o banco, mas disputa CPU e sujaria
o p95 de quem estiver medindo.
"""
import statistics

from playwright.sync_api import sync_playwright

RAIZ = 'http://127.0.0.1:3008'
ROTA = '/spike/feed'
HISTORICO = 500
PASSOS = 60
IPHONE = dict(viewport={'width': 393, 'height': 695}, device_scale_factor=3, is_mobile=True,
              has_touch=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) '
              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')

COLHE = """
() => {
  const scroller = document.querySelector('[data-gate-messages]');
  const itens = document.querySelectorAll('[data-gate-message]');
  const saida = [];
  for (const no of itens) {
    saida.push([Number(no.dataset.index), no.offsetHeight]);
  }
  return { itens: saida, scrollHeight: scroller ? scroller.scrollHeight : 0,
           clientHeight: scroller ? scroller.clientHeight : 0 };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(**IPHONE)
    pg = ctx.new_page()
    pg.goto(f'{RAIZ}{ROTA}?historico={HISTORICO}', wait_until='domcontentloaded')
    pg.wait_for_function('() => !!window.__GATE_PROBE__', timeout=20000)
    pg.wait_for_timeout(6000)

    por_indice = {}
    estado = pg.evaluate(COLHE)
    alcance = max(1, estado['scrollHeight'] - estado['clientHeight'])
    for passo in range(PASSOS + 1):
        alvo = round(alcance * passo / PASSOS)
        pg.evaluate('(y) => { document.querySelector("[data-gate-messages]").scrollTop = y; }', alvo)
        pg.wait_for_timeout(120)
        estado = pg.evaluate(COLHE)
        for indice, altura in estado['itens']:
            if altura > 0:
                por_indice[indice] = altura
        # O total muda enquanto os itens são medidos — reler mantém o passo justo.
        alcance = max(1, estado['scrollHeight'] - estado['clientHeight'])

    ctx.close()
    b.close()

alturas = sorted(por_indice.values())
if not alturas:
    raise SystemExit('nenhum item medido — o seletor mudou?')


def pct(p):
    return alturas[min(len(alturas) - 1, int(round((len(alturas) - 1) * p / 100)))]


print(f'{len(alturas)} itens distintos medidos (de {HISTORICO} de histórico)')
print(f'  mínimo   {alturas[0]:>6} px')
print(f'  p50      {pct(50):>6} px')
print(f'  média    {statistics.mean(alturas):>6.1f} px')
print(f'  p75      {pct(75):>6} px')
print(f'  p90      {pct(90):>6} px')
print(f'  p95      {pct(95):>6} px')
print(f'  p99      {pct(99):>6} px')
print(f'  máximo   {alturas[-1]:>6} px')

print('\nO "within comfort" da doc: o máximo é o teto do que existe, mas usá-lo')
print('reserva esse espaço para TODO item ainda não medido. O p90/p95 cobre a')
print('quase totalidade sem inflar o total em várias telas de vazio.')

faixas = {}
for altura in alturas:
    faixas[altura] = faixas.get(altura, 0) + 1
print('\nalturas mais comuns:')
for altura, n in sorted(faixas.items(), key=lambda kv: -kv[1])[:8]:
    print(f'  {altura:>5} px · {n:>4} itens ({100 * n / len(alturas):.0f}%)')
