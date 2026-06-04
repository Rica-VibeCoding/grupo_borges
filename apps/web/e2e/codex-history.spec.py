#!/usr/bin/env python3
"""TK-25 — E2E Playwright do histórico read-only do Codex (Tara) no cockpit.

Cobre o critério de sucesso:
  1. Card/modal da Tara deixa de parecer morto: chat mostra o selo "Codex local"
     e renderiza histórico real (bolhas user/assistant).
  2. Read-only: sem campo de envio pro Codex (envio fora de escopo do TK-25).
  3. Nenhum vazamento de contexto injetado/sistema (AGENTS.md, permissions,
     base_instructions) na tela.

Pré-requisitos e execução: ver cabeçalho de `codex-model-selector.spec.py`.
"""
from __future__ import annotations

import os
import sys

from playwright.sync_api import expect, sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:3007")
LEAK_MARKERS = ["# AGENTS.md instructions", "permissions instructions", "base_instructions", "<INSTRUCTIONS>"]


def run() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        page = browser.new_page()
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=20000)

        page.click('[aria-label^="Agente Tara Kaur"]')

        # 1. Selo "Codex local" + histórico real.
        source = page.locator(".codex-history-source")
        expect(source).to_be_visible(timeout=10000)
        assert "Codex local" in source.inner_text(), "faltou o selo Codex local"

        bubbles = page.locator(".codex-bubble")
        expect(bubbles.first).to_be_visible(timeout=10000)
        assert bubbles.count() >= 1, "histórico Codex devia ter ao menos uma bolha"

        # 2. Read-only: nenhum textarea de envio no painel da Tara.
        assert page.locator(".chat-panel textarea").count() == 0, "Codex é read-only — não pode ter input"

        # 3. Nenhum vazamento de contexto sensível.
        body = page.inner_text("body")
        leaked = [m for m in LEAK_MARKERS if m in body]
        assert not leaked, f"vazou contexto sensível na UI: {leaked}"

        browser.close()

    print("TK-25 E2E OK — Codex local renderiza histórico read-only sem vazar contexto.")


if __name__ == "__main__":
    try:
        run()
    except AssertionError as exc:
        print(f"FALHA: {exc}", file=sys.stderr)
        sys.exit(1)
