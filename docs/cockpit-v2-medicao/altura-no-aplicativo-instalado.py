"""A releitura da altura estabiliza, ou vira laço de escrita?

O `ff8cce5` observou o elemento raiz para pegar a janela que cresce calada, e
realimentou: a escrita voltava como mudança de layout do próprio observado. O
Rica viu a tela piscando e perdeu uma compactação. Foi revertido no mesmo dia.

O substituto relê `window.innerHeight` por ~1s depois de cada evento e só escreve
quando o número MUDA. Esta bancada existe para provar a parte que dá para provar
sem o iPhone: que a variável para de mudar, e que a página não fica reescrevendo
o `style` da raiz para sempre.

O ramo do aplicativo instalado é escolhido por `navigator.standalone`, então dá
para entrar nele num Chromium — o que NÃO dá para reproduzir aqui é o
crescimento silencioso da janela, que é comportamento do WebKit.

Uso: python3 altura-no-aplicativo-instalado.py <porta> [segundos]
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
segundos = int(sys.argv[2]) if len(sys.argv) > 2 else 6

# Antes de qualquer script da página: é `navigator.standalone` que faz o
# componente sair do ramo do navegador e passar a publicar a altura.
#
# A amostragem é em `requestAnimationFrame`, não `MutationObserver`: neste ponto
# do carregamento o `document.documentElement` ainda não existe, e o `observe`
# num alvo nulo lança — a primeira versão desta bancada reportou "0 escritas"
# porque o observador nunca chegou a ser instalado, e a variável estava lá.
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

    escritas = pagina.evaluate("() => window.__escritas")
    altura = pagina.evaluate(
        "() => getComputedStyle(document.documentElement).getPropertyValue('--ck-viewport-altura')"
    )
    janela = pagina.evaluate("() => window.innerHeight")

    # Focar o campo dispara a mesma janela de releitura que o teclado dispararia.
    marca = len(escritas)
    campo = pagina.query_selector("textarea")
    if campo:
        campo.click()
        pagina.wait_for_timeout(3_000)
    depois = pagina.evaluate("() => window.__escritas")

    ctx.close()
    navegador.close()

print(f"== altura no ramo do aplicativo instalado (porta {porta})")
print(f"   mudanças de valor em {segundos}s de carga: {len(escritas)}")
for e in escritas[:8]:
    print(f"      {e['t']:8.0f} ms  {e['valor']}")
print(f"   mudanças depois de focar o campo (3s): {len(depois) - marca}")
print(f"\n   `--ck-viewport-altura` = {altura.strip() or '(vazia)'}   innerHeight = {janela}")
print("   " + ("BATEM" if altura.strip() == f"{janela}px" else "NÃO BATEM — a variável ficou velha"))
