"""A faixa da voz não pode empurrar a conversa a cada troca de fase.

O defeito, sentido pelo Rica na tela e escrito na F2.4 da proposta: a linha de
instrução da voz é IRMÃ do formulário, fora da caixa, e monta e desmonta com a
fase. Ela existe em `pedindo` ("liberando o microfone…") e em `transcrevendo`
("transcrevendo…"), e NÃO existe em `gravando` — porque `capturando()` a
esconde para a onda não competir com texto.

Como o composer está ancorado embaixo, cada montagem sobe tudo que está acima e
cada desmontagem desce. O solavanco aparece AO SOLTAR o dedo, não ao apertar:
com a permissão já concedida `pedindo` passa num quadro, mas
`gravando → transcrevendo` é a fronteira que o olho pega.

A régua daqui é a borda de CIMA da caixa — que é o chão da conversa. Ela tem de
ficar parada nas quatro fases do ciclo. A régua não diz COMO reservar a linha
(altura fixa, `content-visibility`, grade): diz só que a conversa não anda.

Encena o ciclo inteiro sem gastar STT e sem despachar nada para o agente:

- o microfone é o dispositivo falso do Chrome, e um portão em `getUserMedia`
  segura a fase `pedindo` aberta pelo tempo da medição;
- `POST /transcription` é interceptado e fica PRESO até a medição de
  `transcrevendo` terminar — nenhum áudio sobe, nenhuma conta é queimada.

O texto transcrito cai no rascunho e fica lá: esta bancada nunca aperta enviar.

ELA NÃO BASTA SOZINHA. A primeira reserva que fiz ficou verde aqui e reprovou
`folga-embaixo-do-composer.py`: reservar a linha EMBAIXO da caixa cumpre esta
régua e estoura a outra, porque debaixo da caixa o espaço é orçado contra a
barra de gestos do iPhone. As duas rodam juntas.

Uso: python3 faixa-da-voz-nao-empurra.py <porta> [slug]
"""

import json
import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
slug = sys.argv[2] if len(sys.argv) > 2 else "canarinho"

# O iPhone do Rica. A faixa cabe em uma linha aqui; em tela larga o mesmo texto
# poderia caber na sobra e esconder o empurrão.
VIEWPORT = {"width": 390, "height": 844}

# Quanto a borda pode andar entre fases. 1px absorve arredondamento de
# subpixel; o empurrão que estamos caçando é de 16–20px.
TOLERANCIA = 1.0

# O portão do microfone. `getUserMedia` só resolve quando a bancada mandar —
# é o que mantém `pedindo` de pé por tempo suficiente para medir. O dispositivo
# em si é o falso do Chrome (`--use-fake-device-for-media-stream`), então o
# MediaRecorder grava um arquivo de verdade e a guarda de container passa.
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

MEDE = """
() => {
  const form = document.querySelector('form');
  if (!form) return null;
  const caixa = form.getBoundingClientRect();
  const coluna = form.parentElement.parentElement.getBoundingClientRect();
  return { topoDaCaixa: caixa.top, alturaDaCaixa: caixa.height, alturaDaColuna: coluna.height };
}
"""

falhas: list[str] = []
medidas: dict[str, dict] = {}
preso: dict[str, object] = {"rota": None}


