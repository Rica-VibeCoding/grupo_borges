"""Por quanto tempo o rótulo do motor fica incompleto ao trocar de agente.

O Rica filmou "uma picotada" na troca (IMG_7699, 12/08). Um dos picotes é o
rótulo do composer: ele nasce com o NOME do modelo e ganha o NÍVEL de esforço
depois, num segundo pedido — e quando o nível entra, o nome anda para a
esquerda.

Mede em `requestAnimationFrame` o texto do próprio gatilho do seletor, então o
número é o que a tela mostrou, não o que a rede respondeu.

Uso: python3 picote-do-rotulo-do-motor.py <porta> <destino> <reps> [origem] [latência_ms]

Dois cuidados que mudam a resposta:

- **O sentido.** O Claude não tem esforço na rota (só no `/painel`); o Codex e o
  Kimi têm. Medir um sentido responde por um motor só.
- **A latência.** Em `127.0.0.1` o `/painel` responde em 52ms e ganha a corrida
  contra a montagem do composer, então o rótulo nasce pronto e o picote some da
  medição. O Rica está no iPhone, pela Tailscale, no 5G. Sem impor latência,
  esta bancada mede a VPS, não o aparelho dele.
"""

import statistics
import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
destino = sys.argv[2] if len(sys.argv) > 2 else "tara"
reps = int(sys.argv[3]) if len(sys.argv) > 3 else 6
origem = sys.argv[4] if len(sys.argv) > 4 else "pavan"
latencia = int(sys.argv[5]) if len(sys.argv) > 5 else 0

NOMES = {"tara": "Tara Kaur", "daniel": "Daniel Singh", "pavan": "José Pavan", "hiro": "Hiro Tanaka"}
ALVO = NOMES.get(destino, destino)

# NÃO procurar `button[aria-label^="Configurar modelo"]`: enquanto o painel não
# responde o rótulo NÃO é um botão — é um `div` de texto, com fonte menor e sem
# o `⌄`. Uma sonda que só enxerga o botão só enxerga o depois, e jura que o
# rótulo nasceu pronto. Aqui a âncora é o texto do modelo, então os dois estados
# entram; `tag` e `fonte` são o que denuncia a troca de forma.
# Quem diz de QUAL agente é a tela é o placeholder do campo ("Mensagem para X").
GRAVADOR = """() => {
  window.__linha = [];
  window.__t0 = null;
  const MOTOR = /^(Opus|Sonnet|Haiku|GPT|K3|Kimi)/;
  const passo = () => {
    if (window.__t0 !== null) {
      const el = [...document.querySelectorAll('button, div')].find(
        (e) => e.children.length > 0 && e.innerText.length < 40 && MOTOR.test(e.innerText.trim()),
      );
      const campo = document.querySelector('textarea');
      window.__linha.push({
        t: performance.now() - window.__t0,
        de: campo ? campo.getAttribute('placeholder') : null,
        texto: el ? el.innerText.replace(/\\s+/g, ' ').trim() : null,
        tag: el ? el.tagName : null,
        fonte: el ? getComputedStyle(el).fontSize : null,
      });
    }
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}"""


def analisa(linha, alvo):
    """Não inventa critério de "completo" — reporta a SEQUÊNCIA de textos que o
    rótulo do agente novo mostrou. Se ele nasce pronto, é um texto só; se pinta
    em etapas, cada etapa aparece com o instante em que entrou. Um critério
    adivinhado ("tem duas palavras") mediria a régua, não a tela: "GPT-5.6
    Terra" já tem duas."""
    do_alvo = [r for r in linha if r["de"] and alvo in r["de"]]
    if not do_alvo:
        return None
    etapas = []
    for r in do_alvo:
        marca = (r["texto"], r["tag"], r["fonte"])
        if not etapas or etapas[-1][1] != marca:
            etapas.append((r["t"], marca))
    picote = None if len(etapas) < 2 else etapas[-1][0] - etapas[0][0]
    return {"surge": etapas[0][0], "etapas": etapas, "picote": picote}


colhido = []
with sync_playwright() as p:
    navegador = p.chromium.launch()
    for i in range(reps):
        ctx = navegador.new_context(viewport={"width": 390, "height": 844})
        pagina = ctx.new_page()
        if latencia:
            cdp = ctx.new_cdp_session(pagina)
            cdp.send("Network.enable")
            cdp.send(
                "Network.emulateNetworkConditions",
                {
                    "offline": False,
                    "latency": latencia,
                    "downloadThroughput": 4_000_000 // 8,
                    "uploadThroughput": 1_000_000 // 8,
                },
            )
        pagina.goto(f"http://127.0.0.1:{porta}/agente/{origem}", wait_until="domcontentloaded")
        pagina.wait_for_selector("button[aria-label^='Configurar modelo']", timeout=60_000)
        pagina.wait_for_timeout(3_000)

        pagina.evaluate(GRAVADOR)
        pagina.evaluate("() => { window.__t0 = performance.now(); }")
        pagina.click("[aria-label='Abrir lista de agentes']")
        pagina.wait_for_timeout(900)
        pagina.click(f"text={ALVO}", no_wait_after=True)
        pagina.wait_for_timeout(7_000)
        r = analisa(pagina.evaluate("() => window.__linha"), ALVO)
        ctx.close()

        colhido.append(r)
        if r is None:
            print(f"   #{i+1}  rótulo do {ALVO} NUNCA apareceu")
        else:
            print(f"   #{i+1}  surge {r['surge']:.0f} ms   {len(r['etapas'])} etapa(s)")
            for t, (texto, tag, fonte) in r["etapas"]:
                print(f"          {t:7.0f} ms  <{tag}> {fonte}  {texto!r}")
    navegador.close()

vs = [c["picote"] for c in colhido if c and c["picote"] is not None]
print(f"\n== picote do rótulo até {ALVO} (porta {porta}, {reps} repetições)")
if vs:
    print(f"   pintou em etapas em {len(vs)}/{reps}   do 1º ao último texto: "
          f"{min(vs):.0f}–{max(vs):.0f} ms   mediana {statistics.median(vs):.0f} ms")
else:
    print(f"   nasceu pronto nas {reps} repetições — nenhum rótulo mudou de texto")
