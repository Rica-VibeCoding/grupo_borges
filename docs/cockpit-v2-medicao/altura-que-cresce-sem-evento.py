"""O aparelho do Rica em bancada: a janela é 852, e o `innerHeight` MENTE 793.

Quatro rodadas do mesmo defeito (9e522ab → dd23112 → 61d9846 → 6f0fd4c) até a
causa fechar: depois que o teclado do aplicativo instalado fecha, o WebKit deixa
`window.innerHeight` preso em 793 (852 − 59, a faixa da status bar em
`black-translucent` — developer.apple.com, Configuring Web Applications) até o
próximo GESTO na tela. A pintura volta sozinha; o número não. É família
conhecida no WebKit (bugs 301857, 170595) e nenhum evento dispara na volta.

Toda variante que copiava `innerHeight` para a variável — no evento, por 1s,
em ronda de 500ms — só copiava a mentira mais depressa. O vídeo do Rica
(IMG_7701, 13/08): composer 60pt acima do fundo em repouso, voltando no
instante do arraste.

O contrato novo que esta bancada prova: SEM campo focado, a variável não
existe e quem manda é o `100dvh` do CSS — que a pintura do aparelho comprova
correto em repouso ("no início funcionava": o layout foi `h-dvh` puro de
526aba7 até 9e522ab sem composer subido). A app tem que medir a JANELA, não o
número mentiroso.

Uso: python3 altura-que-cresce-sem-evento.py <porta> [segundos-de-espera]
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
espera = int(sys.argv[2]) if len(sys.argv) > 2 else 3

JANELA_REAL = 852  # o que o iPhone 15 pinta em repouso
MENTIRA = 793  # o que window.innerHeight reporta no estado preso

# Antes de qualquer script da página:
# - `navigator.standalone` põe o componente no ramo do aplicativo instalado;
# - `innerHeight` passa a devolver a mentira do estado preso;
# - os engolidores em CAPTURA cortam todo aviso antes de o componente ver,
#   que é o silêncio real do WebKit (lá o evento simplesmente não existe).
FINGE_ESTADO_PRESO = f"""
Object.defineProperty(navigator, 'standalone', {{ get: () => true }});
Object.defineProperty(window, 'innerHeight', {{ get: () => {MENTIRA} }});
window.__engoliu = 0;
const engole = (e) => {{ window.__engoliu++; e.stopImmediatePropagation(); }};
for (const nome of ['resize', 'orientationchange', 'focusin', 'focusout',
                    'pageshow', 'visibilitychange']) {{
  window.addEventListener(nome, engole, true);
  document.addEventListener(nome, engole, true);
}}
if (window.visualViewport) {{
  window.visualViewport.addEventListener('resize', engole, true);
  window.visualViewport.addEventListener('scroll', engole, true);
}}
"""

with sync_playwright() as p:
    navegador = p.chromium.launch()
    ctx = navegador.new_context(viewport={"width": 390, "height": JANELA_REAL})
    ctx.add_init_script(FINGE_ESTADO_PRESO)
    pagina = ctx.new_page()
    pagina.goto(f"http://127.0.0.1:{porta}/agente/pavan", wait_until="domcontentloaded")
    pagina.wait_for_timeout(espera * 1000)

    variavel = pagina.evaluate(
        "() => document.documentElement.style.getPropertyValue('--ck-viewport-altura')"
    ).strip()
    # A régua é o quadro que o Rica vê: a caixa da app — a div que CONSOME a
    # variável. O `body ` na frente importa: quando a variável está publicada,
    # ela mora no style do `<html>`, e um seletor sem escopo mede o html.
    app = pagina.evaluate(
        "() => Math.round(document.querySelector('body .ck-janela')"
        ".getBoundingClientRect().height)"
    )
    engoliu = pagina.evaluate("() => window.__engoliu")

    ctx.close()
    navegador.close()

vao = JANELA_REAL - app

print(f"== repouso com innerHeight mentindo {MENTIRA} numa janela de {JANELA_REAL} (porta {porta})")
print(f"   eventos engolidos no caminho: {engoliu}")
print(f"   variável publicada: {variavel or '(ausente — CSS no comando)'}")
print(f"   altura da app: {app}px   janela: {JANELA_REAL}px")
print(f"\n   sobra embaixo da app: {vao}px")
print("   " + ("APP NA JANELA — imune à mentira" if vao == 0 else
               f"COMPOSER SUBIDO {vao}pt — copiou a mentira, como nas 4 rodadas"))

sys.exit(0 if vao == 0 else 1)
