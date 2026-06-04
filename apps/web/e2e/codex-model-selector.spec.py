#!/usr/bin/env python3
"""DS-69 — E2E Playwright do seletor de modelo Codex (Tara) no cockpit.

Cobre o fluxo principal da task:
  1. Card/modal da Tara mostra o chip de modelo HABILITADO com label Codex (GPT-5.x).
  2. Dropdown lista os 5 modelos Codex + a nota "vale na próxima execução".
  3. Selecionar um modelo dispara toast "na próxima execução" e persiste
     `state_model` no estado da Tara (confirmado via API read-only).
  4. Regressão Claude Code: agente Claude (Daniel) segue com opus/sonnet/haiku,
     sem nenhuma opção Codex misturada.

Pré-requisitos:
  - cockpit web em http://localhost:3007 e API em http://localhost:8000 (ou via
    BASE_URL / API_URL no ambiente).
  - Playwright (Python) + Google Chrome do sistema:  pip install playwright; usa channel="chrome".

Rodar:
  python3 apps/web/e2e/codex-model-selector.spec.py
  (rápido/barato — headless, single browser; equivale a rodar com Haiku.)

Sai com código != 0 se qualquer asserção falhar.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

from playwright.sync_api import expect, sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:3007")
API_URL = os.environ.get("API_URL", "http://localhost:8000")

CODEX_OPTIONS = ["GPT-5.5", "GPT-5.4", "GPT-5.4 Mini", "GPT-5.3 Codex", "GPT-5.2"]
CLAUDE_OPTIONS = ["Opus 4.7", "Sonnet 4.6", "Haiku 4.5"]


def api_get_tara() -> dict:
    with urllib.request.urlopen(f"{API_URL}/api/agents/tara", timeout=5) as r:
        return json.load(r)


def post_tara_model(model: str) -> None:
    """Reset de estado pós-teste — usa o próprio endpoint exercitado."""
    req = urllib.request.Request(
        f"{API_URL}/api/agents/tara/model",
        data=json.dumps({"model": model}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=5).read()


def run() -> None:
    original_model = api_get_tara().get("state_model") or "codex-gpt-5-5"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        page = browser.new_page()
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=20000)

        # --- 1. Modal da Tara: chip habilitado com label Codex ---------------
        page.click('[aria-label^="Agente Tara Kaur"]')
        chip = page.locator(".model-chip").first
        expect(chip).to_be_visible(timeout=8000)
        # Não pode estar desabilitado (era o bug: Codex caía em disabled).
        assert chip.get_attribute("disabled") is None, "chip Codex não pode estar disabled"
        chip_text = chip.inner_text()
        assert "GPT" in chip_text, f"chip da Tara devia mostrar modelo Codex, veio {chip_text!r}"

        # --- 2. Dropdown: 5 modelos Codex + nota da próxima execução ---------
        chip.click()
        for label in CODEX_OPTIONS:
            expect(page.get_by_role("option", name=label, exact=True)).to_be_visible(timeout=4000)
        dropdown = page.locator(".select-content").first
        assert dropdown.get_by_text("vale na próxima execução").is_visible(), "faltou a nota de próxima execução"
        # Nenhuma opção Claude vazada no seletor Codex (escopo: só o dropdown).
        menu_text = dropdown.inner_text()
        for label in CLAUDE_OPTIONS:
            assert label not in menu_text, f"seletor Codex vazou modelo Claude {label!r}"

        # --- 3. Selecionar GPT-5.4 → toast + persistência --------------------
        page.get_by_role("option", name="GPT-5.4", exact=True).click()
        toast = page.get_by_text("próxima execução")
        expect(toast).to_be_visible(timeout=4000)

        persisted = api_get_tara().get("state_model")
        assert persisted == "codex-gpt-5-4", f"state_model devia ser codex-gpt-5-4, veio {persisted!r}"

        # --- 4. Regressão Claude Code (Daniel) -------------------------------
        page.keyboard.press("Escape")
        page.click('[aria-label^="Agente Daniel Singh"]')
        daniel_chip = page.locator(".model-chip").first
        expect(daniel_chip).to_be_visible(timeout=8000)
        assert "GPT" not in daniel_chip.inner_text(), "chip do Daniel não pode mostrar modelo Codex"
        daniel_chip.click()
        for label in CLAUDE_OPTIONS:
            expect(page.get_by_role("option", name=label, exact=True)).to_be_visible(timeout=4000)
        daniel_menu = page.locator(".select-content").first.inner_text()
        for label in CODEX_OPTIONS:
            assert label not in daniel_menu, f"seletor Claude vazou opção Codex {label!r}"

        browser.close()

    # Restaura o estado original da Tara pra não deixar resíduo de teste.
    post_tara_model(original_model)
    print("DS-69 E2E OK — seletor Codex funcional, persistência confirmada, Claude Code intacto.")


if __name__ == "__main__":
    try:
        run()
    except AssertionError as exc:
        print(f"FALHA: {exc}", file=sys.stderr)
        sys.exit(1)
