"""O disco pintado dos controles da caixa tem os 32px que as bibliotecas usam.

Rica, 21/08, olhando o próprio iPhone: *"o tamanho também parece não seguir boa
prática, ele parece um pouco maior do que deveria pro contexto da UI"*. Ele
estava certo, e o defeito não era de desenho — era de pintura.

`ALVO_DE_TOQUE` dá os 44px de dedo somando 6px de `padding` a um quadro de 32
em `content-box` e devolvendo os 6 como margem negativa. O LAYOUT não anda um
pixel, que era o ponto. Mas `background` pinta até a borda do padding por
padrão, então o disco branco saía com 44px de diâmetro — 37% maior que o
desenho, e é isso que aparece na foto do Rica.

A régua vem de fora, das três referências gratuitas conferidas em 21/08 (todas
convergem no mesmo número):

- shadcn/ui `InputGroupButton size="icon-sm"` → `size-8`, ícone `size-4`
- Vercel AI Elements `PromptInputSubmit` → o mesmo `icon-sm`
- assistant-ui `ComposerSend` / `ComposerVoiceButton` → `grid size-8`

E ela mede PIXEL, não `getComputedStyle`: quem errou aqui foi a propriedade
`background-clip`, que nenhuma leitura de `width` acusaria — o `width` sempre
disse 32. A foto é a única testemunha que o Rica e a bancada compartilham.

As outras duas metades existem para o conserto não sair caro: encolher o disco
não pode encolher o ALVO (44px continua sendo o mínimo da casa) nem mexer no
PASSO da fileira (o layout tem de ficar onde estava).

Uso: python3 disco-do-composer-tem-32px.py <porta> [slug]
"""

import io
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

porta = sys.argv[1]
slug = sys.argv[2] if len(sys.argv) > 2 else "canarinho"

VIEWPORT = {"width": 390, "height": 844}
DISCO_ALVO = 32
ALVO_MIN = 44

falhas: list[str] = []


def largura_pintada(pagina, seletor: str) -> float:
    """Diâmetro do disco em PIXEL, lido da foto — não de `getComputedStyle`.

    Fotografa uma faixa horizontal na altura do meio do botão, com folga dos
    dois lados, e conta a corrida de pixels claros no centro. O disco é
    `--ck-text-primary` sobre a superfície escura da caixa: a diferença de
    luminância entre os dois passa de 150, então o corte em 90 não depende de
    afinação.
    """
    caixa = pagina.locator(seletor).first.bounding_box()
    folga = 14
    tira = {
        "x": caixa["x"] - folga,
        "y": caixa["y"] + caixa["height"] / 2 - 1,
        "width": caixa["width"] + folga * 2,
        "height": 2,
    }
    imagem = Image.open(io.BytesIO(pagina.screenshot(clip=tira))).convert("L")
    linha = [imagem.getpixel((x, 0)) for x in range(imagem.width)]
    fundo = linha[0]
    claros = [x for x, v in enumerate(linha) if abs(v - fundo) > 90]
    if not claros:
        return 0.0
    return (claros[-1] - claros[0] + 1) / (imagem.width / tira["width"])


with sync_playwright() as p:
    navegador = p.chromium.launch(channel="chrome")
    contexto = navegador.new_context(viewport=VIEWPORT, device_scale_factor=1)
    pagina = contexto.new_page()
    pagina.route("**/transcription/live-token", lambda rota: rota.abort())
    pagina.goto(f"http://127.0.0.1:{porta}/agente/{slug}", wait_until="domcontentloaded")
    pagina.wait_for_timeout(4_000)

    SEL_VOZ = 'button[aria-label*="Segure para falar"]'
    SEL_ENVIAR = 'button[aria-label^="Enviar para"]'

    # PRÉ-CONDIÇÃO. O microfone só é MASSA no repouso: com vizinho de massa em
    # cena (o ■ ou o despacho) ele recua para contorno de propósito, e aí não
    # há disco branco para medir. Passar sem isso seria passar vazio.
    try:
        pagina.wait_for_function(
            """(sel) => {
              const b = document.querySelector(sel);
              if (!b) return false;
              const parar = document.querySelector('button[aria-label^="Parar"]');
              const gerando = parar && parseFloat(getComputedStyle(parar).opacity) > 0.1;
              return !gerando && getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)';
            }""",
            arg=SEL_VOZ,
            timeout=30_000,
        )
    except Exception:
        pagina.screenshot(path=f"/tmp/prova-disco-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: sem microfone de massa no repouso — nada foi provado")
        navegador.close()
        sys.exit(2)

    # 1. O disco do microfone em repouso.
    pintado = largura_pintada(pagina, SEL_VOZ)
    if abs(pintado - DISCO_ALVO) > 1.5:
        falhas.append(
            f"disco do microfone pintado com {pintado:.0f}px — a régua das bibliotecas é {DISCO_ALVO}px"
        )
    else:
        print(f"ok  microfone: disco pintado {pintado:.0f}px")

    # 2. O dedo não pode pagar a conta do disco menor.
    caixa_voz = pagina.locator(SEL_VOZ).first.bounding_box()
    if caixa_voz["width"] + 0.5 < ALVO_MIN or caixa_voz["height"] + 0.5 < ALVO_MIN:
        falhas.append(
            f"alvo do microfone caiu para {caixa_voz['width']:.0f}x{caixa_voz['height']:.0f}px — mínimo da casa é {ALVO_MIN}"
        )
    else:
        print(f"ok  microfone: alvo {caixa_voz['width']:.0f}x{caixa_voz['height']:.0f}px")

    # 3. Com texto no campo o despacho entra — e ele é o outro disco de massa.
    campo = pagina.locator("textarea").first
    campo.click()
    campo.type("medindo o disco")
    pagina.wait_for_timeout(600)

    pintado_envio = largura_pintada(pagina, SEL_ENVIAR)
    if abs(pintado_envio - DISCO_ALVO) > 1.5:
        falhas.append(
            f"disco do envio pintado com {pintado_envio:.0f}px — a régua das bibliotecas é {DISCO_ALVO}px"
        )
    else:
        print(f"ok  envio: disco pintado {pintado_envio:.0f}px")

    # 4. O PASSO da fileira não muda: encolher a tinta não pode mover o layout.
    #    O microfone é remedido AQUI, e não vale reaproveitar a medida do
    #    repouso: quando o despacho entra em cena a fileira DESLIZA, e o envio
    #    ocupa o lugar que o microfone tinha. Comparar com a caixa de antes
    #    dava 0px — a bancada mediria o deslize, não o passo.
    passo = (
        pagina.locator(SEL_ENVIAR).first.bounding_box()["x"]
        - pagina.locator(SEL_VOZ).first.bounding_box()["x"]
    )
    if abs(passo - ALVO_MIN) > 1.5:
        falhas.append(f"passo entre microfone e envio virou {passo:.0f}px — era {ALVO_MIN}px")
    else:
        print(f"ok  fileira: passo de {passo:.0f}px entre os controles")

    pagina.screenshot(path=f"/tmp/prova-disco-{porta}.png")
    navegador.close()

if falhas:
    print("\nREPROVADO:")
    for f in falhas:
        print(" -", f)
    sys.exit(1)
print("\nAPROVADO")
