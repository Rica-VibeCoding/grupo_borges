"""Testes pra `preserve_ansi=True` no `tmux_driver._clean_pane_lines`.

JP-11 Fase 1 — DS-58. Cobre o blocker pego no review: `_CONTROL_CHARS`
strippava `\x1b` (0x1b ∈ [0x0e-0x1f]) mesmo quando preserve_ansi=True,
quebrando o pipeline ANSI ponta a ponta (front recebia `[31m...` literal).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from libtmux import exc as libtmux_exc
from services import tmux_driver
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


def test_list_session_names_runs_inventory_in_to_thread(monkeypatch) -> None:
    calls = 0

    async def fake_to_thread(func, *args):
        nonlocal calls
        calls += 1
        assert func is tmux_driver._list_session_names_sync
        assert args == ()
        return {"daniel", "felipe"}

    monkeypatch.setattr(tmux_driver.asyncio, "to_thread", fake_to_thread)

    assert asyncio.run(tmux_driver.list_session_names()) == {"daniel", "felipe"}
    assert calls == 1


def test_session_inventory_includes_named_sockets_without_default(monkeypatch) -> None:
    results_by_socket = {
        "borges-daniel": SimpleNamespace(returncode=0, stdout=["daniel"], stderr=[]),
        "borges-felipe": SimpleNamespace(returncode=0, stdout=["felipe"], stderr=[]),
        None: SimpleNamespace(
            returncode=1,
            stdout=[],
            stderr=["error connecting: No such file or directory"],
        ),
    }

    class FakeServer:
        def __init__(self, socket_name=None):
            self.socket_name = socket_name

        def cmd(self, *_args):
            return results_by_socket[self.socket_name]

    monkeypatch.setattr(
        tmux_driver,
        "_configured_named_socket_names",
        lambda: ["borges-daniel", "borges-felipe"],
    )
    monkeypatch.setattr(tmux_driver.libtmux, "Server", FakeServer)

    assert tmux_driver._list_session_names_sync() == {"daniel", "felipe"}


def test_session_inventory_propagates_named_socket_failure(monkeypatch) -> None:
    class BrokenServer:
        def __init__(self, socket_name=None):
            self.socket_name = socket_name

        def cmd(self, *_args):
            return SimpleNamespace(
                returncode=1,
                stdout=[],
                stderr=[f"permission denied em {self.socket_name}"],
            )

    monkeypatch.setattr(
        tmux_driver,
        "_configured_named_socket_names",
        lambda: ["borges-daniel"],
    )
    monkeypatch.setattr(tmux_driver.libtmux, "Server", BrokenServer)

    with pytest.raises(libtmux_exc.LibTmuxException):
        tmux_driver._list_session_names_sync()


def test_static_named_socket_is_inventoried(monkeypatch) -> None:
    monkeypatch.setattr(tmux_driver, "_TMUX_SOCKET_TEMPLATE", "borges-frota")

    assert tmux_driver._configured_named_socket_names() == ["borges-frota"]
