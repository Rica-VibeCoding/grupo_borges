"""Confirmação observável do envio tmux, sem tocar em panes da frota."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import tmux_driver


class _FakePane:
    pane_current_command = "claude"
    pane_height = 4

    def __init__(self, payload: str, *, enter_succeeds_on: int | None = 1) -> None:
        self.payload = payload
        self.enter_succeeds_on = enter_succeeds_on
        self.state = "empty"
        self.enter_count = 0
        self.paste_count = 0
        self.clear_count = 0

    def cmd(self, *args: str) -> SimpleNamespace:
        if args[:2] == ("send-keys", "C-u"):
            self.state = "empty"
            self.clear_count += 1
        elif args and args[0] == "paste-buffer":
            self.state = "armed"
            self.paste_count += 1
        elif args[:2] == ("send-keys", "Enter"):
            self.enter_count += 1
            if self.enter_succeeds_on is not None and self.enter_count >= self.enter_succeeds_on:
                self.state = "empty"
        elif args and args[0] == "display-message":
            cursor_x = 2 if self.state == "empty" else 20
            return SimpleNamespace(returncode=0, stdout=[f"{cursor_x}\t1"])
        return SimpleNamespace(returncode=0, stdout=[], stderr=[])

    def capture_pane(self, **_kwargs: object) -> list[str]:
        if self.state == "armed":
            content = (
                "[Pasted text #1 +1 lines]" if "\n" in self.payload else self.payload
            )
            prompt = f"❯ {content}"
        else:
            prompt = "❯\u00a0"
        return ["─" * 80, prompt, "─" * 80, "status"]


class _OverlayPane(_FakePane):
    def cmd(self, *args: str) -> SimpleNamespace:
        if args and args[0] == "display-message":
            return SimpleNamespace(returncode=0, stdout=["4\t1"])
        if args[:2] == ("send-keys", "C-u"):
            self.clear_count += 1
            return SimpleNamespace(returncode=0, stdout=[], stderr=[])
        return super().cmd(*args)

    def capture_pane(self, **_kwargs: object) -> list[str]:
        return ["Overlay aberto", "❯ 1. opção", "Enter confirma", "status"]


class _OverlayAfterEnterPane(_FakePane):
    def cmd(self, *args: str) -> SimpleNamespace:
        if args[:2] == ("send-keys", "Enter"):
            self.enter_count += 1
            self.state = "overlay"
            return SimpleNamespace(returncode=0, stdout=[], stderr=[])
        if args and args[0] == "display-message" and self.state == "overlay":
            return SimpleNamespace(returncode=0, stdout=["12\t2"])
        return super().cmd(*args)

    def capture_pane(self, **_kwargs: object) -> list[str]:
        if self.state == "overlay":
            return [f"❯ {self.payload}", "Settings  Status", "Model: opus", "Esc to cancel"]
        return super().capture_pane(**_kwargs)


class _BrokenCapturePane(_FakePane):
    def capture_pane(self, **_kwargs: object) -> list[str]:
        raise AttributeError("pane desapareceu")


class _FakeServer:
    socket_name = None

    def __init__(self, pane: _FakePane) -> None:
        self.sessions = SimpleNamespace(
            get=lambda **_kwargs: SimpleNamespace(active_pane=pane)
        )

    def has_session(self, _session_name: str) -> bool:
        return True

    def cmd(self, *_args: str) -> SimpleNamespace:
        return SimpleNamespace(returncode=0, stdout=[], stderr=[])


def _send(pane: _FakePane) -> bool:
    completed = SimpleNamespace(returncode=0, stdout="", stderr="")
    with patch("services.tmux_driver._server_for", return_value=_FakeServer(pane)), patch(
        "services.tmux_driver.subprocess.run", return_value=completed
    ), patch.object(tmux_driver, "_SUBMIT_CONFIRM_TIMEOUT_S", 0.25), patch.object(
        tmux_driver, "_SUBMIT_POLL_INTERVAL_S", 0.001
    ):
        return tmux_driver._send_message_sync("pane-teste", pane.payload)


def test_send_retries_enter_only_while_same_payload_remains_armed() -> None:
    pane = _FakePane("mensagem de teste", enter_succeeds_on=2)

    assert _send(pane) is True
    assert pane.enter_count == 2
    assert pane.state == "empty"


def test_send_returns_false_and_clears_own_payload_after_retry_cap() -> None:
    pane = _FakePane("mensagem pendurada", enter_succeeds_on=None)

    assert _send(pane) is False
    assert pane.enter_count == tmux_driver._SUBMIT_MAX_ENTER_ATTEMPTS
    assert pane.state == "empty"
    assert pane.clear_count == 2  # limpeza inicial + cleanup do payload armado


def test_send_accepts_multiline_paste_marker_as_armed_input() -> None:
    pane = _FakePane("linha 1\nlinha 2", enter_succeeds_on=1)

    assert _send(pane) is True
    assert pane.enter_count == 1


def test_long_single_line_can_be_observed_by_pasted_text_marker() -> None:
    snapshot = tmux_driver._PaneInputSnapshot("armed", "[Pasted text #3 +1 lines]")

    assert tmux_driver._snapshot_contains_payload(snapshot, "x" * 1000) is True


def test_send_confirms_submitted_line_when_command_opens_overlay() -> None:
    pane = _OverlayAfterEnterPane("/status")

    assert _send(pane) is True
    assert pane.enter_count == 1


def test_send_does_not_paste_or_press_enter_when_overlay_hides_input() -> None:
    pane = _OverlayPane("não deve entrar")

    assert _send(pane) is False
    assert pane.paste_count == 0
    assert pane.enter_count == 0


def test_send_fails_closed_when_pane_capture_disappears() -> None:
    pane = _BrokenCapturePane("não observado")

    assert _send(pane) is False
    assert pane.paste_count == 0
    assert pane.enter_count == 0
