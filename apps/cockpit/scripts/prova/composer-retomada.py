"""Prova dirigida do BUG 2 — "Tentar de novo" apagava o que o Rica digitou.

As duas metades:
  1. o defeito sumiu  — o texto NOVO continua no campo depois do clique
  2. o recurso vive   — o reenvio do texto ANTERIOR de fato acontece

`POST /input` é sempre interceptado, nunca despachado: o slug de teste é uma
sessão de agente real, e um envio de verdade injetaria texto no tmux dela.
"""

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

SLUG = "daniel"
URL = f"http://127.0.0.1:3009/agente/{SLUG}"
# Screenshot e artefato de corrida: sai FORA do repo (o que se versiona e o
# script que sabe tira-lo de novo). `PROVA_SAIDA` troca o destino.
SAIDA = Path(os.environ.get("PROVA_SAIDA", "/home/clawd/provas")) / "cockpit-composer"

VELHA = "primeira mensagem, a que falha"
NOVA = "segunda mensagem, escrita enquanto o erro estava na tela"


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    enviados: list[str] = []

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={"width": 420, "height": 900})

        def trata(rota):
            corpo = rota.request.post_data
            enviados.append(json.loads(corpo)["text"] if corpo else "")
            rota.fulfill(status=500, body='{"detail":"o pane recusou"}')

        pag.route("**/input", trata)

        pag.goto(URL, wait_until="domcontentloaded")
        campo = pag.get_by_placeholder("Mensagem para")
        campo.wait_for(timeout=20_000)

        # --- 1. a primeira mensagem falha e fica pendurada ------------------
        campo.fill(VELHA)
        campo.press("Enter")
        botao = pag.get_by_role("button", name="Tentar de novo")
        botao.wait_for(timeout=15_000)
        assert enviados == [VELHA], f"o primeiro envio não saiu como esperado: {enviados}"
        assert campo.input_value() == "", "o envio comum tem de esvaziar o campo"
        print("✓ primeira mensagem falhou, campo esvaziou, faixa de erro na tela")

        # --- 2. o Rica escreve outra coisa olhando a faixa de erro ----------
        campo.fill(NOVA)
        pag.screenshot(path=SAIDA / "1-texto-novo-com-erro-na-tela.png")

        # --- 3. o clique que comia a mensagem ------------------------------
        botao.click()
        pag.wait_for_timeout(3_000)

        restou = campo.input_value()
        print(f"  campo depois do clique: {restou!r}")
        assert restou == NOVA, f"o campo foi comido: {restou!r}"
        print("✓ o texto novo continua no campo")

        assert enviados == [VELHA, VELHA], f"o reenvio não saiu, ou saiu errado: {enviados}"
        print("✓ o reenvio do texto anterior aconteceu")

        pag.screenshot(path=SAIDA / "2-campo-preservado-e-reenvio.png")
        nav.close()

    print(f"\nprints em {SAIDA}")


if __name__ == "__main__":
    main()
