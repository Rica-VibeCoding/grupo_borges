"""A janela encolheu 59px e a tela não: a app ainda encosta no teclado?

O modo de 793 do WebKit em `standalone`. Medido na `/diagnostico` do iPhone do
Rica em 13/08, em repouso e com a tela PARADA: `100dvh` "viu 793–852" enquanto
o `100lvh` ficou cravado em 852 — e o `innerHeight` e o viewport visual
oscilaram junto com o `dvh`. São os 59px da faixa da status bar.

Com o teclado em cena isso envenena a soma do compositor: se o visual é
reportado dentro da janela encolhida, `visual + deslocamento` nasce 59px curta e
o composer para 59px ACIMA do teclado — a folga que o Rica filmou no IMG_7706.

A bancada encena exatamente isso: viewport visual de 390 (= 449 − 59) com
panorâmica de 216, e a sonda do `100dvh` forçada a 793 enquanto a do `100lvh`
segue medindo a janela real. A app tem que publicar 665 assim mesmo.

Uso: python3 altura-com-a-janela-encolhida.py <porta> [segundos]
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
segundos = int(sys.argv[2]) if len(sys.argv) > 2 else 4

VISUAL_ENCOLHIDO = 390
PANORAMICA = 216
JANELA_ENCOLHIDA = 793
ESPERADA = 665  # 390 + 216 + (852 − 793)

FINGE_JANELA_ENCOLHIDA = f"""
Object.defineProperty(navigator, 'standalone', {{ get: () => true }});
const fake = {{
  height: {VISUAL_ENCOLHIDO},
  offsetTop: {PANORAMICA},
  width: 390,
  offsetLeft: 0,
  scale: 1,
  addEventListener() {{}},
  removeEventListener() {{}},
}};
Object.defineProperty(window, 'visualViewport', {{ get: () => fake }});
"""

# A sonda do `dvh` presa no modo encolhido — o `lvh` continua medindo a tela.
ENCOLHE_A_SONDA = f'[data-sonda="janela"] {{ height: {JANELA_ENCOLHIDA}px !important }}'

with sync_playwright() as p:
    navegador = p.chromium.launch()
    ctx = navegador.new_context(viewport={"width": 390, "height": 852})
    ctx.add_init_script(FINGE_JANELA_ENCOLHIDA)
    pagina = ctx.new_page()
    pagina.goto(f"http://127.0.0.1:{porta}/agente/pavan", wait_until="domcontentloaded")
    pagina.add_style_tag(content=ENCOLHE_A_SONDA)
    pagina.wait_for_timeout(segundos * 1000)

    sondas = pagina.evaluate(
        "() => [...document.querySelectorAll('[data-sonda]')].map(el =>"
        " `${el.dataset.sonda} ${Math.round(el.getBoundingClientRect().height)}`)"
    )
    campo = pagina.query_selector("textarea")
    if not campo:
        print("FALHA: não achei o textarea do composer")
        sys.exit(1)
    campo.click()
    pagina.wait_for_timeout(2_000)

    variavel = pagina.evaluate(
        "() => document.documentElement.style.getPropertyValue('--ck-viewport-altura')"
    ).strip()
    app = pagina.evaluate(
        "() => Math.round(document.querySelector('body .ck-janela').getBoundingClientRect().height)"
    )

    ctx.close()
    navegador.close()

print(f"== janela encolhida encenada (porta {porta})")
print(f"   sondas: {', '.join(sondas) or '(nenhuma — o componente não montou)'}")
print(f"   visual {VISUAL_ENCOLHIDO} + panorâmica {PANORAMICA}, janela {JANELA_ENCOLHIDA}")
print(f"   variável com o campo focado: {variavel or '(ausente)'}")
print(f"   altura da app: {app}px   esperada: {ESPERADA}px")
ok = variavel == f"{ESPERADA}px" and app == ESPERADA
print("\n   " + ("ANCORADA NA TELA — a janela encolheu e a app não", "REPROVOU — a app encolheu junto com a janela")[not ok])
sys.exit(0 if ok else 1)
