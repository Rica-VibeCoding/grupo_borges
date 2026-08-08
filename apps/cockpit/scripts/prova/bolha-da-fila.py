"""Prova dirigida da tropa_task e615c350 — mensagem enfileirada nunca virava bolha.

As duas metades:
  1. o defeito sumiu  — com o agente NO MEIO de um turno, a frase enviada pelo
     cockpit vira bolha no feed na hora, e não só quando a fila drena
  2. o que funcionava continua — mensagem com o agente ocioso segue com UMA
     bolha; e quando a fila drena, o eco `user` NÃO abre uma segunda

Alvo é o `canario` — agente descartável do gate (agents.yaml:186), casa própria
em `fixtures/cockpit-v2/canario`. Nunca apontar para pavan/daniel: aqui o envio
é de verdade, não interceptado, porque o que se mede é o caminho inteiro
CLI → JSONL → SSE → feed. Interceptar o `POST /input` provaria só o desenho.

O canário fica DESLIGADO por padrão. Subir com o mesmo comando que o
`tmux_driver` monta (cerca de memória inclusa), e derrubar no fim:

    tmux new-session -d -s canario -c ~/repos/grupo_borges/fixtures/cockpit-v2/canario
    tmux send-keys -t canario 'systemd-run --user --scope --slice=borges-frota.slice \\
      -p MemoryHigh=1500M -- claude --dangerously-skip-permissions \\
      --model claude-opus-4-8' Enter
    # no fim: tmux kill-session -t canario
"""

import json
import os
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

SLUG = "canario"
API = "http://127.0.0.1:8000"
URL = f"http://127.0.0.1:3009/agente/{SLUG}"
SAIDA = Path(os.environ.get("PROVA_SAIDA", "/home/clawd/provas")) / "cockpit-bolha-da-fila"
# Casa própria do canário (agents.yaml:196), codificada como o CC codifica cwd.
JSONL_DIR = Path.home() / ".claude/projects/-home-clawd-repos-grupo-borges-fixtures-cockpit-v2-canario"

MARCA = str(int(time.time()))
OCIOSA = f"prova ociosa {MARCA} — nao precisa responder"
NA_FILA = f"prova de fila {MARCA} — nao precisa responder"
# Turno longo o bastante pra dar tempo de digitar e ver a bolha nascer, curto o
# bastante pra a drenagem caber na mesma corrida. O comando é explícito porque
# as duas saídas fáceis anulam a prova: `sleep` cru é bloqueado pelo harness, e
# `run_in_background` encerra o turno na hora — numa corrida assim o agente já
# está OCIOSO quando a mensagem chega, ela vira eco `user` comum e a prova passa
# sem ter medido a fila (aconteceu, 07/08).
TURNO_LONGO = (
    "roda no Bash, em FOREGROUND (nunca run_in_background), este comando exato e "
    "espera terminar: python3 -c \"import time; time.sleep(75); print('canario-ocupado')\". "
    "nao faz mais nada."
)


