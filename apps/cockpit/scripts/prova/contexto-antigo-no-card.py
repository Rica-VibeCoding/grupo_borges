"""Prova dirigida — o card mostrava contexto de um run morto como se fosse de agora.

O defeito: a thread do Codex era procurada pelo `workspace_path` cadastrado do
agente, mas o run sai com `-C <repo do dia>` e o Codex indexa a thread pelo cwd
REAL. O painel servia a thread do run ANTERIOR — com o número e o modelo dela — e
ainda declarava a leitura como atual.

As duas metades:
  1. o buraco fechou   — contexto medido antes desta sessão aparece no card com a
     palavra `antigo` ao lado do número
  2. o que funcionava continua — contexto medido DENTRO da sessão aparece limpo:
     mesmo número, mesma barra, sem etiqueta nenhuma

A metade 1 é lida do estado REAL da frota; a metade 2 é obtida interceptando o
`/api/fleet` do poll ao vivo e adiantando só o carimbo da medição — nenhum agente
produtivo é despachado ou derrubado (regras 1 e 2 do README).
"""

import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3009"
SAIDA = Path(os.environ.get("PROVA_SAIDA", "/home/clawd/provas")) / "cockpit-contexto-antigo"
ALVO = os.environ.get("PROVA_SLUG", "tara")
# O poll do `useFrotaAoVivo` são 5s; 20s cobre duas rodadas com folga.
ESPERA_MS = 20_000


def linha_do_card(pag, slug: str) -> str:
    card = pag.locator(f"a[href='/agente/{slug}']").first
    card.wait_for(timeout=30_000)
    return card.inner_text()


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    falhas: list[str] = []

    with sync_playwright() as p:
        navegador = p.chromium.launch(channel="chrome", args=["--no-sandbox"])
        pag = navegador.new_page(viewport={"width": 430, "height": 900}, device_scale_factor=2)

        # --- metade 1: o estado real de hoje, com o número velho etiquetado ---
        pag.goto(BASE, wait_until="domcontentloaded")
        antes = linha_do_card(pag, ALVO)
        pag.screenshot(path=str(SAIDA / "1-velho-etiquetado.png"))
        if "antigo" not in antes:
            falhas.append(f"metade 1: card de {ALVO} sem a palavra 'antigo' — leu {antes!r}")

        # --- metade 2: mesma tela, medição adiantada pra dentro da sessão ---
        def frescor(rota):
            corpo = rota.fetch().json()
            for agente in corpo["agents"]:
                if agente["slug"] == ALVO:
                    agente["context_stale"] = False
                    agente["context_updated_at"] = int(time.time())
            # Sem repassar a resposta original: os headers dela descrevem o corpo
            # que ela trazia, e um `content-encoding` herdado faz o browser
            # tentar descomprimir texto puro e descartar a rodada inteira.
            rota.fulfill(status=200, content_type="application/json", body=json.dumps(corpo))

        pag.route("**/api/fleet*", frescor)
        pag.wait_for_function(
            "([slug, alvo]) => {"
            "  const card = document.querySelector(`a[href='/agente/${slug}']`);"
            "  return card !== null && !card.innerText.includes(alvo);"
            "}",
            arg=[ALVO, "antigo"],
            timeout=ESPERA_MS,
        )
        depois = linha_do_card(pag, ALVO)
        pag.screenshot(path=str(SAIDA / "2-atual-sem-etiqueta.png"))

        pct_antes = [t for t in antes.split() if t.endswith("%")]
        pct_depois = [t for t in depois.split() if t.endswith("%")]
        if pct_antes != pct_depois:
            falhas.append(
                f"metade 2: o número mudou junto com a etiqueta ({pct_antes} → {pct_depois}); "
                "a correção é sobre a idade declarada, não sobre o valor"
            )

        navegador.close()

    print(f"antes : {antes.strip()!r}")
    print(f"depois: {depois.strip()!r}")
    print(f"capturas em {SAIDA}")
    for falha in falhas:
        print(f"FALHOU — {falha}")
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
