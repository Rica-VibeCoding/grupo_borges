"""A troca da fala tem de INTERPOLAR, e a narração de fase não pode aparecer.

Duas ordens do Rica no mesmo vídeo de 20/08, depois de testar a F2.4:

1. *"na hora que eu clico, aparece tipo umas frases em cima do composer, eu
   acho que não precisaria ter essa UI"* — `transcrevendo…` repetia o que o fio
   na base da caixa já diz. A linha continua existindo para leitor de tela
   (`sr-only`), e é isso que esta régua separa: sumir dos OLHOS não é sumir da
   árvore de acessibilidade.
2. *"a transição entre uma coisa e outra tem que respeitar um certo slow, que é
   o que a gente tem na hora que a gente abre o painel, senão fica duro"* — a
   onda entrava no lugar dos chips de estalo, porque era um ternário e o lado
   que sai era removido do DOM.

A PROVA DO SLOW NÃO É LER `transition-duration`. Declarar 200ms e trocar por
`display` daria verde na declaração e estalo na tela. Quem prova é a AMOSTRA:
um `requestAnimationFrame` guarda a opacidade das duas faces quadro a quadro
durante o gesto, e a régua exige valor ESTRITAMENTE entre 0 e 1 — algo que só
existe se houver interpolação de verdade. Estalo produz uma série de zeros e
uns e nada no meio.

Encena o ciclo sem gastar STT e sem despachar nada: microfone falso do Chrome,
`POST /transcription` interceptado e solto com texto de mentira, que cai no
rascunho e para ali.

Uso: python3 troca-da-fala-nao-e-de-estalo.py <porta> [slug]
"""

import json
import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
slug = sys.argv[2] if len(sys.argv) > 2 else "canarinho"

VIEWPORT = {"width": 390, "height": 844}

# Quanto a opacidade precisa se afastar das pontas para contar como quadro DO
# MEIO. 0.05 absorve o primeiro e o último quadro da curva, onde a `--ck-ease`
# quase não saiu do lugar.
MARGEM = 0.05

# `sr-only` recorta o nó em 1px. Acima disso a linha voltou a pintar.
LARGURA_MUDA = 2.0

AMOSTRADOR = """
(() => {
  window.__amostras = { onda: [], acoes: [] };
  const tick = () => {
    for (const face of ['onda', 'acoes']) {
      const el = document.querySelector(`.ck-troca-da-fala-face[data-face="${face}"]`);
      if (el) window.__amostras[face].push(Number(getComputedStyle(el).opacity));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
"""

PORTAO_DO_MICROFONE = """
(() => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let abre;
  const portao = new Promise((resolve) => { abre = resolve; });
  window.__liberaMicrofone = () => abre();
  navigator.mediaDevices.getUserMedia = async (restricoes) => {
    await portao;
    return original(restricoes);
  };
})();
"""

falhas: list[str] = []
preso: dict[str, object] = {"rota": None}