def despacha(texto: str) -> None:
    """Envia direto pela API — é o que põe o canário em turno, sem passar pela UI."""
    req = urllib.request.Request(
        f"{API}/api/agents/{SLUG}/input",
        data=json.dumps({"text": texto, "idempotency_key": f"prova-fila-{MARCA}-{len(texto)}"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        assert resp.status == 200, f"despacho falhou: {resp.status}"


def eventos_do_canario() -> list[dict]:
    """O JSONL vivo do canário — fonte da verdade do turno, não a tela."""
    arquivos = sorted(JSONL_DIR.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    if not arquivos:
        return []
    saida = []
    for linha in arquivos[-1].read_text(errors="replace").splitlines():
        try:
            saida.append(json.loads(linha))
        except json.JSONDecodeError:
            continue
    return saida


def linhas_user(frase: str) -> int:
    """Quantas linhas `type=user` com esta frase EXATA já foram gravadas."""
    total = 0
    for evento in eventos_do_canario():
        if evento.get("type") != "user":
            continue
        conteudo = (evento.get("message") or {}).get("content")
        texto = conteudo if isinstance(conteudo, str) else "".join(
            parte.get("text", "") for parte in conteudo if isinstance(parte, dict)
        ) if isinstance(conteudo, list) else ""
        if texto.strip() == frase:
            total += 1
    return total


def drenou(frase: str) -> bool:
    """A fila saiu da caixa de entrada do CLI, por qualquer um dos dois caminhos.

    `queue-operation remove` é a drenagem DENTRO do turno em curso — e nesse
    caminho não existe linha `user` nenhuma (canário, 07/08). O eco é a
    drenagem em turno novo. Esperar só pelo eco trava a prova para sempre no
    primeiro caminho, que é justamente o mais comum aqui.
    """
    for evento in eventos_do_canario():
        if (
            evento.get("type") == "queue-operation"
            and evento.get("operation") == "remove"
            and str(evento.get("content") or "").strip() == frase
        ):
            return True
    return linhas_user(frase) >= 1


def bolhas(pag, frase: str) -> int:
    """Quantas vezes a frase aparece no feed. O campo de entrada é textarea —
    `get_by_text` não casa valor de input, então não há contaminação."""
    return pag.get_by_text(frase, exact=False).count()


def espera_bolha(pag, frase: str, limite_ms: int) -> float:
    inicio = time.monotonic()
    prazo = inicio + limite_ms / 1000
    while time.monotonic() < prazo:
        if bolhas(pag, frase) >= 1:
            return time.monotonic() - inicio
        pag.wait_for_timeout(500)
    raise AssertionError(f"a frase nunca virou bolha em {limite_ms}ms: {frase!r}")


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)

    # Aquecimento: numa sessão tmux recém-criada não existe JSONL ainda, e a
    # página aberta antes dele fica com o stream sem sessão pra seguir — o feed
    # nunca desenha nada e a prova falha por fora do que mede.
    despacha("aquecendo a sessao, nao precisa responder")
    time.sleep(15)

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={"width": 480, "height": 1000})
        pag.goto(URL, wait_until="domcontentloaded")
        campo = pag.get_by_placeholder("Mensagem para")
        campo.wait_for(timeout=30_000)
        pag.wait_for_timeout(3_000)  # SSE conectar e o histórico assentar

        # --- METADE B1: agente ocioso, uma bolha só ------------------------
        campo.fill(OCIOSA)
        campo.press("Enter")
        espera_bolha(pag, OCIOSA, 60_000)
        pag.wait_for_timeout(5_000)
        assert bolhas(pag, OCIOSA) == 1, f"mensagem comum duplicou: {bolhas(pag, OCIOSA)}"
        print("✓ B1 — agente ocioso: uma bolha só")

        # --- METADE A: mensagem no meio de um turno ------------------------
        despacha(TURNO_LONGO)
        # Esperar o CLI CONSUMIR o pedido, não um relógio: o despacho só cola no
        # pane, e o turno anterior pode segurar a vez por mais de um minuto.
        prazo = time.monotonic() + 180
        while linhas_user(TURNO_LONGO) == 0 and time.monotonic() < prazo:
            pag.wait_for_timeout(2_000)
        assert linhas_user(TURNO_LONGO) >= 1, "o canário nunca entrou no turno longo"
        pag.wait_for_timeout(8_000)  # ele morde o Bash e fica preso nele

        campo.fill(NA_FILA)
        campo.press("Enter")
        # O aviso "entrou na fila" do composer é assentado e some sozinho
        # (sucesso é silêncio, aparencia-envio.ts:143) — olhar dentro do mesmo
        # laço da bolha é o único jeito de flagrá-lo. A régua é a bolha; o
        # aviso é a contraprova de que os dois falam da mesma entrega.
        viu_aviso = False
        inicio = time.monotonic()
        prazo = inicio + 45
        while time.monotonic() < prazo:
            viu_aviso = viu_aviso or bolhas(pag, "entrou na fila") >= 1
            if bolhas(pag, NA_FILA) >= 1:
                break
            pag.wait_for_timeout(250)
        levou = time.monotonic() - inicio
        pag.screenshot(path=SAIDA / "1-bolha-na-fila.png", full_page=True)
        assert bolhas(pag, NA_FILA) == 1, f"bolha da fila ausente ou duplicada: {bolhas(pag, NA_FILA)}"
        # A marca é o que separa "a bolha da fila apareceu" de "o agente estava
        # ocioso e isto é o eco de sempre" — sem ela a prova não mede nada.
        assert bolhas(pag, "na fila") >= 1, "a bolha veio sem a marca: o agente não estava em turno"
        print(f"✓ A — a bolha da fila nasceu em {levou:.1f}s, com o turno rodando")
        print(f"  aviso 'entrou na fila' visto no composer: {viu_aviso}")

        # --- METADE B2: a fila drena e não nasce segunda bolha -------------
        # O fim da espera é a DRENAGEM no JSONL, não um relógio: cronometrar
        # fez a corrida de 07/08 terminar com o turno ainda rodando e ler a
        # marca legítima como defeito. Drenar tem duas formas — o `remove` (a
        # fila entrou no turno em curso) e o eco `user` (entrou num turno
        # novo). Enquanto nenhuma das duas chega, a bolha marcada é o certo.
        prazo = time.monotonic() + 300
        while time.monotonic() < prazo:
            assert bolhas(pag, NA_FILA) == 1, (
                f"nasceu uma SEGUNDA bolha da mesma frase: {bolhas(pag, NA_FILA)}"
            )
            if drenou(NA_FILA):
                break
            pag.wait_for_timeout(3_000)
        assert drenou(NA_FILA), "a fila nunca drenou — B2 não chegou a ser medida"
        pag.wait_for_timeout(30_000)  # a drenagem atravessar watcher → SSE → feed
        assert bolhas(pag, NA_FILA) == 1, f"duplicou depois da drenagem: {bolhas(pag, NA_FILA)}"
        assert bolhas(pag, OCIOSA) == 1, f"a mensagem comum duplicou no caminho: {bolhas(pag, OCIOSA)}"
        assert bolhas(pag, "na fila") == 0, "a marca não caiu depois que o turno consumiu a frase"
        pag.screenshot(path=SAIDA / "2-fila-drenada-sem-duplicata.png", full_page=True)
        print("✓ B2 — fila drenada: uma bolha só, sem eco duplicado")

        nav.close()

    print(f"\nprints em {SAIDA}")


if __name__ == "__main__":
    main()
