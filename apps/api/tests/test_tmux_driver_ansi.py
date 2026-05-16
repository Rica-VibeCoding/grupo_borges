"""Testes pra `preserve_ansi=True` no `tmux_driver._clean_pane_lines`.

JP-11 Fase 1 — DS-58. Cobre o blocker pego no review: `_CONTROL_CHARS`
strippava `\x1b` (0x1b ∈ [0x0e-0x1f]) mesmo quando preserve_ansi=True,
quebrando o pipeline ANSI ponta a ponta (front recebia `[31m...` literal).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.tmux_driver import _clean_pane_lines  # type: ignore[attr-defined]


RED_BLOCK = "\x1b[31merror\x1b[0m: tabela \x1b[1;36mfc_backlog\x1b[0m"


def test_clean_pane_lines_strips_ansi_by_default() -> None:
    """Default `preserve_ansi=False` mantém comportamento antigo: strippa ANSI."""
    out = _clean_pane_lines([RED_BLOCK], max_chars=1000)
    assert out is not None
    assert "\x1b" not in out
    assert out == "error: tabela fc_backlog"


def test_clean_pane_lines_preserves_escape_when_preserve_ansi() -> None:
    """`preserve_ansi=True` mantém escape `\\x1b` intacto pro front parsear."""
    out = _clean_pane_lines([RED_BLOCK], max_chars=1000, preserve_ansi=True)
    assert out is not None, "linha não vazia visualmente — não deveria virar None"
    assert "\x1b[31m" in out, f"escape sequence ANSI strippada: {out!r}"
    assert "\x1b[1;36m" in out
    assert "fc_backlog" in out


def test_clean_pane_lines_still_strips_other_control_chars_when_preserve_ansi() -> None:
    """Outros control chars (NUL, BEL, etc) seguem strippados — só ESC é poupado."""
    # \x07 = BEL, \x1b = ESC (poupar), \x00 = NUL
    line = "\x07hello\x00 \x1b[31mred\x1b[0m"
    out = _clean_pane_lines([line], max_chars=1000, preserve_ansi=True)
    assert out is not None
    assert "\x07" not in out
    assert "\x00" not in out
    assert "\x1b[31m" in out
    assert "hello" in out
    assert "red" in out


def test_clean_pane_lines_empty_visual_lines_filtered() -> None:
    """Linha com só escape sequences (vazia visualmente) é descartada."""
    out = _clean_pane_lines(["\x1b[31m\x1b[0m"], max_chars=1000, preserve_ansi=True)
    assert out is None
