"""Prova dirigida — o composer sumia da tela ao receber o teclado no iPhone.

Quando o teclado cobriria o campo focado, o Safari desloca a página inteira para
cima. A conta desse deslocamento é feita contra a app do tamanho da tela; se a
app encolher logo depois — era o que o `--ck-viewport-altura` fazia ao seguir o
viewport visual — o deslocamento já aplicado a joga para fora por cima, e sobra
o `body` vazio na tela.

As duas metades:
  1. o defeito sumiu  — no navegador a app continua do tamanho da janela
  2. o recurso vive   — no aplicativo instalado ela ainda encolhe com o teclado

O teclado do sistema não existe em navegador sem cabeça: o que se força é a
altura que o `visualViewport` reportaria com ele aberto, e o foco no campo é
real. `display-mode: standalone` também não é emulável — o `matchMedia` é
trocado pelo mesmo caminho que o componente lê.

    PROVA_URL=http://127.0.0.1:3008/agente/daniel  # a 3008 reprova a metade 1
"""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = os.environ.get("PROVA_URL", "http://127.0.0.1:3009/agente/daniel")
SAIDA = Path(os.environ.get("PROVA_SAIDA", "/home/clawd/provas")) / "cockpit-teclado"

JANELA = 900
COM_TECLADO = 380


# Roda antes do bundle: o componente lê `visualViewport.height` e `matchMedia`
# uma vez só, na montagem.
def preparo(standalone: bool) -> str:
    return f"""
    Object.defineProperty(window.visualViewport, 'height', {{
      configurable: true,
      get: () => window.__alturaVisual ?? window.innerHeight,
    }});
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      q.includes('standalone') ? {{ matches: {str(standalone).lower()}, media: q,
        addEventListener() {{}}, removeEventListener() {{}} }} : real(q);
    """


def altura_da_app(pag) -> int:
    pag.goto(URL, wait_until="domcontentloaded")
    campo = pag.locator("textarea").first
    campo.wait_for(state="visible", timeout=15000)
    campo.click()
    # O teclado sobe: o viewport visual encolhe e o componente é notificado.
    pag.evaluate(
        f"window.__alturaVisual = {COM_TECLADO};"
        "window.visualViewport.dispatchEvent(new Event('resize'))"
    )
    pag.wait_for_timeout(300)
    return pag.evaluate(
        "() => Math.round("
        "document.querySelector('main').parentElement.getBoundingClientRect().height)"
    )


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    medida = {}
    with sync_playwright() as p:
        nav = p.chromium.launch()
        for rotulo, standalone in (("navegador", False), ("aplicativo", True)):
            pag = nav.new_page(viewport={"width": 393, "height": JANELA})
            pag.add_init_script(preparo(standalone))
            medida[rotulo] = altura_da_app(pag)
            pag.screenshot(path=str(SAIDA / f"{rotulo}.png"))
            pag.close()
        nav.close()

    metade1 = medida["navegador"] == JANELA
    metade2 = medida["aplicativo"] == COM_TECLADO
    print(f"navegador  : app com {medida['navegador']}px, esperado {JANELA}")
    print(f"aplicativo : app com {medida['aplicativo']}px, esperado {COM_TECLADO}")
    print(f"1. defeito sumiu (navegador nao encolhe) : {'OK' if metade1 else 'FALHOU'}")
    print(f"2. recurso vive (aplicativo encolhe)     : {'OK' if metade2 else 'FALHOU'}")
    raise SystemExit(0 if metade1 and metade2 else 1)


if __name__ == "__main__":
    main()
