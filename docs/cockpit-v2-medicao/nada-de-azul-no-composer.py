"""Nenhum pixel azul acende no composer durante a fala.

Rica, 20/08, logo depois de aprovar a fala ao vivo:

> *"esse raio azul que passa embaixo do composer eu queria tirar de todo mundo.
> Nada de azul, nada de raiozinho, nada de borda azulada, neon"*

O que ele viu eram DUAS peças, e as duas moravam nos tokens de estado: o disco
do microfone virava ciano (`--ck-state-running`, #36caf1) durante a captura, e
um fio roxo (`--ck-state-thinking`, #9f9afc) percorria a base da caixa enquanto
o STT rodava. A regra da casa já era essa desde o §13 do `globals.css` — croma
zero em tudo que não significa —, e a voz era a exceção que sobrou.

POR QUE ESTA RÉGUA MEDE PIXEL, E NÃO CSS. Ler `getComputedStyle` provaria que
uma variável mudou de valor, e é fácil deixar verde: basta trocar o token e
esquecer um `background` inline, um `box-shadow`, um SVG com `fill` cravado.
Pixel é o que o olho vê — se acender azul por qualquer caminho, aqui reprova.

A CONTA. Um pixel é "azulado" quando o canal azul passa dos outros dois com
folga (`b - max(r, g) > 18`). Isso pega ciano, azul e roxo de uma vez, e deixa
passar o que a casa mantém de propósito: âmbar do áudio longo e vermelho do
prestes-a-cancelar têm o azul EMBAIXO, não em cima. Cinza e branco dão zero por
definição. A folga de 18 absorve antialiasing e o `backdrop-filter` da caixa.

AS TRÊS FASES MEDIDAS são as que o Rica atravessa a cada fala: repouso (a
linha-base — se ela já viesse azul, o resto não provaria nada), `gravando` (o
disco e a onda) e `transcrevendo` (onde o fio corria). O canal ao vivo é
recusado de propósito: sem ele o composer cai no caminho de arquivo, que é o
que mantém `transcrevendo` de pé pelo tempo da medição — e nenhum byte sobe
para o STT, porque a rota fica presa no ar.

Uso: python3 nada-de-azul-no-composer.py <porta> [slug]
"""

import sys

from PIL import Image
from playwright.sync_api import sync_playwright

porta = sys.argv[1]
slug = sys.argv[2] if len(sys.argv) > 2 else "canarinho"

VIEWPORT = {"width": 390, "height": 844}
FOLGA_DE_AZUL = 18
# Um punhado de pixels sobreviveria a qualquer antialiasing; um sinal de tela
# de verdade (disco de 32px, fio de 2px atravessando a caixa) passa de 200.
TETO_DE_PIXELS = 40

falhas: list[str] = []
preso: dict[str, object] = {"rota": None}


def prende_transcricao(rota):
    """Segura o POST do áudio em voo: `transcrevendo` dura o que a bancada
    quiser, e nenhum áudio chega ao STT."""
    preso["rota"] = rota


def azulados(caminho: str) -> tuple[int, tuple[int, int, int] | None]:
    """Quantos pixels azulados há na imagem, e o mais forte deles."""
    imagem = Image.open(caminho).convert("RGB")
    pior = None
    margem_do_pior = 0
    total = 0
    for r, g, b in imagem.getdata():
        margem = b - max(r, g)
        if margem > FOLGA_DE_AZUL:
            total += 1
            if margem > margem_do_pior:
                margem_do_pior = margem
                pior = (r, g, b)
    return total, pior


with sync_playwright() as p:
    navegador = p.chromium.launch(
        channel="chrome",
        args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    )
    contexto = navegador.new_context(viewport=VIEWPORT, permissions=["microphone"])
    pagina = contexto.new_page()
    # Sem canal ao vivo: o composer cai no caminho de arquivo, e é ele que
    # mantém `transcrevendo` de pé para ser medido.
    pagina.route("**/transcription/live-token", lambda rota: rota.abort())
    pagina.route("**/api/agents/*/transcription", prende_transcricao)

    pagina.goto(f"http://127.0.0.1:{porta}/agente/{slug}", wait_until="domcontentloaded")
    pagina.wait_for_timeout(4_000)

    microfone = pagina.locator('button[aria-label*="Segure para falar"]').first
    try:
        microfone.wait_for(state="visible", timeout=20_000)
    except Exception:
        print("INCONCLUSIVO: microfone ausente no repouso — nada foi medido")
        navegador.close()
        sys.exit(2)

    formulario = pagina.locator("form").first

    def mede(fase: str):
        """Fotografa a caixa MAIS a faixa de 12px abaixo dela — o fio morava
        justamente na borda, e um recorte pela caixa exata poderia perdê-lo."""
        caixa = formulario.bounding_box()
        foto = f"/tmp/azul-{fase}-{porta}.png"
        pagina.screenshot(
            path=foto,
            clip={
                "x": caixa["x"],
                "y": caixa["y"],
                "width": caixa["width"],
                "height": caixa["height"] + 12,
            },
        )
        quantos, pior = azulados(foto)
        if quantos > TETO_DE_PIXELS:
            falhas.append(
                f"`{fase}`: {quantos} pixels azulados no composer, o mais forte {pior} — "
                "era isso que o Rica mandou tirar"
            )
        else:
            print(f"ok  `{fase}`: nenhum azul no composer ({quantos} pixels de borda)")

    mede("repouso")

    centro_do_botao = microfone.bounding_box()
    pagina.mouse.move(
        centro_do_botao["x"] + centro_do_botao["width"] / 2,
        centro_do_botao["y"] + centro_do_botao["height"] / 2,
    )
    pagina.mouse.down()
    # Espera a captura de verdade abrir: medir antes disso fotografaria o
    # repouso com outro nome, e a bancada passaria sem ver a fase.
    try:
        pagina.locator('form button[aria-label^="gravando."]').wait_for(timeout=10_000)
    except Exception:
        print("INCONCLUSIVO: a gravação não abriu — a fase `gravando` não foi medida")
        navegador.close()
        sys.exit(2)
    pagina.wait_for_timeout(1_500)
    mede("gravando")

    pagina.mouse.up()
    try:
        pagina.locator('form button[aria-label*="Segure para falar"][disabled]').wait_for(
            timeout=10_000
        )
    except Exception:
        print("INCONCLUSIVO: `transcrevendo` não acendeu — o áudio não partiu")
        navegador.close()
        sys.exit(2)
    # Meio segundo de fio correndo seria pego em qualquer quadro; a espera é
    # para o caso de a animação começar deslocada para fora do recorte.
    pagina.wait_for_timeout(800)
    mede("transcrevendo")

    rota = preso["rota"]
    if rota is not None:
        rota.abort()
    navegador.close()

if falhas:
    print("\nREPROVOU")
    for f in falhas:
        print(f"  - {f}")
    sys.exit(1)

print("\nPASSOU")
