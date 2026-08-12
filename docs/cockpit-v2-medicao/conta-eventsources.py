"""Conta EventSources abertas por slug, na produção, numa troca de agente só.

Instrumenta `window.EventSource` ANTES de qualquer script da página: cada
construção e cada `close()` viram registro com timestamp. Contar pelo DevTools
não serve — conexão fechada some da lista e a pergunta é justamente quantas
ficam vivas.

Uso: python3 conta-sse.py <porta>
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]

INSTRUMENTO = """
window.__sse = [];
const Original = window.EventSource;
window.EventSource = function (url, cfg) {
  const inst = new Original(url, cfg);
  const reg = { url: String(url), aberta: performance.now(), fechada: null };
  window.__sse.push(reg);
  const fecharOriginal = inst.close.bind(inst);
  inst.close = function () { reg.fechada = performance.now(); return fecharOriginal(); };
  return inst;
};
window.EventSource.prototype = Original.prototype;
Object.assign(window.EventSource, Original);
"""

with sync_playwright() as p:
    navegador = p.chromium.launch()
    ctx = navegador.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(INSTRUMENTO)
    pagina = ctx.new_page()

    pagina.goto(f"http://127.0.0.1:{porta}/agente/pavan", wait_until="domcontentloaded")
    pagina.wait_for_timeout(8_000)
    print("-- so na tela do pavan:")
    for r in pagina.evaluate("() => window.__sse"):
        print(f"   {'ABERTA ' if r['fechada'] is None else 'fechada'}  {r['url'][:80]}")

    # Uma troca só, por navegação de cliente (o instrumento sobrevive: mesma
    # página). No celular a tropa é gaveta: abrir pelo `≡` antes de escolher.
    pagina.click("[aria-label='Abrir lista de agentes']")
    pagina.wait_for_timeout(1_500)
    pagina.click("text=Daniel Singh", no_wait_after=True)
    pagina.wait_for_timeout(8_000)
    print("\n-- depois de UMA troca para o daniel:")
    reg = pagina.evaluate("() => window.__sse")
    for r in reg:
        print(f"   {'ABERTA ' if r['fechada'] is None else 'fechada'}  {r['url'][:80]}")

    # O cache segura o stream anterior por 30s de propósito. Esperar o TTL é o
    # que separa "guardado pra volta" de "vazado".
    pagina.wait_for_timeout(34_000)
    print("\n-- passados os 30s do TTL ocioso:")
    reg = pagina.evaluate("() => window.__sse")
    vivas = [r for r in reg if r["fechada"] is None]
    for r in reg:
        print(f"   {'ABERTA ' if r['fechada'] is None else 'fechada'}  {r['url'][:80]}")
    print(f"\n   TOTAL construidas: {len(reg)}   ainda ABERTAS: {len(vivas)}")

    ctx.close()
    navegador.close()
