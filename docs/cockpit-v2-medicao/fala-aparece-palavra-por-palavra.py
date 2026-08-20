"""A fala aparece no rascunho ENQUANTO se fala — e o arquivo não sobe depois.

Rica, 20/08, depois de aprovar o clique curto:

> *"o que eu queria de a gente fazer agora é ver se na medida que eu falo, a API
> já renderizasse palavra por palavra, como é feito no Cloud"*

O QUE ESTA BANCADA MEDE, e o que ela recusa medir. O canal ao vivo é uma
conversa com a OpenAI: se a bancada falasse com a OpenAI de verdade, ela mediria
a rede e a cota, gastaria dinheiro a cada execução e ficaria vermelha por
motivos que não são nossos. Então o fornecedor é ENCENADO — `route_web_socket`
finge ser o canal, e a bancada dita as palavras no tempo dela.

O que continua REAL, e é o que interessa: a captura do microfone, o worklet, a
reamostragem pra 24 kHz, o empacotamento em base64, o gesto, e o composer
remontando o rascunho a cada pedaço.

AS DUAS METADES:

  1. **Apareceu enquanto falava.** As palavras têm de entrar no campo uma a uma,
     ANTES de qualquer botão de encerrar. Só medir o texto no fim passaria
     verde com o caminho de arquivo de sempre, que é justamente o que a F3 veio
     substituir.
  2. **O arquivo NÃO subiu.** Se o texto veio pelo canal, mandar o arquivo
     transcreveria a mesma fala de novo — cobrando duas vezes e colando duas
     vezes no rascunho. A rota de arquivo é vigiada: qualquer chamada reprova.

E antes das duas, a pré-condição que impede o verde vazio: o navegador tem de
ter MANDADO áudio. Sem quadro de `input_audio_buffer.append` nenhum, um campo
que se preenche só prova que a bancada sabe escrever no próprio campo.

Uso: python3 fala-aparece-palavra-por-palavra.py <porta> [slug]
"""

import json
import sys
import time

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
slug = sys.argv[2] if len(sys.argv) > 2 else "canarinho"

VIEWPORT = {"width": 390, "height": 844}
DURACAO_DO_CLIQUE_MS = 120
# As palavras que o fornecedor encenado vai "ouvir", uma por vez.
DITADO = [" Oi", ",", " Rica", ",", " isso", " aqui", " é", " a", " fala", " ao", " vivo"]
FINAL = "Oi, Rica, isso aqui é a fala ao vivo."

falhas: list[str] = []
quadros_do_cliente: list[dict] = []
canal: dict = {"rota": None}
chamou_arquivo = {"n": 0}


def espera(condicao, limite_s=8.0, passo_ms=100):
    """Espera bombeando o laço do Playwright.

    `time.sleep` aqui seria um bug silencioso: no Playwright síncrono os eventos
    (mensagem de WebSocket, rota interceptada) só são despachados enquanto o
    cliente está DENTRO de uma chamada dele. Dormindo em Python puro, nada
    chega, e a bancada concluiria "o composer não abriu canal nenhum" com o
    canal aberto do outro lado.
    """
    fim = time.time() + limite_s
    while time.time() < fim:
        if condicao():
            return True
        pagina.wait_for_timeout(passo_ms)
    return False