with sync_playwright() as p:
    navegador = p.chromium.launch(
        channel="chrome",
        args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    )
    contexto = navegador.new_context(viewport=VIEWPORT, permissions=["microphone"])
    contexto.add_init_script(PORTAO_DO_MICROFONE)
    pagina = contexto.new_page()
    # A F3 abre um canal ao vivo com a OpenAI ao começar a gravar. Esta bancada
    # mede TELA, não fala: recusar o bilhete derruba o composer no caminho de
    # arquivo, que é exatamente o que ela sempre mediu.
    pagina.route("**/transcription/live-token", lambda rota: rota.abort())
    pagina.route("**/api/agents/*/transcription", lambda rota: preso.__setitem__("rota", rota))
    pagina.goto(f"http://127.0.0.1:{porta}/agente/{slug}", wait_until="domcontentloaded")
    pagina.wait_for_timeout(4_000)

    microfone = pagina.locator('button[aria-label*="Segure para falar"]').first

    # A PRÉ-CONDIÇÃO. Sem microfone no repouso não há gesto para encenar, e o
    # verde seria mentira.
    try:
        microfone.wait_for(state="visible", timeout=20_000)
    except Exception:
        pagina.screenshot(path=f"/tmp/prova-troca-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: microfone ausente no repouso — nada foi encenado")
        navegador.close()
        sys.exit(2)

    # A SEGUNDA PRÉ-CONDIÇÃO: as duas faces têm de existir empilhadas. Sem elas
    # o amostrador colheria lista vazia e a régua passaria sem provar nada.
    if pagina.locator(".ck-troca-da-fala-face").count() != 2:
        pagina.screenshot(path=f"/tmp/prova-troca-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: as duas faces da troca não estão na tela")
        navegador.close()
        sys.exit(2)

    pagina.evaluate(AMOSTRADOR)

    caixa = microfone.bounding_box()
    centro = (caixa["x"] + caixa["width"] / 2, caixa["y"] + caixa["height"] / 2)

    pagina.mouse.move(*centro)
    pagina.mouse.down()
    pagina.evaluate("() => window.__liberaMicrofone()")
    pagina.wait_for_timeout(2_500)

    # 1. O SLOW, medido na entrada da onda.
    amostras = pagina.evaluate("() => window.__amostras")
    for face in ("onda", "acoes"):
        meio = [v for v in amostras[face] if MARGEM < v < 1 - MARGEM]
        if meio:
            print(f"ok  face `{face}` interpolou ({len(meio)} quadros no meio da curva)")
        else:
            falhas.append(
                f"face `{face}` trocou de ESTALO: {len(amostras[face])} quadros amostrados, "
                "nenhum entre 0 e 1"
            )

    # 2. A NARRAÇÃO DE FASE NÃO PINTA. Em `gravando` a linha da voz não tem o
    #    que dizer; a prova de fogo é `transcrevendo`, onde ela dizia
    #    "transcrevendo…" em cima da caixa.
    pagina.mouse.up()

    # `transcrevendo` é a única fase que DESABILITA o microfone — o mesmo sinal
    # de fora que a `faixa-da-voz-nao-empurra` usa, para não ler a fase na
    # própria linha que está em julgamento.
    desabilitado = pagina.locator('form button[aria-label*="Segure para falar"][disabled]')
    try:
        desabilitado.first.wait_for(state="attached", timeout=10_000)
    except Exception:
        pagina.screenshot(path=f"/tmp/prova-troca-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: a fase `transcrevendo` não acendeu — o áudio não partiu")
        navegador.close()
        sys.exit(2)

    linha = pagina.locator('[data-linha="voz"]').first
    if linha.count() == 0:
        falhas.append("a linha da voz sumiu do DOM — leitor de tela ficou sem o aviso do STT")
    else:
        largura = linha.evaluate("el => el.getBoundingClientRect().width")
        texto = linha.inner_text().strip()
        # A OUTRA METADE DA RÉGUA, e é ela que impede esta bancada de passar
        # VAZIA: um nó de 1px SEM texto cumpriria a largura e não provaria nada.
        # Em `transcrevendo` a linha tem de estar dizendo alguma coisa.
        if not texto:
            falhas.append("a linha da voz está muda TAMBÉM para o leitor de tela em `transcrevendo`")
        elif largura > LARGURA_MUDA:
            falhas.append(f'a narração de fase voltou a pintar ({largura:.0f}px: "{texto}")')
        else:
            print(f'ok  linha da voz muda aos olhos ({largura:.1f}px) e viva no leitor: "{texto}"')

    if preso["rota"] is not None:
        preso["rota"].fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"text": "prova de bancada", "duration_ms": 2500}),
        )
        pagina.wait_for_timeout(1_000)

    foto = f"/tmp/prova-troca-da-fala-{porta}.png"
    pagina.screenshot(path=foto)
    print(f"print em {foto}")
    navegador.close()

if falhas:
    print("\nREPROVOU")
    for f in falhas:
        print(f"  - {f}")
    sys.exit(1)

print("\nPASSOU")
