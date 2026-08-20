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

E a segunda régua é de MOVIMENTO. A primeira versão desta fase reservava o
espaço do envio mesmo vazio, para o microfone não pular de lugar; o vão ficou à
vista e o Rica recusou — *"um buraco em branco parecendo uma boca com um dente
a menos"*. Agora a fileira desliza: sem despacho em cena ela anda para a
direita e o microfone encosta na borda; ao digitar, ela volta e o botão surge
no lugar que abriu. A bancada trava as duas metades — que o microfone ande os
44px do slot, e que ande ANIMADO, não de estalo.

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
    # A F3 abre um canal ao vivo com a OpenAI ao começar a gravar. Esta bancada
    # mede TELA, não fala: recusar o bilhete derruba o composer no caminho de
    # arquivo, que é exatamente o que ela sempre mediu.
    pagina.route("**/transcription/live-token", lambda rota: rota.abort())
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

    # 1. Com o campo vazio o botão de envio está no DOM — é a largura dele que
    #    a fileira desliza —, mas FORA DE CENA: não pinta, não é anunciado, não
    #    recebe toque. Um alvo visível e mudo aqui seria o botão morto da §9,
    #    porque `vazio` é a única recusa sem recado no módulo da porta.
    if enviar.count() == 0:
        falhas.append("botão de envio ausente do DOM — a fileira não tem o que deslizar")
    else:
        oculto = enviar.first.get_attribute("aria-hidden") == "true"
        opacidade = enviar.first.evaluate("el => getComputedStyle(el).opacity")
        if not oculto or float(opacidade) > 0.01:
            falhas.append(
                f"botão de envio EM CENA com o campo vazio (aria-hidden={oculto}, opacity={opacidade})"
            )
        else:
            print("ok  campo vazio: envio fora de cena, sem alvo mudo")


    campo.click()
    campo.type("uma mensagem escrita à mão")
    pagina.wait_for_timeout(500)

    # 3. O microfone sobrevive ao texto.
    if microfone.count() == 0:
        falhas.append("MICROFONE AUSENTE com texto no campo — o slot voltou a ser um só")
    else:
        print("ok  microfone presente com texto escrito")

    if enviar.count() == 0:
        falhas.append("botão de envio AUSENTE com texto no campo — não há como despachar")
    else:
        print("ok  envio presente com texto escrito")

    # 3b. Slots distintos: mesma linha, pontos diferentes.
    if microfone.count() and enviar.count():
        caixa_mic = microfone.first.bounding_box()
        caixa_env = enviar.first.bounding_box()
        if abs(caixa_mic["x"] - caixa_env["x"]) < 8:
            falhas.append("microfone e envio no mesmo x — um cobre o outro")
        else:
            print(f"ok  slots distintos (mic x={caixa_mic['x']:.0f}, envio x={caixa_env['x']:.0f})")

        # 4. NÃO HÁ BURACO no repouso: o microfone ocupava exatamente o lugar
        #    que o envio ocupa agora. É a régua que o vão reservado da primeira
        #    versão desta fase reprovava — "uma boca com um dente a menos".
        if abs(x_repouso - caixa_env["x"]) > 4:
            falhas.append(
                f"vão no repouso: microfone em x={x_repouso:.0f}, mas o envio entra em "
                f"x={caixa_env['x']:.0f} — sobra buraco na borda"
            )
        else:
            print("ok  no repouso o microfone ocupa o lugar da borda, sem vão")

        # 5. O MOVIMENTO. O microfone anda para a esquerda pela largura do slot
        #    (32px + 12px de gap) para abrir lugar ao envio. Ele DEVE se mover:
        #    a primeira versão desta fase segurava o espaço vazio e o vão ficou
        #    à vista.
        andou = x_repouso - caixa_mic["x"]
        if abs(andou - 44) > 4:
            falhas.append(f"o microfone andou {andou:.0f}px — esperado 44 (slot + gap)")
        else:
            print(f"ok  microfone deslocou {andou:.0f}px para abrir o slot")

        # 6. E anda ANIMADO, não de estalo. Sem isto a régua acima passaria com
        #    o mesmo pulo que a versão do espaço reservado existia para evitar.
        fileira = pagina.locator(".ck-fileira-acoes").first
        propriedade = fileira.evaluate("el => getComputedStyle(el).transitionProperty")
        duracao = fileira.evaluate("el => getComputedStyle(el).transitionDuration")
        segundos = max((float(t.rstrip("s")) for t in duracao.split(", ")), default=0.0)
        if "transform" not in propriedade or segundos <= 0:
            falhas.append(f"fileira sem transição (property={propriedade}, duration={duracao})")
        else:
            print(f"ok  fileira anima transform em {duracao}")

        # 7. O botão que sai pela borda é recortado pela caixa, não vira barra
        #    de rolagem horizontal no aparelho estreito.
        transborda = pagina.evaluate(
            "() => document.documentElement.scrollWidth > document.documentElement.clientWidth"
        )
        if transborda:
            falhas.append("a página ganhou rolagem horizontal — o botão oculto não foi recortado")
        else:
            print("ok  nada transborda a janela")

        # 8. Nada transbordou a caixa no aparelho estreito.
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
