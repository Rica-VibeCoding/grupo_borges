"""O texto do feed embaça antes de cruzar a cabeça da bolinha — e ela não.

Rica, 24/08, com vídeo do iPhone: *"o texto passa por trás do nosso mascote
redondinho... a gente precisava fazer com que ele passasse da mesma forma como
ele passa atrás do composer, que ele fica embaçado logo a partir da cabeça do
bichinho"*. O véu (`.ck-veu-bolinha`) é desfoque SEM tint: não existe cena em
que ele apareça sozinho, então a única testemunha é o texto que passa — e é
ele que esta régua mede.

Três medidas, todas em PIXEL da foto. A métrica é BORDAS DURAS POR MIL — a
fração de pares de pixels vizinhos com degrau > 25 de luminância. Glifo nítido
é feito de degraus desses; a 36px de desfoque não sobra NENHUM. Gradiente
médio não serve: numa tira larga onde o texto ocupa só um trecho, a média
dilui e nítido fica parecido com vazio.

1. FAIXA DA CABEÇA — a linha do topo do círculo, à direita da bolinha. É onde
   o vídeo mostra o texto nítido atravessando. Com o véu, o que passa ali tem
   de estar apagado.
2. FAIXA DO FEED LIVRE — a mesma largura, 90px acima do véu. O texto ali tem
   de continuar NÍTIDO: véu que sobe demais é a faixa-quadrado que o Rica
   reprovou em 08/08.
3. OS OLHOS DA BOLINHA — se a ordem de pintura sair errada, o véu borra o
   próprio mascote. Os olhos (quase pretos sobre a esfera clara) são o maior
   contraste da região: neles o gradiente não pode cair abaixo do piso.

Uma linha de texto pode calhar de não existir numa altura (vão entre linhas),
então a página é fotografada em VÁRIAS posições de rolagem e cada faixa fica
com o seu MÁXIMO — "a linha mais nítida que já passou ali". E a pré-condição
manda: sem texto nítido na faixa livre (feed curto, página errada) a bancada
ABORTA em vez de passar verde vazia.

Reprova o build sem o véu (faixa da cabeça ≈ faixa livre); passa com ele.

Uso: python3 texto-embaca-antes-de-cruzar-a-bolinha.py <porta> [slug]
"""

import io
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

porta = sys.argv[1]
slug = sys.argv[2] if len(sys.argv) > 2 else "daniel"

VIEWPORT = {"width": 390, "height": 844}

# Geometria do véu, espelhada do globals.css: padding do wrapper (12px) + topo
# do círculo no SVG (~6px) = cabeça a ~18px do topo do wrapper; o véu sobe 8px
# acima do wrapper com rampa de 24px.
CABECA_DO_TOPO_DO_SVG = 6
FOLGA_ACIMA_DO_VEU = 90          # bem fora dos 8px de subida + 24px de rampa

# O véu borra a 36px: ali não sobrevive UM degrau duro. A régua é relativa
# (cabeça ≤ 20% do livre) porque o quanto de tinta o feed tem varia com o
# histórico; os pisos absolutos são só pré-condição de cena.
DEGRAU_DURO = 25
TETO_RELATIVO = 0.20
PISO_TEXTO_NITIDO = 3.0          # ‰ — sem isso a cena está vazia, régua aborta
PISO_OLHOS = 30.0                # ‰ — dois discos quase pretos sobre esfera clara

# O fim do feed tem um respiro do tamanho do composer (`--ck-composer-altura`):
# os primeiros ~200px de rolagem só percorrem vão. A varredura fina começa
# depois de vencer isso.
PRE_ROLAGEM = 400
PASSOS_DE_ROLAGEM = 24
ROLAGEM_POR_PASSO = 9            # menor que meia linha de texto: nenhuma escapa

falhas: list[str] = []


def bordas_por_mil(imagem: Image.Image) -> float:
    """Fração (‰) de pares vizinhos horizontais com |degrau| > DEGRAU_DURO."""
    cinza = imagem.convert("L")
    largura, altura = cinza.size
    pixels = list(cinza.getdata())
    duras = 0
    pares = 0
    for y in range(altura):
        base = y * largura
        for x in range(largura - 1):
            if abs(pixels[base + x + 1] - pixels[base + x]) > DEGRAU_DURO:
                duras += 1
            pares += 1
    return duras * 1000 / pares if pares else 0.0


