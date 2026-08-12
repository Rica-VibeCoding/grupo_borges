"""A régua única da troca de agente: um instrumento, todos os marcos.

Existe porque somar "340ms de servidor" com um número de cliente medido noutra
bancada é declarar vitória numa conta que ninguém rodou. Aqui os quatro marcos
saem da MESMA execução, do mesmo relógio, no mesmo quadro de pintura:

  toque → item acende → URL commita → primeira mensagem pintada

Uso: python3 bancada-ponta-a-ponta.py <porta> <repeticoes> [rotulo]
"""

import statistics
import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
reps = int(sys.argv[2]) if len(sys.argv) > 2 else 6
rotulo = sys.argv[3] if len(sys.argv) > 3 else "baseline"

ALVO = "Daniel Singh"
HREF = "/agente/daniel"

GRAVADOR = """() => {
  window.__linha = [];
  window.__t0 = null;
  const passo = () => {
    if (window.__t0 !== null) {
      window.__linha.push({
        t: performance.now() - window.__t0,
        aceso: !!document.querySelector('a[data-selecionado="true"][href="%s"]'),
        url: location.pathname,
        msgs: document.querySelectorAll('[data-gate-message]').length,
      });
    }
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}""" % HREF


def marco(linha, cond):
    r = next((r for r in linha if cond(r)), None)
    return r["t"] if r else None


colhido = []
with sync_playwright() as p:
    navegador = p.chromium.launch()
    for i in range(reps):
        ctx = navegador.new_context(viewport={"width": 390, "height": 844})
        pagina = ctx.new_page()
        # Contexto novo a cada repetição: o cache de stream do cockpit segura a
        # conversa por 30s, e medir a segunda visita mede o cache, não a troca.
        pagina.goto(f"http://127.0.0.1:{porta}/", wait_until="domcontentloaded")
        pagina.wait_for_selector(f"text={ALVO}", timeout=60_000)
        pagina.wait_for_timeout(2_500)

        pagina.evaluate(GRAVADOR)
        pagina.evaluate("() => { window.__t0 = performance.now(); }")
        pagina.click(f"text={ALVO}", no_wait_after=True)
        pagina.wait_for_timeout(6_000)
        linha = pagina.evaluate("() => window.__linha")
        ctx.close()

        colhido.append(
            {
                "acende": marco(linha, lambda r: r["aceso"]),
                "url": marco(linha, lambda r: r["url"] == HREF),
                "primeira_msg": marco(linha, lambda r: r["msgs"] > 0),
                "quadros": len(linha),
            }
        )
        c = colhido[-1]
        print(
            f"   #{i+1}  acende {c['acende'] and round(c['acende'])}  "
            f"url {c['url'] and round(c['url'])}  "
            f"1a msg {c['primeira_msg'] and round(c['primeira_msg'])}  ({c['quadros']} quadros)"
        )
    navegador.close()

print(f"\n== {rotulo} (porta {porta}, {reps} repeticoes) — tudo em ms")
for chave, nome in (
    ("acende", "item acende"),
    ("url", "URL commita"),
    ("primeira_msg", "1a mensagem pintada"),
):
    vs = [c[chave] for c in colhido if c[chave] is not None]
    if not vs:
        print(f"   {nome:22} NUNCA")
        continue
    faixa = f"{min(vs):.0f}–{max(vs):.0f}"
    print(f"   {nome:22} {faixa:>12}   mediana {statistics.median(vs):.0f}"
          + ("" if len(vs) == reps else f"   (só {len(vs)}/{reps})"))
