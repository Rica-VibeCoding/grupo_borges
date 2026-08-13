"""O teclado do iPhone em bancada: visual 449, panorâmica 216 — a app dá 665?

O regime que reprovou cinco rodadas. O IMG_7705 (13/08) mostrou o composer 11s
atrás do teclado: a escrita firmava `innerHeight`, e o min/max da `/diagnostico`
no IMG_7704 provou que ele NÃO desce com o teclado aberto ("viu 793–852", nunca
655) — atrasado nas duas direções, não só no repouso.

A fonte honesta com teclado é o par do compositor: `visualViewport.height +
offsetTop` (449 + 216 = 665 no aparelho em 12/08). A soma faz "fundo da app =
fundo da área visível" com o "role para revelar" já compensado — panorâmica de
216 ou de 0, aponta o topo do teclado.

Esta bancada encena esse teclado num Chromium: o `visualViewport` passa a
reportar os números do iPhone e o `innerHeight` fica em 852 (o atrasado). Ao
focar o campo, a variável tem que firmar 665 — quem copiar o `innerHeight`
publica 852 e reprova.

Uso: python3 altura-com-teclado-de-pe.py <porta> [segundos]
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
segundos = int(sys.argv[2]) if len(sys.argv) > 2 else 4

VISUAL = 449
PANORAMICA = 216
ESPERADA = VISUAL + PANORAMICA  # 665

FINGE_TECLADO_DO_IPHONE = f"""
Object.defineProperty(navigator, 'standalone', {{ get: () => true }});
const fake = {{
  height: {VISUAL},
  offsetTop: {PANORAMICA},
  width: 390,
  offsetLeft: 0,
  scale: 1,
  addEventListener() {{}},
  removeEventListener() {{}},
}};
Object.defineProperty(window, 'visualViewport', {{ get: () => fake }});
"""

with sync_playwright() as p:
    navegador = p.chromium.launch()
    ctx = navegador.new_context(viewport={"width": 390, "height": 852})
    ctx.add_init_script(FINGE_TECLADO_DO_IPHONE)
    pagina = ctx.new_page()
    pagina.goto(f"http://127.0.0.1:{porta}/agente/pavan", wait_until="domcontentloaded")
    pagina.wait_for_timeout(segundos * 1000)

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
        "() => Math.round(document.querySelector('body [style*=\"--ck-viewport-altura\"]')"
        ".getBoundingClientRect().height)"
    )

    ctx.close()
    navegador.close()

print(f"== teclado do iPhone encenado (porta {porta}): visual {VISUAL} + panorâmica {PANORAMICA}")
print(f"   variável com o campo focado: {variavel or '(ausente)'}")
print(f"   altura da app: {app}px   esperada: {ESPERADA}px")
ok = variavel == f"{ESPERADA}px" and app == ESPERADA
print("\n   " + ("FUNDO DA APP NO TOPO DO TECLADO" if ok else
                 "REPROVOU — copiou o número atrasado, composer atrás do teclado"))
sys.exit(0 if ok else 1)
