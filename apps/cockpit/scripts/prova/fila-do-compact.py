"""Prova dirigida da fila do compact — a promessa do composer virando verdade.

O defeito: `porta-de-envio.ts` dizia "compactando — sua mensagem continua aqui e
sai quando a barra sumir", e NADA reenviava. O texto ficava no campo e morria ali
se o Rica trocasse de tela.

As duas metades, e não aceito uma sem a outra:

  A. **A mensagem sai.** Escrever durante um compact real, não tocar em mais
     nada, e a mensagem chegar ao agente sozinha quando o compact terminar.
  B. **O bloqueio continua valendo.** NENHUMA mensagem chega ao agente DURANTE o
     compact — se a fila despachar cedo, ela corta o resumo, que é o defeito que
     a trava existe para impedir. Provado pelos dois lados: nada no JSONL
     enquanto a espera dura, e o resumo nascendo inteiro ANTES da mensagem.

Compact de VERDADE, sem interceptar: o que se mede é a espera real e a ordem em
que as duas coisas chegam ao agente. Um `fulfill` provaria só o desenho.

Alvo é o `canario` — agente descartável do gate (`agents.yaml:186`), casa própria
em `fixtures/cockpit-v2/canario`. Nunca um agente produtivo: aqui o compact é
real e apaga o contexto do alvo.

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
SAIDA = Path(os.environ.get("PROVA_SAIDA", "/home/clawd/provas")) / "cockpit-fila-do-compact"
JSONL_DIR = Path.home() / ".claude/projects/-home-clawd-repos-grupo-borges-fixtures-cockpit-v2-canario"

MARCA = str(int(time.time()))
NA_FILA = f"prova de fila do compact {MARCA} — nao precisa responder"
SEGUNDA = f"segunda da fila {MARCA} — nao precisa responder"


def despacha(texto: str) -> None:
    """Envia direto pela API — serve só ao aquecimento, nunca ao que se mede."""
    req = urllib.request.Request(
        f"{API}/api/agents/{SLUG}/input",
        data=json.dumps(
            {"text": texto, "idempotency_key": f"prova-compact-{MARCA}-{len(texto)}"}
        ).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        assert resp.status == 200, f"despacho falhou: {resp.status}"


def eventos() -> list[dict]:
    """TODOS os JSONL da casa do canário, em ordem de escrita.

    Varrer só o arquivo mais novo não serve aqui: o `/compact` grava o resumo num
    arquivo NOVO, e a metade B precisa enxergar os dois lados da fronteira para
    afirmar que nada vazou durante a espera.
    """
    saida = []
    for arquivo in sorted(JSONL_DIR.glob("*.jsonl"), key=lambda p: p.stat().st_mtime):
        for linha in arquivo.read_text(errors="replace").splitlines():
            try:
                saida.append(json.loads(linha))
            except json.JSONDecodeError:
                continue
    return saida


def texto_do_evento(evento: dict) -> str:
    conteudo = (evento.get("message") or {}).get("content")
    if isinstance(conteudo, str):
        return conteudo
    if isinstance(conteudo, list):
        return "".join(p.get("text", "") for p in conteudo if isinstance(p, dict))
    return ""


def chegou_ao_agente(frase: str) -> bool:
    """A frase virou linha `user` no JSONL — é o agente TENDO RECEBIDO, não a
    tela achando que mandou."""
    return any(
        e.get("type") == "user" and texto_do_evento(e).strip() == frase for e in eventos()
    )


def resumo_do_compact() -> dict | None:
    """A linha que o `/compact` grava: `type=user` com `isCompactSummary`."""
    for evento in reversed(eventos()):
        if evento.get("isCompactSummary"):
            return evento
    return None


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)

    # Aquecimento: sem JSONL a página abre com o stream sem sessão para seguir, e
    # um `/compact` sem nada para compactar não gera espera nenhuma.
    despacha("aquecendo a sessao para a prova do compact, nao precisa responder")
    time.sleep(15)
    resumo_antes = resumo_do_compact()
    uuid_antes = resumo_antes.get("uuid") if resumo_antes else None

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={"width": 480, "height": 1000})
        erros: list[str] = []
        pag.on("pageerror", lambda e: erros.append(str(e)))
        pag.goto(URL, wait_until="domcontentloaded")
        # Pelo elemento, não pelo placeholder: ele MUDA durante a espera ("pode
        # escrever, entra na fila"), e um seletor que depende dele some
        # justamente no instante que esta prova mede. Custou uma corrida.
        campo = pag.locator("textarea").first
        campo.wait_for(timeout=30_000)
        pag.wait_for_timeout(3_000)  # SSE conectar e o histórico assentar

        # --- a espera começa -------------------------------------------------
        campo.fill("/compact")
        campo.press("Enter")
        # A barra nasce com o CLIQUE, não com o 200 (`composer.tsx`), então
        # esperar por ela é esperar o FATO da espera ter começado.
        barra = pag.get_by_role("progressbar", name="Compactando a conversa")
        barra.wait_for(timeout=30_000)
        print("✓ o compact começou — a barra está na tela")

        # --- METADE A (primeira parte): o texto sai do campo e fica à vista ---
        campo.fill(NA_FILA)
        campo.press("Enter")
        fila = pag.get_by_text("na fila — sai quando o compact terminar")
        fila.wait_for(timeout=15_000)
        assert campo.input_value() == "", (
            "o texto continuou no campo: ou não enfileirou, ou ficou em dois lugares"
        )
        assert pag.get_by_text(NA_FILA, exact=False).count() >= 1, (
            "a fila mostrou a contagem em vez do texto — quem cancela precisa ler o que escreveu"
        )
        # Fila de N: a segunda entra sem inventar um segundo estado de recusa.
        campo.fill(SEGUNDA)
        campo.press("Enter")
        pag.get_by_text(SEGUNDA, exact=False).first.wait_for(timeout=15_000)
        pag.screenshot(path=SAIDA / "1-fila-durante-o-compact.png", full_page=True)
        print("✓ A1 — duas mensagens penduradas à vista, campo limpo")

        # --- METADE B: NADA chega ao agente enquanto a espera dura ------------
        # Verificado ao longo de toda a espera, não uma vez no fim: a pergunta é
        # se a fila vazou EM ALGUM instante, e uma amostra só não responde isso.
        prazo = time.monotonic() + 420
        while time.monotonic() < prazo:
            if not barra.is_visible():
                break
            assert not chegou_ao_agente(NA_FILA), (
                "a fila despachou DURANTE o compact — é o resumo sendo cortado ao meio, "
                "o defeito que a trava existe para impedir"
            )
            assert not chegou_ao_agente(SEGUNDA), "a segunda da fila vazou durante o compact"
            pag.wait_for_timeout(1_000)
        assert not barra.is_visible(), "o compact não terminou em 7min — a prova não chegou a medir A"
        print("✓ B — a espera inteira sem nenhuma das duas chegar ao agente")

        # --- METADE A (segunda parte): sai sozinha, sem toque nenhum ----------
        prazo = time.monotonic() + 180
        while time.monotonic() < prazo and not chegou_ao_agente(NA_FILA):
            pag.wait_for_timeout(2_000)
        assert chegou_ao_agente(NA_FILA), (
            "o compact terminou e a mensagem não saiu sozinha — a promessa continua mentira"
        )
        print("✓ A2 — a primeira da fila chegou ao agente sem nenhum toque")

        prazo = time.monotonic() + 300
        while time.monotonic() < prazo and not chegou_ao_agente(SEGUNDA):
            pag.wait_for_timeout(2_000)
        assert chegou_ao_agente(SEGUNDA), "a segunda nunca drenou — a serialização travou a fila"
        print("✓ A3 — a segunda saiu atrás, serializada")

        # --- B, o outro lado: o resumo nasceu INTEIRO e ANTES -----------------
        resumo = resumo_do_compact()
        assert resumo is not None, "o compact não gravou resumo nenhum"
        assert resumo.get("uuid") != uuid_antes, "o resumo é o de uma corrida anterior"
        corpo = texto_do_evento(resumo)
        assert len(corpo) > 500, f"resumo cortado, {len(corpo)} caracteres — a fila comeu o meio"
        ordem = [
            i
            for i, e in enumerate(eventos())
            if e.get("uuid") == resumo.get("uuid")
            or (e.get("type") == "user" and texto_do_evento(e).strip() == NA_FILA)
        ]
        assert len(ordem) >= 2 and ordem[0] < ordem[1], (
            "a mensagem da fila foi gravada ANTES do resumo — ela cortou o compact"
        )
        print(f"✓ B2 — resumo inteiro ({len(corpo)} caracteres) e gravado ANTES da fila")

        # --- o bloco some quando a fila esvazia -------------------------------
        assert pag.get_by_text("na fila — sai quando o compact terminar").count() == 0, (
            "o bloco ficou na tela com a fila vazia"
        )
        assert not erros, f"a tela quebrou no caminho: {erros}"
        pag.screenshot(path=SAIDA / "2-fila-drenada.png", full_page=True)
        print("✓ o bloco saiu da tela e nenhum erro de página no caminho")

        nav.close()

    print(f"\nprints em {SAIDA}")


if __name__ == "__main__":
    main()
