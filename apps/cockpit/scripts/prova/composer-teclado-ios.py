"""Prova dirigida — o composer saía da tela quando o teclado abria no iPhone.

Dois defeitos, a mesma causa: publicar em `--ck-viewport-altura` um número medido
em JS enquanto o navegador tem `100dvh`, que ele mantém certo sozinho.

  1. teclado — o número seguia o viewport visual e encolhia a app. No Safari
     quem tira o campo de trás do teclado é o próprio browser, deslocando a
     página; encolher depois disso joga a app para fora por cima.
  2. número velho — a barra do Safari cresce e encolhe sem disparar `resize`
     confiável, então o número envelhece calado. A app fica mais alta que a área
     visível, o documento ganha rolagem, e é por ela que o composer sobe. Era o
     que o Rica via ao voltar de outro agente: nada remontou, só o número era de
     antes. Puxar a página para baixo devolvia a barra ao estado medido.

Nenhum dos dois existe em navegador sem cabeça: o que se força é o que o
`visualViewport` e o `innerHeight` reportariam. `display-mode: standalone`
também não é emulável — o `matchMedia` é trocado pelo caminho que o componente lê.

    PROVA_URL=http://127.0.0.1:3008/agente/daniel  # a 3008 de antes reprova
"""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = os.environ.get("PROVA_URL", "http://127.0.0.1:3009/agente/daniel")
SAIDA = Path(os.environ.get("PROVA_SAIDA", "/home/clawd/provas")) / "cockpit-teclado"

JANELA = 900
COM_TECLADO = 380
# A barra do Safari retraída dá uma janela mais alta do que a que volta depois.
BARRA_RETRAIDA = 1010
# Medidos no iPhone do Rica em 12/08, aplicativo instalado, teclado aberto: o
# iOS encolhe a janela E desloca a página, e o viewport visual já vem descontado
# do deslocamento. Quem publica o visual tira 206px que existem.
APP_JANELA = 655
APP_VISUAL = 449
# A janela do aplicativo ainda abrindo: no iPhone do Rica, 793 numa tela de 852.
ABRINDO = 793


# Roda antes do bundle: o componente lê `matchMedia` uma vez, na montagem.
def preparo(standalone: bool) -> str:
    return f"""
    Object.defineProperty(window.visualViewport, 'height', {{
      configurable: true,
      get: () => window.__alturaVisual ?? window.innerHeight,
    }});
    Object.defineProperty(window, 'innerHeight', {{
      configurable: true,
      get: () => window.__alturaDaJanela ?? {JANELA},
    }});
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      q.includes('standalone') ? {{ matches: {str(standalone).lower()}, media: q,
        addEventListener() {{}}, removeEventListener() {{}} }} : real(q);
    """


MEDE = """() => ({
  app: Math.round(
    document.querySelector('main').parentElement.getBoundingClientRect().height),
  folgaDeRolagem: Math.round(
    document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight),
})"""


def abre(nav, standalone: bool):
    pag = nav.new_page(viewport={"width": 393, "height": JANELA})
    pag.add_init_script(preparo(standalone))
    pag.goto(URL, wait_until="domcontentloaded")
    pag.locator("textarea").first.wait_for(state="visible", timeout=15000)
    return pag


def com_teclado(nav, standalone: bool) -> dict:
    pag = abre(nav, standalone)
    pag.locator("textarea").first.click()
    # No navegador a janela não se mexe; no aplicativo instalado ela encolhe
    # junto, e é ela a régua.
    janela = f"window.__alturaDaJanela = {APP_JANELA};" if standalone else ""
    visual = APP_VISUAL if standalone else COM_TECLADO
    pag.evaluate(
        f"{janela}window.__alturaVisual = {visual};"
        "window.visualViewport.dispatchEvent(new Event('resize'));"
        "window.dispatchEvent(new Event('resize'))"
    )
    pag.wait_for_timeout(300)
    medida = pag.evaluate(MEDE)
    pag.close()
    return medida


def com_numero_velho(nav) -> dict:
    pag = abre(nav, standalone=False)
    # A app nasce com a barra retraída e a barra volta sem avisar ninguém.
    pag.evaluate(f"window.__alturaDaJanela = {BARRA_RETRAIDA}")
    pag.evaluate("window.dispatchEvent(new Event('resize'))")
    pag.evaluate("window.__alturaDaJanela = undefined")
    pag.wait_for_timeout(300)
    medida = pag.evaluate(MEDE)
    pag.close()
    return medida


def janela_cresce_calada(nav) -> dict:
    """A janela do aplicativo termina de abrir depois da primeira medida e não
    dispara `resize` — o Rica tinha de puxar a tela com o dedo para acertar. O
    elemento raiz acompanha o viewport, então mexer nele é o sinal que sobra."""
    pag = nav.new_page(viewport={"width": 393, "height": JANELA})
    pag.add_init_script(preparo(standalone=True))
    pag.add_init_script(f"window.__alturaDaJanela = {ABRINDO};")
    pag.goto(URL, wait_until="domcontentloaded")
    pag.locator("textarea").first.wait_for(state="visible", timeout=15000)
    # A janela termina de abrir. Nenhum evento de janela é emitido: o único
    # sinal é o elemento raiz mudando de tamanho.
    pag.evaluate(
        "window.__alturaDaJanela = undefined;"
        "document.documentElement.style.minHeight = '1px'"
    )
    pag.wait_for_timeout(300)
    medida = pag.evaluate(MEDE)
    pag.close()
    return medida


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        nav = p.chromium.launch()
        navegador = com_teclado(nav, standalone=False)
        velho = com_numero_velho(nav)
        aplicativo = com_teclado(nav, standalone=True)
        crescendo = janela_cresce_calada(nav)
        nav.close()

    metades = [
        ("teclado no navegador nao encolhe a app", navegador["app"] == JANELA),
        ("teclado no navegador nao abre rolagem", navegador["folgaDeRolagem"] == 0),
        ("barra do Safari nao estica a app", velho["app"] == JANELA),
        ("barra do Safari nao abre rolagem", velho["folgaDeRolagem"] == 0),
        ("aplicativo encolhe pela janela, nao pelo visual", aplicativo["app"] == APP_JANELA),
        ("janela que cresce calada e alcancada", crescendo["app"] == JANELA),
    ]
    print(f"navegador com teclado : {navegador}, esperado app {JANELA}")
    print(f"navegador com o numero velho : {velho}, esperado app {JANELA}")
    print(f"aplicativo com teclado : {aplicativo}, esperado app {APP_JANELA}")
    print(f"janela crescendo calada : {crescendo}, esperado app {JANELA}")
    for rotulo, passou in metades:
        print(f"{'OK    ' if passou else 'FALHOU'} {rotulo}")
    raise SystemExit(0 if all(passou for _, passou in metades) else 1)


if __name__ == "__main__":
    main()