with sync_playwright() as p:
    navegador = p.chromium.launch(
        channel="chrome",
        args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    )
    contexto = navegador.new_context(viewport=VIEWPORT, permissions=["microphone"])
    pagina = contexto.new_page()

    # O bilhete: encenado, porque cunhar de verdade queima cota a cada execução
    # e amarra a bancada à chave estar no lugar.
    pagina.route(
        "**/transcription/live-token",
        lambda rota: rota.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "token": "ek_de_mentira",
                    "expires_at": int(time.time()) + 600,
                    "model": "gpt-live-transcribe",
                    "rate": 24000,
                }
            ),
        ),
    )

    # A rota de ARQUIVO fica vigiada, não encenada: ela não deve ser chamada
    # nenhuma vez. Abortar além de contar garante que, se for chamada, nada
    # suba de verdade.
    def vigia_arquivo(rota):
        chamou_arquivo["n"] += 1
        rota.abort()

    pagina.route("**/api/agents/*/transcription", vigia_arquivo)

    def encena_openai(ws):
        canal["rota"] = ws
        ws.on_message(lambda m: quadros_do_cliente.append(json.loads(m)))

    pagina.route_web_socket("wss://api.openai.com/**", encena_openai)

    pagina.goto(f"http://127.0.0.1:{porta}/agente/{slug}", wait_until="domcontentloaded")
    pagina.wait_for_timeout(4_000)

    microfone = pagina.locator('button[aria-label*="Segure para falar"]').first
    try:
        microfone.wait_for(state="visible", timeout=20_000)
    except Exception:
        pagina.screenshot(path=f"/tmp/prova-fala-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: microfone ausente no repouso — nada foi encenado")
        navegador.close()
        sys.exit(2)

    campo = pagina.locator("form textarea").first
    antes = campo.input_value()

    caixa = microfone.bounding_box()
    pagina.mouse.move(caixa["x"] + caixa["width"] / 2, caixa["y"] + caixa["height"] / 2)
    pagina.mouse.down()
    pagina.wait_for_timeout(DURACAO_DO_CLIQUE_MS)
    pagina.mouse.up()

    # PRÉ-CONDIÇÃO: o canal abriu e o navegador está MANDANDO áudio.
    if not espera(lambda: canal["rota"] is not None, 10.0):
        pagina.screenshot(path=f"/tmp/prova-fala-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: o composer não abriu canal nenhum — nada a medir")
        navegador.close()
        sys.exit(2)

    def tem_audio():
        return any(q.get("type") == "input_audio_buffer.append" for q in quadros_do_cliente)

    if not espera(tem_audio, 8.0):
        pagina.screenshot(path=f"/tmp/prova-fala-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: o canal abriu mas nenhum áudio subiu — o worklet não captou")
        navegador.close()
        sys.exit(2)

    audio_no_comeco = sum(
        1 for q in quadros_do_cliente if q.get("type") == "input_audio_buffer.append"
    )
    print(f"ok  {audio_no_comeco} blocos de áudio subiram antes da primeira palavra")

    # 1. PALAVRA POR PALAVRA, com a gravação ainda de pé.
    acumulado = ""
    for pedaco in DITADO:
        acumulado += pedaco
        canal["rota"].send(
            json.dumps(
                {
                    "type": "conversation.item.input_audio_transcription.delta",
                    "delta": pedaco,
                }
            )
        )
        esperado = (f"{antes}\n{acumulado}" if antes.strip() else acumulado).strip()
        if not espera(lambda: campo.input_value().strip() == esperado, 3.0):
            falhas.append(
                f"a palavra {pedaco!r} não chegou no campo: "
                f"esperava {esperado!r}, tem {campo.input_value()!r}"
            )
            break
    else:
        print(f"ok  as {len(DITADO)} palavras entraram uma a uma, durante a gravação")

    # A gravação tem de continuar de pé o tempo todo — se ela caiu no meio, o
    # texto acima chegou de outro jeito e a medição não vale.
    if pagina.locator('button[aria-label="Descartar áudio"]').count() == 0:
        falhas.append("a gravação caiu antes do fim — o texto não veio de uma fala viva")

    # 2. ENCERRAR: o final substitui o provisório e o ARQUIVO não sobe.
    pagina.locator('button[aria-label*="Enviar áudio"]').first.click()

    def veio_commit():
        return any(q.get("type") == "input_audio_buffer.commit" for q in quadros_do_cliente)

    if not espera(veio_commit, 5.0):
        falhas.append("o encerrar não fechou o turno no canal (nenhum commit subiu)")
    else:
        canal["rota"].send(
            json.dumps(
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": FINAL,
                }
            )
        )
        alvo = (f"{antes}\n{FINAL}" if antes.strip() else FINAL).strip()
        if espera(lambda: campo.input_value().strip() == alvo, 6.0):
            print("ok  o texto definitivo substituiu o provisório, sem sobra")
        else:
            falhas.append(
                f"o texto definitivo não assumiu: esperava {alvo!r}, tem {campo.input_value()!r}"
            )

    pagina.wait_for_timeout(2_000)
    if chamou_arquivo["n"]:
        falhas.append(
            f"o arquivo subiu assim mesmo ({chamou_arquivo['n']}×) — a mesma fala "
            "seria transcrita e colada duas vezes"
        )
    else:
        print("ok  a rota de arquivo não foi chamada nenhuma vez")

    foto = f"/tmp/prova-fala-ao-vivo-{porta}.png"
    pagina.screenshot(path=foto)
    navegador.close()

print(f"print em {foto}")

if falhas:
    print("\nREPROVOU")
    for f in falhas:
        print(f"  - {f}")
    sys.exit(1)

print("\nPASSOU")
