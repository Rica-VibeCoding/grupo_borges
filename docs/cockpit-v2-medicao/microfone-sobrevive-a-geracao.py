"""O ■ não pode comer o MICROFONE enquanto o agente pensa.

O defeito, medido na tela do Rica em 20/08: o slot de ação da caixa tinha
quatro donos em cascata e o ■ vencia o microfone quando o campo estava vazio
durante a geração. Quem fala — que é como o Rica trabalha — ficava sem gesto
para COMEÇAR a próxima mensagem, e a fila que o composer tinha acabado de
ganhar ficava inalcançável pelo caminho que ele mais usa.

A régua que esta bancada trava: o slot da caixa é do gesto de ENTRADA. Com o
campo vazio o alvo é o microfone, o agente pensando ou não. Parar mora na
linha da bolinha, ACIMA da caixa.

Encena a geração pelo `/api/fleet`, sem depender de agente de verdade
trabalhando — a bancada tem de rodar a qualquer hora, e agente ocupado sob
demanda é o que ela não pode exigir.

Uso: python3 microfone-sobrevive-a-geracao.py <porta> [slug]
"""

import json
import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
slug = sys.argv[2] if len(sys.argv) > 2 else "canarinho"

# 390x844 é o iPhone do Rica. A prova do microfone não precisa do teclado de
# pé, mas o aparelho certo importa: o slot é apertado no celular, e é lá que o
# beco aconteceu.
VIEWPORT = {"width": 390, "height": 844}

falhas: list[str] = []


def encena_trabalhando(rota):
    """Devolve o snapshot da frota com o agente-alvo em `trabalhando`."""
    resposta = rota.fetch()
    corpo = resposta.json()
    agentes = corpo.get("agents", corpo if isinstance(corpo, list) else [])
    for agente in agentes:
        if agente.get("slug") == slug:
            agente["status"] = "trabalhando"
            agente["lifecycle_status"] = "trabalhando"
    rota.fulfill(response=resposta, body=json.dumps(corpo))


with sync_playwright() as p:
    navegador = p.chromium.launch(channel="chrome")
    contexto = navegador.new_context(viewport=VIEWPORT)
    pagina = contexto.new_page()
    # A F3 abre um canal ao vivo com a OpenAI ao começar a gravar. Esta bancada
    # mede TELA, não fala: recusar o bilhete derruba o composer no caminho de
    # arquivo, que é exatamente o que ela sempre mediu.
    pagina.route("**/transcription/live-token", lambda rota: rota.abort())
    pagina.route("**/api/fleet*", encena_trabalhando)
    # `domcontentloaded`, nunca `networkidle`: o cockpit segura SSE aberto
    # (`/api/stream`, `/messages/stream`) e a rede nunca fica ociosa — as outras
    # bancadas do §5 já esperam assim, pelo mesmo motivo.
    pagina.goto(f"http://127.0.0.1:{porta}/agente/{slug}", wait_until="domcontentloaded")
    pagina.wait_for_timeout(4_000)

    microfone = pagina.locator('button[aria-label*="Segure para falar"]')
    parar = pagina.locator('button[aria-label^="Parar"]')

    # A ENCENAÇÃO PRECISA TER PEGADO, e esperar por ela é o que impede esta
    # bancada de passar VAZIA. `/agente/[slug]` é renderizado no servidor, então
    # o primeiro `agents` não passa pela interceptação — ela só vale do poll
    # seguinte em diante. Sem esta espera a bancada ficava verde com `gerando`
    # apagado, onde o microfone está presente em QUALQUER build, inclusive no
    # que tem o defeito. Aconteceu em 20/08, entre duas rodadas da mesma
    # bancada, e é o modo de falhar mais caro que existe: o verde que mente.
    try:
        parar.first.wait_for(state="visible", timeout=25_000)
    except Exception:
        pagina.screenshot(path=f"/tmp/prova-microfone-inconclusiva-{porta}.png")
        print("INCONCLUSIVO: `gerando` não acendeu — nada foi provado")
        navegador.close()
        sys.exit(2)

    # 1. O microfone existe com o campo vazio, mesmo com o agente trabalhando.
    if microfone.count() == 0:
        falhas.append("MICROFONE AUSENTE com o campo vazio durante a geração — é o defeito de 20/08")
    else:
        print(f"ok  microfone presente ({microfone.count()})")

    # 2. O ■ está ACIMA da caixa — não dentro dela, disputando o slot de entrada.
    caixa_parar = parar.first.bounding_box()
    formulario = pagina.locator("form").first.bounding_box()
    if caixa_parar and formulario:
        if caixa_parar["y"] >= formulario["y"]:
            falhas.append(
                f"■ dentro/abaixo do topo da caixa (y={caixa_parar['y']:.0f} vs form y={formulario['y']:.0f})"
            )
        else:
            print(f"ok  ■ acima da caixa (y={caixa_parar['y']:.0f} < form y={formulario['y']:.0f})")

    # 3. E não ocupa o mesmo ponto do microfone.
    if microfone.count() and caixa_parar:
        caixa_mic = microfone.first.bounding_box()
        if caixa_mic:
            if abs(caixa_mic["y"] - caixa_parar["y"]) < 8 and abs(caixa_mic["x"] - caixa_parar["x"]) < 8:
                falhas.append("■ e microfone no mesmo ponto — um está cobrindo o outro")
            else:
                print("ok  ■ e microfone em pontos distintos")

    # Nome com a PORTA: rodar contra a 3008 e a 3010 na mesma sessão com nome
    # fixo faz o print da segunda apagar o da primeira, e quem for conferir
    # olha o arquivo errado achando que é o certo.
    caminho = f"/tmp/prova-microfone-geracao-{porta}.png"
    pagina.screenshot(path=caminho)
    print(f"print em {caminho}")
    navegador.close()

if falhas:
    for f in falhas:
        print(f"FALHOU: {f}")
    sys.exit(1)
print("PASSOU")
