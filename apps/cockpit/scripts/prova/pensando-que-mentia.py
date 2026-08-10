"""Prova dirigida do "Pensando" que não desligava (23a20de).

As duas metades:
  1. o defeito sumiu  — agente parado, cuja última mensagem no log é um comando
     local (`/clear`, `/compact`) ou cujo turno morreu sem despedida, NÃO mostra
     mais a linha viva
  2. o que funcionava continua — agente que está mesmo no meio de um turno segue
     com a corrida ligada, e o feed dele desenha normalmente

Roda contra a 3008 (produção publicada na :3446), sem encenar nada: os alvos
são escolhidos pelo estado REAL da frota no instante da prova. Quem decide é a
régua antiga — o agente só entra na lista se ela diria "Pensando" ali agora.

    python3 apps/cockpit/scripts/prova/pensando-que-mentia.py

`domcontentloaded`, nunca `networkidle`: a página vive de SSE e o networkidle
não chega nunca.
"""

import json
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3008"
API = "http://127.0.0.1:8000"


def replay(slug: str, segundos: int = 6) -> list[dict]:
    """O mesmo replay que o feed recebe, lido direto do SSE."""
    saida = subprocess.run(
        ["curl", "-sN", "--max-time", str(segundos),
         f"{API}/api/agents/{slug}/messages/stream?limit=100&recentes=1&maxResultChars=500"],
        capture_output=True, text=True,
    ).stdout
    eventos = []
    for linha in saida.splitlines():
        if not linha.startswith("data: "):
            continue
        try:
            evento = json.loads(linha[6:])
        except json.JSONDecodeError:
            continue
        if isinstance(evento, dict) and evento.get("id"):
            eventos.append(evento)
    return eventos


def regua_antiga(eventos: list[dict]) -> bool:
    """A régua que mentia: todo `user` liga, só `end_turn` desliga."""
    ligada = False
    for evento in eventos:
        mensagem = evento.get("message") or {}
        if mensagem.get("role") == "user":
            ligada = True
        elif mensagem.get("role") == "assistant":
            ligada = mensagem.get("stop_reason") != "end_turn"
    return ligada


def idade_minutos(eventos: list[dict]) -> float:
    ultimo = eventos[-1].get("timestamp") if eventos else None
    if not isinstance(ultimo, str):
        return float("nan")
    from datetime import datetime, timezone
    quando = datetime.fromisoformat(ultimo.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - quando).total_seconds() / 60


def sse(mensagens: list[dict]) -> str:
    corpo = ["event: replay-start", "data: {}", ""]
    for mensagem in mensagens:
        corpo += [f"data: {json.dumps(mensagem, ensure_ascii=False)}", ""]
    corpo += ["event: replay-end", "data: {}", ""]
    return "\n".join(corpo) + "\n"


def mensagem_user(id_: int, texto: str, agora_ms: int) -> dict:
    from datetime import datetime, timezone
    return {
        "id": id_,
        "kind": "user",
        "uuid": f"prova-{id_}",
        "parent_uuid": None,
        "session_id": "prova",
        "is_sidechain": False,
        "user_type": "external",
        "timestamp": datetime.fromtimestamp(agora_ms / 1000, timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "created_at": agora_ms // 1000,
        "message": {"role": "user", "content": [{"type": "text", "text": texto}]},
        "tool_use_result": None,
        "agent_id": None,
    }


def metade_do_recurso(pagina, slug: str) -> int:
    """A OUTRA metade: com uma fala de verdade recém-chegada e nada mais, a
    linha viva PRECISA aparecer — senão o conserto virou remoção. O stream é
    interceptado aqui de propósito: o que se mede é o feed reagindo ao estado,
    não o caminho CLI→JSONL→SSE, que esta mudança não tocou."""
    falhas = 0
    agora_ms = int(time.time() * 1000)
    casos = [
        ("fala do Rica agora", "arruma o feed pra mim", True),
        ("comando local (/clear)", CAVEAT_DO_CLEAR, False),
    ]
    for nome, texto, espera_linha in casos:
        corpo = sse([mensagem_user(1, texto, agora_ms)])

        # O handler do `page.route` recebe (route, request) — dois argumentos.
        # Com `lambda rota, _corpo=corpo` o request cai no corpo e o fulfill
        # morre com "Object of type Request is not JSON serializable".
        def responde(rota, _requisicao=None, _corpo=corpo):
            rota.fulfill(
                status=200,
                headers={"content-type": "text/event-stream", "cache-control": "no-cache"},
                body=_corpo,
            )

        pagina.route("**/api/agents/*/messages/stream*", responde)
        pagina.goto(f"{BASE}/agente/{slug}", wait_until="domcontentloaded")
        pagina.wait_for_timeout(4000)
        tem = pagina.locator("text=Pensando").count() > 0
        pagina.unroute("**/api/agents/*/messages/stream*")
        if tem == espera_linha:
            print(f"  ✓ {nome}: linha viva na tela = {tem}")
        else:
            print(f"  ✗ {nome}: linha viva na tela = {tem}, esperado {espera_linha}")
            falhas += 1
    return falhas


CAVEAT_DO_CLEAR = (
    "<local-command-caveat>Caveat: The messages below were generated by the user "
    "while running local commands. DO NOT respond to these messages or otherwise "
    "consider them in your response unless the user explicitly asks you to."
    "</local-command-caveat>"
)


def main() -> int:
    from playwright.sync_api import sync_playwright

    frota = json.load(urllib.request.urlopen(f"{API}/api/fleet"))["agents"]

    mentirosos, trabalhando = [], []
    for agente in frota:
        eventos = replay(agente["slug"])
        if len(eventos) < 5:
            continue
        if regua_antiga(eventos):
            (trabalhando if idade_minutos(eventos) < 2 else mentirosos).append(agente["slug"])

    if not mentirosos:
        print("nenhum agente no estado do defeito agora — prova inconclusiva")
        return 2

    falhas = 0
    with sync_playwright() as p:
        navegador = p.chromium.launch(channel="chrome")
        pagina = navegador.new_page(viewport={"width": 430, "height": 932})
        erros: list[str] = []
        pagina.on("pageerror", lambda e: erros.append(str(e)))

        for slug in mentirosos + trabalhando:
            pagina.goto(f"{BASE}/agente/{slug}", wait_until="domcontentloaded")
            # O feed é client-side: dá tempo do SSE entregar o replay inteiro.
            time.sleep(8)
            texto = pagina.inner_text("body")
            pensando = "Pensando" in texto
            esperado = slug in trabalhando and pensando
            if slug in mentirosos and pensando:
                print(f"  ✗ {slug}: a linha viva ainda aparece — a régua antiga dizia o mesmo")
                falhas += 1
            elif slug in mentirosos:
                print(f"  ✓ {slug}: parado e SEM 'Pensando' (a régua antiga mostraria)")
            else:
                print(f"  · {slug}: em turno, 'Pensando' na tela: {pensando}"
                      f" — feed com {len(texto)} caracteres{' ' if esperado else ''}")

        falhas += metade_do_recurso(pagina, mentirosos[0])

        if erros:
            print(f"  ✗ {len(erros)} erro(s) de página: {erros[:2]}")
            falhas += 1
        else:
            print("  ✓ nenhum erro de página nas telas abertas")

        navegador.close()

    print("PROVA OK" if falhas == 0 else f"PROVA FALHOU ({falhas})")
    return 0 if falhas == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
