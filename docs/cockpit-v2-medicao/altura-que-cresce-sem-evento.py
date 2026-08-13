"""A janela cresce e NENHUM evento avisa — a variável acompanha?

O `61d9846` passou a reler `window.innerHeight` por ~1s depois de cada evento,
partindo de que sempre existe um evento por perto. O vídeo do Rica (IMG_7701,
13/08 00h11, aplicativo instalado) mostra que nem sempre existe: por 2,2s o
composer fica 60pt acima do fundo, e só volta ao lugar quando ele ARRASTA a tela
— o arraste é que dispara o evento que abre a releitura. Parado, fica errado.

Esta bancada reproduz esse cenário no Chromium: a janela muda de tamanho com os
eventos engolidos antes de o componente vê-los, que é o que o WebKit faz de graça
quando devolve a altura depois da janela de releitura ter expirado.

Uso: python3 altura-que-cresce-sem-evento.py <porta> [segundos-de-espera]
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
espera = int(sys.argv[2]) if len(sys.argv) > 2 else 3

ALTURA_ENCOLHIDA = 793  # o que o iPhone do Rica reporta antes de devolver
ALTURA_DEVOLVIDA = 852  # o que ele reporta depois, calado

# Dois enxertos, ambos antes de qualquer script da página:
#
# 1. `navigator.standalone` — sem ele o componente fica no ramo do navegador e
#    nem publica a variável (lá quem manda é o `100dvh` do CSS).
# 2. Os engolidores — listener em CAPTURA registrado antes do componente, então
#    roda antes e corta a propagação. É assim que se reproduz "cresce calada"
#    num navegador que, ao contrário do WebKit, avisa direito.
FINGE_APLICATIVO_SURDO = f"""
Object.defineProperty(navigator, 'standalone', {{ get: () => true }});
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
    ctx = navegador.new_context(viewport={"width": 390, "height": ALTURA_ENCOLHIDA})
    ctx.add_init_script(FINGE_APLICATIVO_SURDO)
    pagina = ctx.new_page()
    pagina.goto(f"http://127.0.0.1:{porta}/agente/pavan", wait_until="domcontentloaded")
    pagina.wait_for_timeout(espera * 1000)

    def publicada() -> str:
        return pagina.evaluate(
            "() => document.documentElement.style.getPropertyValue('--ck-viewport-altura')"
        ).strip()

    antes = publicada()
    janela_antes = pagina.evaluate("() => window.innerHeight")

    # A janela cresce. Os eventos são engolidos no caminho, exatamente como no
    # aparelho — lá eles simplesmente não chegam.
    pagina.set_viewport_size({"width": 390, "height": ALTURA_DEVOLVIDA})
    pagina.wait_for_timeout(espera * 1000)

    depois = publicada()
    janela_depois = pagina.evaluate("() => window.innerHeight")
    engoliu = pagina.evaluate("() => window.__engoliu")

    ctx.close()
    navegador.close()

vao = janela_depois - int(depois.replace("px", "") or 0)

print(f"== a janela cresceu sem avisar (porta {porta})")
print(f"   eventos engolidos no caminho: {engoliu}")
print(f"   antes    janela {janela_antes}   variável {antes or '(vazia)'}")
print(f"   depois   janela {janela_depois}   variável {depois or '(vazia)'}")
print(f"\n   sobra embaixo da app: {vao}px")
print("   " + ("ACOMPANHOU" if depois == f"{janela_depois}px" else
               f"FICOU PRESA — é o composer subindo {vao}pt, como no vídeo"))

sys.exit(0 if depois == f"{janela_depois}px" else 1)
