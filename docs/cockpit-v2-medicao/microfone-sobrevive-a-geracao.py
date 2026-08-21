"""O ■ não pode comer o MICROFONE enquanto o agente pensa.

O defeito, medido na tela do Rica em 20/08: o slot de ação da caixa tinha
quatro donos em cascata e o ■ vencia o microfone quando o campo estava vazio
durante a geração. Quem fala — que é como o Rica trabalha — ficava sem gesto
para COMEÇAR a próxima mensagem, e a fila que o composer tinha acabado de
ganhar ficava inalcançável pelo caminho que ele mais usa.

A régua que esta bancada trava: o slot de ENTRADA é do gesto de entrada. Com o
campo vazio o alvo é o microfone, o agente pensando ou não.

ONDE O ■ MORA MUDOU EM 21/08, e a bancada mudou junto. Ele passou 20/08 colado
na bolinha, acima da caixa, e o Rica recusou a vizinhança de olho nu:
*"precisamos reposicionar o componente parar, que está erradamente ao lado do
mascote"*. Ele voltou para a base da caixa como TERCEIRO slot.

"Parar mora acima da caixa" era a SOLUÇÃO de 20/08, não a régua — e régua que
congela solução trava a fase seguinte. O que não muda, e é o que esta bancada
mede: **o microfone não some, e ninguém cobre ninguém**. A volta para dentro da
caixa só é segura porque agora são três slots com um dono cada; o beco de
`678f598` era um slot com quatro.

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


def quem_esta_no_centro(pagina, seletor: str) -> str:
    """Quem o DEDO acha ao mirar o centro deste botão.

    `bounding_box` prova onde o alvo ESTÁ; não prova que ele é alcançável. Um
    vizinho que transborda por cima passa despercebido nas duas medidas de
    caixa e rouba o toque — foi o que aconteceu em 21/08, quando o ■ apertou a
    fileira em 44px e o rótulo de esforço (`shrink-0`, sem recorte no botão)
    saiu por cima do microfone. `elementFromPoint` é a única das três que
    responde a pergunta que interessa.
    """
    return pagina.evaluate(
        """(sel) => {
          const alvo = document.querySelector(sel);
          if (!alvo) return 'ausente';
          const r = alvo.getBoundingClientRect();
          const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if (!topo) return 'nada';
          return alvo.contains(topo) ? 'ok' : (topo.closest('button,a')?.getAttribute('aria-label') || topo.tagName);
        }""",
        seletor,
    )


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
    #
    # E `state="visible"` NÃO SERVE MAIS COMO ESSA PROVA — 21/08. Playwright
    # chama de visível todo elemento com caixa e sem `visibility: hidden`, e
    # `opacity: 0` passa. Enquanto o ■ nascia e morria no DOM isso bastava;
    # agora ele vive sempre montado e some pela tinta, então "visível" ficou
    # verde para o repouso também. Quem prova é a OPACIDADE.
    try:
        pagina.wait_for_function(
            """() => {
              const b = document.querySelector('button[aria-label^="Parar"]');
              return !!b && parseFloat(getComputedStyle(b).opacity) > 0.9;
            }""",
            timeout=25_000,
        )
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

    # 2. O ■ está DENTRO da caixa, na fileira da base — não mais colado na
    #    bolinha. É a metade que reprova o build de 20/08.
    caixa_parar = parar.first.bounding_box()
    formulario = pagina.locator("form").first.bounding_box()
    if caixa_parar and formulario:
        dentro = (
            caixa_parar["y"] >= formulario["y"] - 1
            and caixa_parar["y"] + caixa_parar["height"] <= formulario["y"] + formulario["height"] + 1
            and caixa_parar["x"] >= formulario["x"] - 1
            and caixa_parar["x"] + caixa_parar["width"] <= formulario["x"] + formulario["width"] + 1
        )
        if not dentro:
            falhas.append(
                f"■ FORA da caixa (y={caixa_parar['y']:.0f}, x={caixa_parar['x']:.0f} vs "
                f"form y={formulario['y']:.0f}..{formulario['y'] + formulario['height']:.0f}, "
                f"x={formulario['x']:.0f}..{formulario['x'] + formulario['width']:.0f})"
            )
        else:
            print(f"ok  ■ dentro da caixa (y={caixa_parar['y']:.0f}, x={caixa_parar['x']:.0f})")

    # 3. E não ocupa o mesmo ponto do microfone — agora são vizinhos de fileira,
    #    então a prova de não-sobreposição vale mais do que valia quando um
    #    estava 50px acima do outro.
    caixa_mic = microfone.first.bounding_box() if microfone.count() else None
    if caixa_mic and caixa_parar:
        if caixa_parar["x"] + caixa_parar["width"] > caixa_mic["x"] + 1:
            falhas.append(
                f"■ invade o microfone (■ termina em {caixa_parar['x'] + caixa_parar['width']:.0f}, "
                f"microfone começa em {caixa_mic['x']:.0f})"
            )
        else:
            print("ok  ■ à esquerda do microfone, sem sobreposição")

        # 3b. E são VIZINHOS, não parentes distantes. Sem esta metade a régua
        #     passaria com o ■ largado no outro canto da caixa.
        #
        #     A conta é de PASSO (x a x), não de vão entre bordas: `bounding_box`
        #     devolve o alvo de 44px, não o disco de 32 — `ALVO_DE_TOQUE` infla
        #     com padding e desinfla com margem negativa igual, então os alvos
        #     se ENCOSTAM (vão = 0) enquanto os discos guardam os 12px de gap.
        #     Medir borda a borda aqui reprovaria o layout certo, e foi o que
        #     esta bancada fez na primeira rodada. Passo = 32 do disco + 12 do
        #     gap, o mesmo 44 que a bancada irmã cobra do deslocamento.
        passo = caixa_mic["x"] - caixa_parar["x"]
        if abs(passo - 44) > 4:
            falhas.append(f"■ a {passo:.0f}px do microfone — esperado o passo do slot (44px)")
        else:
            print(f"ok  ■ no slot vizinho do microfone (passo {passo:.0f}px)")


    # O DEDO ACHA O MICROFONE? As caixas provam posição, não alcance — ver a
    # docstring de `quem_esta_no_centro`.
    intruso = quem_esta_no_centro(pagina, 'button[aria-label*="Segure para falar"]')
    if intruso != "ok":
        falhas.append(f"algo cobre o centro do microfone: {intruso}")
    else:
        print("ok  o centro do microfone pertence ao microfone")

    # 4. SEM VÃO à esquerda do ■. O botão entra em cena ocupando espaço que os
    #    chips cobriam com um deslize; se o deslize não desfizer, sobra o buraco
    #    que o Rica recusou na F2.3 — *"uma boca com um dente a menos"*.
    chips = pagina.locator('.ck-troca-da-fala-face[data-face="acoes"]').first
    caixa_chips = chips.bounding_box() if chips.count() else None
    if caixa_chips and caixa_parar:
        vao_chips = caixa_parar["x"] - (caixa_chips["x"] + caixa_chips["width"])
        if vao_chips > 16:
            falhas.append(
                f"vão de {vao_chips:.0f}px entre os chips e o ■ — os chips não deslizaram de volta"
            )
        else:
            print(f"ok  chips encostados no ■ ({vao_chips:.0f}px)")

    # 5. E ele APARECE com o slow da casa, não de estalo (Rica, 20/08).
    propriedade = parar.first.evaluate("el => getComputedStyle(el).transitionProperty")
    duracao = parar.first.evaluate("el => getComputedStyle(el).transitionDuration")
    segundos = max((float(t.rstrip("s")) for t in duracao.split(", ")), default=0.0)
    if "opacity" not in propriedade or segundos <= 0:
        falhas.append(f"■ sem transição de opacidade (property={propriedade}, duration={duracao})")
    else:
        print(f"ok  ■ entra com o slow da casa ({duracao})")

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
