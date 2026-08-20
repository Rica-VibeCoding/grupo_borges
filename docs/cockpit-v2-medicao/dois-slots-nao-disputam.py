"""Microfone e envio não disputam mais o mesmo lugar.

A F2.3 separou o slot único da caixa em dois, um por assunto: ENTRADA (o
microfone, lugar fixo) e DESPACHO (enviar, quando há o que mandar). O slot
único tinha quatro donos em cascata, e a cascata é que produzia os becos —
cada conserto empurrava o defeito para o vizinho:

- 15/08: com texto escrito, o microfone comia o envio.
- 20/08 (`678f598`): com o campo vazio durante a geração, o ■ comia o
  microfone. É o defeito que a bancada irmã (`microfone-sobrevive-a-geracao`)
  trava, e ela continua valendo — o ■ segue na linha da bolinha.

A régua daqui é a que a separação criou e nenhuma bancada cobria: **o microfone
não some quando há texto no campo**. Não somia por acaso; era impossível falar
com texto já escrito, embora `mesclaTranscricao` sempre tenha sabido costurar a
fala no que havia antes.

E a segunda régua, que é de layout: o microfone não PULA de lugar quando o
texto aparece. O slot de despacho reserva o espaço mesmo vazio.

Uso: python3 dois-slots-nao-disputam.py <porta> [slug]
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
slug = sys.argv[2] if len(sys.argv) > 2 else "canarinho"

# O iPhone do Rica. O slot é apertado no celular, e é lá que os dois becos
# aconteceram.
VIEWPORT = {"width": 390, "height": 844}

falhas: list[str] = []

with sync_playwright() as p:
    navegador = p.chromium.launch(channel="chrome")
    contexto = navegador.new_context(viewport=VIEWPORT)
    pagina = contexto.new_page()
    # `domcontentloaded`, nunca `networkidle`: o cockpit segura SSE aberto e a
    # rede nunca fica ociosa.
    pagina.goto(f"http://127.0.0.1:{porta}/agente/{slug}", wait_until="domcontentloaded")
    pagina.wait_for_timeout(4_000)

    microfone = pagina.locator('button[aria-label*="Segure para falar"]')
    enviar = pagina.locator('button[aria-label^="Enviar para"]')
    campo = pagina.locator("textarea").first

    # A PRÉ-CONDIÇÃO, e ela é o que impede esta bancada de passar VAZIA: sem o
    # microfone no repouso não há nada para provar, e o verde seria mentira.
    try:
        microfone.first.wait_for(state="visible", timeout=20_000)
    except Exception:
        pagina.screenshot(path=f"/tmp/prova-slots-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: microfone ausente no repouso — nada foi provado")
        navegador.close()
        sys.exit(2)

    x_repouso = microfone.first.bounding_box()["x"]

    # 1. Com o campo vazio não há botão de envio — a recusa por `vazio` é a
    #    única sem recado no módulo da porta, então um alvo aqui seria o botão
    #    morto da §9: não responde ao toque e não diz por quê.
    if enviar.count() > 0:
        falhas.append("botão de envio existe com o campo VAZIO — alvo sem resposta possível")
    else:
        print("ok  campo vazio: só o microfone")

    campo.click()
    campo.type("uma mensagem escrita à mão")
    pagina.wait_for_timeout(500)

    # 2. A RÉGUA NOVA: o microfone sobrevive ao texto.
    if microfone.count() == 0:
        falhas.append("MICROFONE AUSENTE com texto no campo — o slot voltou a ser um só")
    else:
        print("ok  microfone presente com texto escrito")

    if enviar.count() == 0:
        falhas.append("botão de envio AUSENTE com texto no campo — não há como despachar")
    else:
        print("ok  envio presente com texto escrito")

    # 3. Slots distintos: mesma linha, pontos diferentes.
    if microfone.count() and enviar.count():
        caixa_mic = microfone.first.bounding_box()
        caixa_env = enviar.first.bounding_box()
        if abs(caixa_mic["x"] - caixa_env["x"]) < 8:
            falhas.append("microfone e envio no mesmo x — um cobre o outro")
        else:
            print(f"ok  slots distintos (mic x={caixa_mic['x']:.0f}, envio x={caixa_env['x']:.0f})")

        # 4. E o microfone não PULA quando o texto aparece — o slot de despacho
        #    reserva o espaço mesmo vazio. Layout que se move a cada tecla é o
        #    mesmo solavanco que a F2.4 ataca na faixa de aviso.
        if abs(caixa_mic["x"] - x_repouso) > 2:
            falhas.append(
                f"o microfone pulou {abs(caixa_mic['x'] - x_repouso):.0f}px ao surgir o envio"
            )
        else:
            print("ok  microfone imóvel entre vazio e com texto")

        # 5. Nada transbordou a caixa no aparelho estreito.
        formulario = pagina.locator("form").first.bounding_box()
        direita = max(caixa_mic["x"] + caixa_mic["width"], caixa_env["x"] + caixa_env["width"])
        if direita > formulario["x"] + formulario["width"] + 1:
            falhas.append(f"slot transborda a caixa (x={direita:.0f} > form={formulario['x'] + formulario['width']:.0f})")
        else:
            print("ok  os dois slots cabem na caixa em 390px")

    caminho = f"/tmp/prova-dois-slots-{porta}.png"
    pagina.screenshot(path=caminho)
    print(f"print em {caminho}")
    navegador.close()

if falhas:
    for f in falhas:
        print(f"FALHOU: {f}")
    sys.exit(1)
print("PASSOU")
