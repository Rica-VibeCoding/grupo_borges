"""Prova dirigida — o card mostrava contexto de um run morto como se fosse de agora.

O defeito: a thread do Codex era procurada pelo `workspace_path` cadastrado do
agente, mas o run sai com `-C <repo do dia>` e o Codex indexa a thread pelo cwd
REAL. O painel servia a thread do run ANTERIOR — com o número e o modelo dela — e
ainda declarava a leitura como atual (`stale: false`).

As duas metades, no MESMO card:
  1. o buraco fechou   — com o contexto marcado como velho, o número aparece
     acompanhado da palavra `antigo`
  2. o que funcionava continua — com o contexto medido dentro da sessão, o card
     volta limpo: MESMO número, mesma barra, sem etiqueta nenhuma

Os dois estados vêm de interceptação do `/api/fleet` do poll ao vivo, não do humor
da frota: o card do alvo troca de estado com a página aberta, e é essa troca que a
prova observa. Roteiro preso ao estado real quebra sozinho quando o agente entra ou
sai — foi o que aconteceu na primeira versão. Nenhum agente é despachado ou
derrubado (regras 1 e 2 do README).

Estado real medido em 09/08 16:19, já com o conserto no ar: `tara` trabalhando,
`context_pct` 32.9 medido às 16:19:08, `stale` falso — o número de 14:59:33 parou
de aparecer porque a thread certa passou a ser encontrada.
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


def instala_interceptacao(pag, estado: dict):
    """Um handler só, lendo `estado` — trocar a rota no meio do poll deixa a
    requisição em voo órfã ("Route is already handled") e a prova morre sem testar
    nada. O que muda entre as metades é o dicionário, não a rota."""

    def rota_handler(rota):
        corpo = rota.fetch().json()
        agora = int(time.time())
        for agente in corpo["agents"]:
            if agente["slug"] == ALVO:
                agente["context_stale"] = estado["velho"]
                agente["context_updated_at"] = agora - 3_600 if estado["velho"] else agora
        # Sem repassar a resposta original: os headers dela descrevem o corpo que
        # ela trazia, e um `content-encoding` herdado faz o browser tentar
        # descomprimir texto puro e descartar a rodada inteira, calado.
        rota.fulfill(status=200, content_type="application/json", body=json.dumps(corpo))

    pag.route("**/api/fleet*", rota_handler)


def espera_etiqueta(pag, *, presente: bool):
    pag.wait_for_function(
        "([slug, alvo, querAparecer]) => {"
        "  const card = document.querySelector(`a[href='/agente/${slug}']`);"
        "  if (card === null) return false;"
        "  return card.innerText.includes(alvo) === querAparecer;"
        "}",
        arg=[ALVO, "antigo", presente],
        timeout=ESPERA_MS,
    )


def numeros(texto: str) -> list[str]:
    return [pedaco for pedaco in texto.split() if pedaco.endswith("%")]


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    falhas: list[str] = []

    with sync_playwright() as p:
        navegador = p.chromium.launch(channel="chrome", args=["--no-sandbox"])
        pag = navegador.new_page(viewport={"width": 430, "height": 900}, device_scale_factor=2)
        estado = {"velho": True}
        instala_interceptacao(pag, estado)
        pag.goto(BASE, wait_until="domcontentloaded")
        card = pag.locator(f"a[href='/agente/{ALVO}']").first
        card.wait_for(timeout=30_000)

        # --- metade 1: contexto velho sai etiquetado, sem sumir da tela ---
        try:
            espera_etiqueta(pag, presente=True)
        except Exception:
            falhas.append(f"metade 1: card de {ALVO} não etiquetou o contexto velho")
        velho = card.inner_text()
        pag.screenshot(path=str(SAIDA / "1-velho-etiquetado.png"))

        # --- metade 2: contexto medido na sessão volta limpo ---
        estado["velho"] = False
        try:
            espera_etiqueta(pag, presente=False)
        except Exception:
            falhas.append(f"metade 2: a etiqueta não saiu do card de {ALVO} com medição atual")
        atual = card.inner_text()
        pag.screenshot(path=str(SAIDA / "2-atual-sem-etiqueta.png"))

        navegador.close()

    if not numeros(velho):
        falhas.append("o card do alvo está sem contexto — a prova precisa de um agente com número")
    elif numeros(velho) != numeros(atual):
        falhas.append(
            f"o número mudou junto com a etiqueta ({numeros(velho)} → {numeros(atual)}); "
            "a correção é sobre a idade declarada, não sobre o valor"
        )

    print(f"velho: {velho.strip()!r}")
    print(f"atual: {atual.strip()!r}")
    print(f"capturas em {SAIDA}")
    for falha in falhas:
        print(f"FALHOU — {falha}")
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