def prende_transcricao(rota):
    """Segura o POST do áudio em voo — a fase `transcrevendo` dura o que a
    bancada quiser, e nenhum byte chega ao STT."""
    preso["rota"] = rota


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
    pagina.route("**/api/agents/*/transcription", prende_transcricao)
    # `domcontentloaded`, nunca `networkidle`: o cockpit segura SSE aberto e a
    # rede nunca fica ociosa.
    pagina.goto(f"http://127.0.0.1:{porta}/agente/{slug}", wait_until="domcontentloaded")
    pagina.wait_for_timeout(4_000)

    microfone = pagina.locator('button[aria-label*="Segure para falar"]').first

    def fase_na_tela() -> str:
        """A fase lida de FORA, sem entrar na medida que está em julgamento.

        Até 20/08 `pedindo` se reconhecia pelo fio que corria na base da caixa.
        O fio SAIU a pedido do Rica ("nada de azul"), e sem ele `pedindo` e
        `ociosa` ficam idênticas aos olhos — o que sobra é a linha
        `data-linha="voz"`, que existe sempre no DOM (é `sr-only` fora do aviso
        de teto) e troca de TEXTO a cada fase. Ler esse texto não reintroduz a
        régua circular que o comentário antigo temia: o que esta bancada mede é
        a GEOMETRIA da caixa e da coluna, e o texto não entra em medida
        nenhuma. `text_content` e não `inner_text` porque o nó está escondido
        aos olhos, e texto invisível não volta pelo segundo."""
        if pagina.locator('form button[aria-label^="gravando."]').count():
            return "gravando"
        # Só `transcrevendo` desabilita o microfone — a fase em que nada
        # depende do dedo.
        if pagina.locator('form button[aria-label*="Segure para falar"][disabled]').count():
            return "transcrevendo"
        linha = pagina.locator('[data-linha="voz"]')
        if linha.count() and "liberando" in (linha.first.text_content() or ""):
            return "pedindo"
        if pagina.locator('form button[aria-label*="Segure para falar"]').count():
            return "ociosa"
        return "?"

    def espera_fase(esperada: str, limite: int = 15_000) -> bool:
        gasto = 0
        while gasto < limite:
            if fase_na_tela() == esperada:
                return True
            pagina.wait_for_timeout(100)
            gasto += 100
        return False

    def registra(fase: str):
        medida = pagina.evaluate(MEDE)
        if medida is None:
            print(f"INCONCLUSIVO: sem formulário na tela em `{fase}`")
            navegador.close()
            sys.exit(2)
        medidas[fase] = medida
        print(
            f"    {fase:<14} topo da caixa {medida['topoDaCaixa']:7.1f}px"
            f" · caixa {medida['alturaDaCaixa']:5.1f}px"
            f" · coluna {medida['alturaDaColuna']:6.1f}px"
        )

    # A PRÉ-CONDIÇÃO, e é ela que impede esta bancada de passar VAZIA: sem
    # microfone no repouso não há ciclo nenhum para medir, e verde seria
    # mentira.
    try:
        microfone.wait_for(state="visible", timeout=20_000)
    except Exception:
        pagina.screenshot(path=f"/tmp/prova-faixa-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: microfone ausente no repouso — nada foi medido")
        navegador.close()
        sys.exit(2)

    print("ciclo medido:")
    registra("ociosa")

    caixa_do_botao = microfone.bounding_box()
    centro = (
        caixa_do_botao["x"] + caixa_do_botao["width"] / 2,
        caixa_do_botao["y"] + caixa_do_botao["height"] / 2,
    )

    # 1. PEDINDO — o dedo desce e o portão do microfone segura o stream.
    pagina.mouse.move(*centro)
    pagina.mouse.down()
    if not espera_fase("pedindo", 5_000):
        pagina.screenshot(path=f"/tmp/prova-faixa-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: a fase `pedindo` não acendeu — o portão não segurou")
        navegador.close()
        sys.exit(2)
    registra("pedindo")

    # 2. GRAVANDO — abre o portão e o MediaRecorder começa de verdade.
    pagina.evaluate("() => window.__liberaMicrofone()")
    if not espera_fase("gravando", 5_000):
        pagina.screenshot(path=f"/tmp/prova-faixa-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: a fase `gravando` não acendeu")
        navegador.close()
        sys.exit(2)
    # O piso de duração da F1 descarta o toque acidental: soltar antes de 1s
    # cai em `impedida`, não em `transcrevendo`.
    pagina.wait_for_timeout(2_500)
    registra("gravando")

    # 3. TRANSCREVENDO — o dedo sobe, o áudio parte e a rota o prende no ar.
    pagina.mouse.up()
    if not espera_fase("transcrevendo", 10_000):
        pagina.screenshot(path=f"/tmp/prova-faixa-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: a fase `transcrevendo` não acendeu — o áudio não partiu")
        navegador.close()
        sys.exit(2)
    registra("transcrevendo")

    # 4. E DE VOLTA AO REPOUSO. Solta a rota presa com uma transcrição de
    #    mentira: o texto vira rascunho no campo e para aí — nada é enviado.
    if preso["rota"] is None:
        print("INCONCLUSIVO: o POST da transcrição não chegou à rota interceptada")
        navegador.close()
        sys.exit(2)
    preso["rota"].fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({"text": "prova de bancada", "duration_ms": 2500}),
    )
    if not espera_fase("ociosa", 10_000):
        print("INCONCLUSIVO: a tela não voltou ao repouso depois da transcrição")
        navegador.close()
        sys.exit(2)
    registra("ociosa-de-volta")

    # A RÉGUA. O chão da conversa é a borda de cima da caixa; ela não pode
    # andar entre fases. O repouso de volta traz o rascunho transcrito no
    # campo, e uma linha de texto legitimamente muda a altura da caixa — por
    # isso a comparação do ciclo é entre as quatro fases da captura, e a volta
    # entra só como controle impresso.
    ciclo = ["ociosa", "pedindo", "gravando", "transcrevendo"]
    referencia = medidas["ociosa"]["topoDaCaixa"]
    for fase in ciclo[1:]:
        desvio = medidas[fase]["topoDaCaixa"] - referencia
        if abs(desvio) > TOLERANCIA:
            falhas.append(
                f"a conversa andou {desvio:+.1f}px na fase `{fase}` "
                f"(topo da caixa {referencia:.1f} → {medidas[fase]['topoDaCaixa']:.1f})"
            )
        else:
            print(f"ok  `{fase}`: o chão da conversa ficou parado ({desvio:+.1f}px)")

    # A metade que diz DE ONDE veio o empurrão. Se a caixa não mudou de altura
    # mas a coluna mudou, quem cresceu foi uma faixa de fora — que é exatamente
    # o defeito desta fase, e não um efeito colateral de algo dentro da caixa.
    for fase in ciclo[1:]:
        cresceu_fora = (
            abs(medidas[fase]["alturaDaColuna"] - medidas["ociosa"]["alturaDaColuna"])
            > TOLERANCIA
        )
        cresceu_dentro = (
            abs(medidas[fase]["alturaDaCaixa"] - medidas["ociosa"]["alturaDaCaixa"])
            > TOLERANCIA
        )
        if cresceu_fora and not cresceu_dentro:
            falhas.append(
                f"a coluna do composer mudou de altura em `{fase}` sem a caixa mudar "
                f"— faixa de fora montando/desmontando"
            )

    caminho = f"/tmp/prova-faixa-da-voz-{porta}.png"
    pagina.screenshot(path=caminho)
    print(f"print em {caminho}")
    navegador.close()

if falhas:
    for f in falhas:
        print(f"FALHOU: {f}")
    sys.exit(1)
print("PASSOU")
