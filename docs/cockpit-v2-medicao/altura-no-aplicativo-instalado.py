"""O contrato dos dois regimes do aplicativo instalado, e o custo de mantê-lo.

Regime de repouso (nenhum campo focado): a variável NÃO existe — quem manda é
o `100dvh` do CSS, o único motor que o aparelho comprova correto em repouso.
Regime de teclado (campo focado): a variável existe e copia `window.innerHeight`,
que com o teclado aberto é honesto (655 medido no iPhone do Rica).

A bancada prova as três transições — carga, foco, desfoco — e que nada disso
vira laço de escrita: a raiz é amostrada em `requestAnimationFrame` e cada
mudança de valor da variável conta. (Amostra em rAF, não MutationObserver: no
`add_init_script` o `documentElement` ainda não existe, e a primeira versão
desta bancada reportou "0 escritas" com o observador que nunca foi instalado.)

O ramo do aplicativo é escolhido por `navigator.standalone`, então dá para
entrar nele num Chromium — o que NÃO reproduz aqui é o `innerHeight` preso do
WebKit, que tem bancada própria (`altura-que-cresce-sem-evento.py`).

Uso: python3 altura-no-aplicativo-instalado.py <porta> [segundos]
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
segundos = int(sys.argv[2]) if len(sys.argv) > 2 else 6

FINGE_APLICATIVO = """
Object.defineProperty(navigator, 'standalone', { get: () => true });
window.__escritas = [];
(() => {
  let anterior = null;
  const passo = () => {
    const raiz = document.documentElement;
    const valor = raiz ? raiz.style.getPropertyValue('--ck-viewport-altura') : null;
    if (valor !== anterior) {
      anterior = valor;
      window.__escritas.push({ t: performance.now(), valor: valor || '(vazia)' });
    }
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
})();
"""

with sync_playwright() as p:
    navegador = p.chromium.launch()
    ctx = navegador.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(FINGE_APLICATIVO)
    pagina = ctx.new_page()
    pagina.goto(f"http://127.0.0.1:{porta}/agente/pavan", wait_until="domcontentloaded")
    pagina.wait_for_timeout(segundos * 1000)

    def estado(rotulo: str) -> dict:
        return {
            "rotulo": rotulo,
            "variavel": pagina.evaluate(
                "() => document.documentElement.style.getPropertyValue('--ck-viewport-altura')"
            ).strip(),
            "app": pagina.evaluate(
                "() => Math.round(document.querySelector('body [style*=\"--ck-viewport-altura\"]')"
                ".getBoundingClientRect().height)"
            ),
            "janela": pagina.evaluate("() => window.innerHeight"),
            "escritas": len(pagina.evaluate("() => window.__escritas")),
        }

    repouso = estado("carga em repouso")

    campo = pagina.query_selector("textarea")
    if campo:
        campo.click()
        pagina.wait_for_timeout(2_000)
    focado = estado("campo focado")

    pagina.evaluate("() => document.activeElement && document.activeElement.blur()")
    pagina.wait_for_timeout(2_000)
    desfocado = estado("desfocado")

    ctx.close()
    navegador.close()

print(f"== os dois regimes do aplicativo instalado (porta {porta})")
falhas = []
for e in (repouso, focado, desfocado):
    print(
        f"   {e['rotulo']:18s} variável {e['variavel'] or '(ausente)':10s} "
        f"app {e['app']:4d}  janela {e['janela']:4d}  mudanças acumuladas {e['escritas']}"
    )

if repouso["variavel"]:
    falhas.append("em repouso a variável deveria estar ausente (CSS no comando)")
if repouso["app"] != repouso["janela"]:
    falhas.append("em repouso a app não mede a janela")
if focado["variavel"] != f"{focado['janela']}px":
    falhas.append("com foco a variável deveria copiar a janela")
if desfocado["variavel"]:
    falhas.append("depois do desfoco a variável deveria sumir")
if desfocado["app"] != desfocado["janela"]:
    falhas.append("depois do desfoco a app não voltou à janela")
if desfocado["escritas"] > 6:
    falhas.append(f"{desfocado['escritas']} mudanças de valor — cheiro de laço de escrita")

print()
if falhas:
    for f in falhas:
        print(f"   FALHA: {f}")
else:
    print("   CONTRATO INTEIRO DE PÉ — repouso no CSS, teclado no JS, sem laço")

sys.exit(1 if falhas else 0)
