"""Um clique curto no microfone ABRE a gravação e ela FICA — nada pisca.

Rica, 20/08, depois de testar o que estava no ar:

> *"Se eu der um clique curto, ele não pode piscar desse jeito. Eu não vi
> nenhum chat que faz isso. Isso aí é um composer amador. Eu não quero que o
> texto pisque pra mim em cima do composer, aquele texto não me importa."*

O que ele viu: o clique abria a gravação, o piso de 1s da F1 (`PISO_SEGUNDOS`)
jogava fora na hora do `pointerup`, e a tela ia e voltava — placeholder `""` ->
`Ouvindo…` -> `""`, com o aviso "muito curto" acendendo em cima da caixa e só
apagando no clique SEGUINTE. Quatro cliques, quatro idas e voltas.

O PADRÃO QUE A DOC MANDA. React Aria (`react-aria.adobe.com/useLongPress`) é
explícita: pressão curta e pressão longa são DUAS AÇÕES DISTINTAS no mesmo
alvo, e o exemplo canônico da própria doc mescla `usePress` com `useLongPress`
no mesmo botão — a curta faz uma coisa, a longa faz outra. Em lugar nenhum a
curta é uma longa que falhou. Traduzido para cá:

  - toque curto  -> grava sem segurar (a trava, que já existia) — é o gesto do
                    claude.ai, a referência que o Rica mandou;
  - segurar      -> push-to-talk, com arrastar para cancelar/travar;
  - tocar de novo em cima da gravação travada -> encerra. É toggle, e toggle
                    não pisca: cada troca de estado tem um dedo por trás.

A RÉGUA. Quatro rodadas do gesto exato que ele fez: clique curto, ler 1,4s
depois — tempo de sobra para qualquer volta espontânea já ter acontecido — e
sair pela porta EXPLÍCITA (o botão Descartar) antes da rodada seguinte. Sair
pelo ⏹ não serviria: 1,4s de gravação já passa do piso e o toque viraria um
envio de verdade, e aí a bancada estaria medindo STT em vez de tela.

As duas metades: exigir gravação em TODAS as rodadas é o que impede esta
bancada de passar VAZIA — botão morto (clique que não faz nada) reprova aqui, e
"não piscar" sozinho um botão morto cumpriria. E entre o clique e a leitura a
onda não pode ter subido e descido: o pisca vive aí dentro.

Lê o que o OLHO vê, nunca a fase que o componente declara: opacidade da face da
onda, `placeholder` do campo, e a existência do botão de dispensar o aviso.

Uso: python3 clique-curto-nao-pisca.py <porta> [slug]
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
slug = sys.argv[2] if len(sys.argv) > 2 else "canarinho"

VIEWPORT = {"width": 390, "height": 844}

CLIQUES = 4
# Curto de verdade: bem abaixo do `PISO_SEGUNDOS` de 1s, que é o que separava
# "toque acidental" de fala no build que ele reprovou.
DURACAO_DO_CLIQUE_MS = 120
# Depois disto o ciclo já se acomodou: `getUserMedia` voltou, o `MediaRecorder`
# ligou, e uma volta espontânea já teria acontecido.
ESPERA_ATE_LER_MS = 1_400

AMOSTRADOR = """
(() => {
  window.__quadros = [];
  const tick = () => {
    const face = document.querySelector('.ck-troca-da-fala-face[data-face="onda"]');
    const campo = document.querySelector('form textarea');
    window.__quadros.push({
      t: performance.now(),
      onda: face ? Number(getComputedStyle(face).opacity) > 0.5 : false,
      ouvindo: campo ? campo.placeholder === 'Ouvindo…' : false,
      aviso: !!document.querySelector('button[aria-label="Dispensar aviso do microfone"]'),
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
"""

falhas: list[str] = []

with sync_playwright() as p:
    navegador = p.chromium.launch(
        channel="chrome",
        args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    )
    contexto = navegador.new_context(viewport=VIEWPORT, permissions=["microphone"])
    pagina = contexto.new_page()
    # Nada de STT nesta bancada — e nada de `abort` tampouco: rota abortada
    # fabricaria a falha da fala, e o aviso que ela acende contaminaria a
    # contagem. Toda rodada sai pelo Descartar, então nenhum áudio parte.
    pagina.route("**/api/agents/*/transcription", lambda rota: rota.abort())
    pagina.goto(f"http://127.0.0.1:{porta}/agente/{slug}", wait_until="domcontentloaded")
    pagina.wait_for_timeout(4_000)

    microfone = pagina.locator('button[aria-label*="Segure para falar"]').first
    try:
        microfone.wait_for(state="visible", timeout=20_000)
    except Exception:
        pagina.screenshot(path=f"/tmp/prova-clique-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: microfone ausente no repouso — nada foi encenado")
        navegador.close()
        sys.exit(2)

    if pagina.locator('.ck-troca-da-fala-face[data-face="onda"]').count() == 0:
        pagina.screenshot(path=f"/tmp/prova-clique-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: a face da onda não está na tela — o amostrador leria vazio")
        navegador.close()
        sys.exit(2)

    pagina.evaluate(AMOSTRADOR)

    caixa = microfone.bounding_box()
    centro = (caixa["x"] + caixa["width"] / 2, caixa["y"] + caixa["height"] / 2)
    pagina.mouse.move(*centro)

    leituras: list[dict] = []
    for _ in range(CLIQUES):
        marca = pagina.evaluate("() => performance.now()")
        pagina.mouse.down()
        pagina.wait_for_timeout(DURACAO_DO_CLIQUE_MS)
        pagina.mouse.up()
        pagina.wait_for_timeout(ESPERA_ATE_LER_MS)
        estado = pagina.evaluate(
            """() => {
              const face = document.querySelector('.ck-troca-da-fala-face[data-face="onda"]');
              const campo = document.querySelector('form textarea');
              return {
                onda: face ? Number(getComputedStyle(face).opacity) > 0.5 : false,
                ouvindo: campo ? campo.placeholder === 'Ouvindo…' : false,
                fim: performance.now(),
              };
            }"""
        )
        leituras.append({"marca": marca, **estado})

        # A PORTA EXPLÍCITA. Encerrar pelo ⏹ mandaria o áudio de verdade — 1,4s
        # já passa do piso —, e a rodada seguinte cairia em `transcrevendo`, com
        # o microfone desabilitado. Descartar sai sem despachar nada.
        descartar = pagina.locator('button[aria-label="Descartar áudio"]')
        if descartar.count():
            descartar.first.click()
            pagina.wait_for_timeout(700)

        # O microfone anda alguns pixels entre gravando e repouso. Sem remirar,
        # o clique seguinte cai ao lado e a bancada mediria um botão que
        # ninguém apertou.
        nova = pagina.locator('form button[aria-label*="Segure para falar"]').first.bounding_box()
        if nova:
            centro = (nova["x"] + nova["width"] / 2, nova["y"] + nova["height"] / 2)
            pagina.mouse.move(*centro)

    quadros = pagina.evaluate("() => window.__quadros")
    foto = f"/tmp/prova-clique-curto-{porta}.png"
    pagina.screenshot(path=foto)
    navegador.close()

# 1. A METADE QUE IMPEDE O VERDE VAZIO: o clique tem de ABRIR a gravação, e ela
#    tem de estar de pé 1,4s depois.
for indice, leitura in enumerate(leituras, start=1):
    if leitura["onda"] and leitura["ouvindo"]:
        print(f"ok  clique {indice}: gravando 1,4s depois — a gravação ficou")
    else:
        falhas.append(
            f"clique {indice}: a gravação NÃO ficou — onda={leitura['onda']} "
            f"placeholder-ouvindo={leitura['ouvindo']}. É o pisca."
        )

# 2. E NÃO PODE TER IDO E VOLTADO NO CAMINHO. A leitura acima pega o depois; o
#    pisca mora no meio, e é onde a onda sobe e desce dentro da mesma rodada.
for indice, leitura in enumerate(leituras, start=1):
    janela = [q for q in quadros if leitura["marca"] <= q["t"] <= leitura["fim"]]
    recuos = sum(1 for a, b in zip(janela, janela[1:]) if a["onda"] and not b["onda"])
    if recuos:
        falhas.append(
            f"clique {indice}: a onda subiu e desceu {recuos}× dentro da rodada, "
            f"sem ninguém pedir ({len(janela)} quadros)"
        )

# 3. NENHUM TEXTO EM CIMA DA CAIXA, em quadro nenhum do ciclo inteiro.
piscadas = sum(
    1
    for anterior, atual in zip(quadros, quadros[1:])
    if not anterior["aviso"] and atual["aviso"]
)
if piscadas:
    falhas.append(f"o aviso em cima da caixa acendeu {piscadas}× — o texto que ele não quer ver")
else:
    print(f"ok  nenhum aviso acendeu em {len(quadros)} quadros amostrados")

print(f"print em {foto}")

if falhas:
    print("\nREPROVOU")
    for f in falhas:
        print(f"  - {f}")
    sys.exit(1)

print("\nPASSOU")