def foto_da_faixa(pagina, faixa: dict) -> float:
    return bordas_por_mil(Image.open(io.BytesIO(pagina.screenshot(clip=faixa))))


with sync_playwright() as p:
    navegador = p.chromium.launch()
    # `reduced_motion`: a bolinha flutua (`ck-bolinha-voa`) e pisca — uma tira
    # fina fotografada na fase errada mede o vão, não os olhos.
    pagina = navegador.new_page(viewport=VIEWPORT, reduced_motion="reduce")
    # `domcontentloaded`, nunca `networkidle`: o feed ao vivo segura a rede
    # aberta para sempre e o idle não existe.
    pagina.goto(f"http://127.0.0.1:{porta}/agente/{slug}", wait_until="domcontentloaded")
    pagina.wait_for_timeout(4_000)

    bolinha = pagina.locator(".ck-bolinha").first.bounding_box()
    if not bolinha:
        print("ABORTA: bolinha não encontrada — a cena não é a do composer")
        sys.exit(2)

    y_cabeca = bolinha["y"] + CABECA_DO_TOPO_DO_SVG
    x_inicio = bolinha["x"] + bolinha["width"] + 24
    largura_faixa = VIEWPORT["width"] - 16 - x_inicio

    faixa_cabeca = {"x": x_inicio, "y": y_cabeca, "width": largura_faixa, "height": 12}
    faixa_livre = {
        "x": x_inicio,
        "y": y_cabeca - FOLGA_ACIMA_DO_VEU,
        "width": largura_faixa,
        "height": 12,
    }
    # Os dois olhos numa tira só, centrada no cy deles (31 de 68 ≈ 46% da
    # altura do SVG), alta o bastante para pegá-los mesmo que algum deslocamento
    # residual sobreviva ao reduced-motion.
    faixa_olhos = {
        "x": bolinha["x"] + bolinha["width"] * 0.2,
        "y": bolinha["y"] + bolinha["height"] * 0.46 - 7,
        "width": bolinha["width"] * 0.6,
        "height": 14,
    }

    pagina.mouse.move(VIEWPORT["width"] / 2, VIEWPORT["height"] * 0.3)
    pagina.mouse.wheel(0, -PRE_ROLAGEM)
    pagina.wait_for_timeout(600)

    max_cabeca = 0.0
    max_livre = 0.0
    max_olhos = 0.0
    for _ in range(PASSOS_DE_ROLAGEM):
        pagina.mouse.wheel(0, -ROLAGEM_POR_PASSO)
        pagina.wait_for_timeout(160)
        max_cabeca = max(max_cabeca, foto_da_faixa(pagina, faixa_cabeca))
        max_livre = max(max_livre, foto_da_faixa(pagina, faixa_livre))
        max_olhos = max(max_olhos, foto_da_faixa(pagina, faixa_olhos))

    navegador.close()

print(f"bordas duras (‰) na faixa livre (nítida): {max_livre:.2f}")
print(f"bordas duras (‰) na faixa da cabeça:      {max_cabeca:.2f}")
print(f"razão cabeça/livre:                       {max_cabeca / max_livre if max_livre else 0:.2f}")
print(f"bordas duras (‰) nos olhos da bolinha:    {max_olhos:.2f}")

if max_livre < PISO_TEXTO_NITIDO:
    print(
        f"ABORTA: faixa livre sem texto nítido ({max_livre:.2f} < {PISO_TEXTO_NITIDO})"
        " — não há histórico rolando na cena; a régua não mediu nada"
    )
    sys.exit(2)

if max_olhos < PISO_OLHOS:
    falhas.append(
        f"os olhos da bolinha perderam contraste ({max_olhos:.2f} < {PISO_OLHOS})"
        " — o véu está borrando o próprio mascote (ordem de pintura)"
    )

if max_cabeca > max_livre * TETO_RELATIVO:
    falhas.append(
        f"texto na altura da cabeça continua legível ({max_cabeca:.2f} >"
        f" {TETO_RELATIVO:.0%} de {max_livre:.2f}) — o véu não está apagando"
    )

if falhas:
    print("\nREPROVADO:")
    for f in falhas:
        print(f"  - {f}")
    sys.exit(1)

print("\nPASSOU: o texto cruza a cabeça da bolinha apagado, e ela continua nítida")
