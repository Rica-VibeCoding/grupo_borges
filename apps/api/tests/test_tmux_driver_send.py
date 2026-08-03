"""Confirmação observável do envio tmux, sem tocar em panes da frota."""
from __future__ import annotations

import asyncio
import concurrent.futures
import sys
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import tmux_driver


class _FakePane:
    pane_current_command = "claude"
    pane_height = 4
    pane_width = 80

    def __init__(
        self,
        payload: str,
        *,
        enter_succeeds_on: int | None = 1,
        unknown_before_readable: int = 0,
        unknown_after_paste: int = 0,
        unknown_after_enter: int = 0,
        replacement_on_enter: str | None = None,
        paste_returncode: int = 0,
    ) -> None:
        self.payload = payload
        self.visible_text = payload
        self.enter_succeeds_on = enter_succeeds_on
        self.unknown_remaining = unknown_before_readable
        self.unknown_after_paste = unknown_after_paste
        self.unknown_after_enter = unknown_after_enter
        self.replacement_on_enter = replacement_on_enter
        self.paste_returncode = paste_returncode
        self.state = "empty"
        self.enter_count = 0
        self.paste_count = 0
        self.clear_count = 0
        self.escape_count = 0
        self.respawn_calls: list[tuple[str, ...]] = []

    def cmd(self, *args: str) -> SimpleNamespace:
        if args[:2] == ("send-keys", "C-u"):
            self.state = "empty"
            self.visible_text = ""
            self.clear_count += 1
        elif args and args[0] == "paste-buffer":
            if self.paste_returncode:
                return SimpleNamespace(
                    returncode=self.paste_returncode,
                    stdout=[],
                    stderr=["paste falhou"],
                )
            self.state = "armed"
            self.visible_text = self.payload
            self.paste_count += 1
            self.unknown_remaining = self.unknown_after_paste
        elif args[:2] == ("send-keys", "Enter"):
            self.enter_count += 1
            self.unknown_remaining = self.unknown_after_enter
            if self.replacement_on_enter is not None:
                self.state = "armed"
                self.visible_text = self.replacement_on_enter
            elif self.enter_succeeds_on is not None and self.enter_count >= self.enter_succeeds_on:
                self.state = "empty"
                self.visible_text = ""
        elif args[:2] == ("send-keys", "Escape"):
            self.escape_count += 1
        elif args and args[0] == "display-message":
            if self.unknown_remaining:
                self.unknown_remaining -= 1
                return SimpleNamespace(returncode=0, stdout=[])
            cursor_x = 2 if self.state == "empty" else 2 + len(self.visible_text)
            return SimpleNamespace(returncode=0, stdout=[f"{cursor_x}\t1"])
        elif args and args[0] == "respawn-pane":
            self.respawn_calls.append(args)
            return SimpleNamespace(returncode=0, stdout=[], stderr=[])
        return SimpleNamespace(returncode=0, stdout=[], stderr=[])

    def capture_pane(self, **kwargs: object) -> list[str]:
        if self.state == "armed":
            content = self.visible_text
            if content == self.payload and "\n" in content:
                content = "[Pasted text #1 +1 lines]"
            prompt = f"❯ {content}"
        else:
            prompt = "❯\u00a0"
        lines = ["─" * 80, prompt, "─" * 80, "status"]
        if kwargs.get("join_wrapped") is True and isinstance(kwargs.get("start"), int):
            start = int(kwargs["start"])
            end = int(kwargs.get("end", start))
            return lines[start : end + 1]
        return lines


class _OverlayPane(_FakePane):
    def cmd(self, *args: str) -> SimpleNamespace:
        if args and args[0] == "display-message":
            return SimpleNamespace(returncode=0, stdout=["4\t1"])
        return super().cmd(*args)

    def capture_pane(self, **_kwargs: object) -> list[str]:
        return ["Overlay aberto", "❯ 1. opção", "Enter confirma", "status"]


class _CursorAtStartWhileArmedPane(_FakePane):
    def cmd(self, *args: str) -> SimpleNamespace:
        if args and args[0] == "display-message" and self.state == "armed":
            return SimpleNamespace(returncode=0, stdout=["2\t1"])
        return super().cmd(*args)


class _BottomBorderOnlyPane(_FakePane):
    pane_height = 3

    def capture_pane(self, **kwargs: object) -> list[str]:
        prompt = f"❯ {self.visible_text}" if self.state == "armed" else "❯\u00a0"
        lines = ["histórico", prompt, "─" * 80]
        if kwargs.get("join_wrapped") is True and isinstance(kwargs.get("start"), int):
            start = int(kwargs["start"])
            end = int(kwargs.get("end", start))
            return lines[start : end + 1]
        return lines


class _DelayedSubmitPane(_FakePane):
    def __init__(self, payload: str, *, clear_after_reads: int) -> None:
        super().__init__(payload, enter_succeeds_on=None)
        self.clear_after_reads = clear_after_reads
        self.reads_after_enter = 0

    def cmd(self, *args: str) -> SimpleNamespace:
        if args and args[0] == "display-message" and self.enter_count:
            self.reads_after_enter += 1
            if self.reads_after_enter >= self.clear_after_reads:
                self.state = "empty"
                self.visible_text = ""
        return super().cmd(*args)


class _PartialPastePane(_FakePane):
    def __init__(self, payload: str) -> None:
        super().__init__(payload)
        self.partial_reads = 0

    def cmd(self, *args: str) -> SimpleNamespace:
        result = super().cmd(*args)
        if args and args[0] == "paste-buffer":
            self.visible_text = self.payload[:5]
        if args and args[0] == "display-message" and self.state == "armed":
            self.partial_reads += 1
            if self.partial_reads >= 5:
                self.visible_text = self.payload
        return result


class _ClearNoOpPane(_FakePane):
    def cmd(self, *args: str) -> SimpleNamespace:
        if args[:2] == ("send-keys", "C-u"):
            self.clear_count += 1
            return SimpleNamespace(returncode=0, stdout=[], stderr=[])
        return super().cmd(*args)


class _SoftWrappedPane(_FakePane):
    pane_height = 4

    def cmd(self, *args: str) -> SimpleNamespace:
        if args and args[0] == "display-message":
            cursor_x = 2 if self.state == "empty" else 20
            cursor_y = 1 if self.state == "empty" else 2
            return SimpleNamespace(returncode=0, stdout=[f"{cursor_x}\t{cursor_y}"])
        return super().cmd(*args)

    def capture_pane(self, **kwargs: object) -> list[str]:
        if kwargs.get("join_wrapped") is True:
            content = self.visible_text if self.state == "armed" else ""
            return [f"❯ {content}"]
        if self.state == "armed":
            return ["histórico", f"❯ {self.visible_text[:8]}", self.visible_text[8:], "─" * 80]
        return ["histórico", "❯\u00a0", "", "─" * 80]


class _HardMultilinePane(_FakePane):
    def capture_pane(self, **kwargs: object) -> list[str]:
        if self.state != "armed":
            return super().capture_pane(**kwargs)
        lines = ["histórico", "❯ linha 1", "linha 2", "─" * 80]
        if isinstance(kwargs.get("start"), int) and kwargs.get("join_wrapped") is True:
            start = int(kwargs["start"])
            end = int(kwargs.get("end", start))
            return lines[start : end + 1]
        return lines


class _SingleRowScrolledPane(_FakePane):
    pane_width = 80

    def cmd(self, *args: str) -> SimpleNamespace:
        if args and args[0] == "display-message" and self.state == "armed":
            return SimpleNamespace(returncode=0, stdout=["79\t1"])
        return super().cmd(*args)


class _PaddedCapturePane(_BottomBorderOnlyPane):
    def capture_pane(self, **kwargs: object) -> list[str]:
        if kwargs.get("join_wrapped") is True:
            content = self.visible_text if self.state == "armed" else ""
            return [f"❯ {content}".ljust(220)]
        return super().capture_pane(**kwargs)


class _StyledCapturePane(_FakePane):
    def __init__(self, prompt: str, *, cursor_x: int) -> None:
        super().__init__("")
        self.prompt = prompt
        self.cursor_x = cursor_x
        self.capture_calls: list[dict[str, object]] = []

    def cmd(self, *args: str) -> SimpleNamespace:
        if args and args[0] == "display-message":
            return SimpleNamespace(returncode=0, stdout=[f"{self.cursor_x}\t1"])
        return super().cmd(*args)

    def capture_pane(self, **kwargs: object) -> list[str]:
        self.capture_calls.append(kwargs)
        lines = ["─" * 80, self.prompt, "─" * 80, "status"]
        if kwargs.get("join_wrapped") is True:
            return [self.prompt]
        return lines


class _EscapeCaptureFailurePane(_BottomBorderOnlyPane):
    def capture_pane(self, **kwargs: object) -> list[str]:
        if kwargs.get("escape_sequences") is True:
            raise AttributeError("capture-pane -e indisponível")
        return super().capture_pane(**kwargs)


class _EnterErrorPane(_FakePane):
    def cmd(self, *args: str) -> SimpleNamespace:
        if args[:2] == ("send-keys", "Enter"):
            return SimpleNamespace(returncode=1, stdout=[], stderr=["enter falhou"])
        return super().cmd(*args)


class _EscapeErrorPane(_FakePane):
    def cmd(self, *args: str) -> SimpleNamespace:
        if args[:2] == ("send-keys", "Escape"):
            return SimpleNamespace(returncode=1, stdout=[], stderr=["escape falhou"])
        return super().cmd(*args)


class _BrokenCapturePane(_FakePane):
    def capture_pane(self, **_kwargs: object) -> list[str]:
        raise AttributeError("pane desapareceu")


class _BootstrapPane(_FakePane):
    def __init__(self) -> None:
        super().__init__("")
        self.sent_commands: list[str] = []
        self.visible_context: str | None = None

    def send_keys(self, command: str) -> None:
        self.sent_commands.append(command)

    def capture_pane(self, **_kwargs: object) -> list[str]:
        lines = ["Claude Code v2.0"]
        if self.visible_context:
            lines.append(self.visible_context)
        return lines


class _RelaunchPane(_FakePane):
    pane_height = 7
    pane_width = 220

    def __init__(
        self,
        anchor: str,
        *,
        show_anchor: bool = True,
        show_banner: bool = True,
    ) -> None:
        super().__init__("")
        self.anchor = anchor
        self.show_anchor = show_anchor
        self.show_banner = show_banner
        self.launched = False
        self.sent_commands: list[tuple[str, bool]] = []
        self.entered = 0
        self.window = SimpleNamespace(window_id="@replacement")
        self.pane_pid = 222

    def send_keys(self, command: str, *, enter: bool = True) -> None:
        self.sent_commands.append((command, enter))

    def enter(self) -> None:
        self.entered += 1
        self.launched = True

    def refresh(self) -> None:
        return None

    def cmd(self, *args: str) -> SimpleNamespace:
        if args and args[0] == "display-message":
            return SimpleNamespace(returncode=0, stdout=["2\t4"])
        return super().cmd(*args)

    def capture_pane(self, **kwargs: object) -> list[str]:
        if not self.launched:
            return ["$ "]
        context = self.anchor if self.show_anchor else "conversa diferente"
        lines = [
            "Claude Code v2.1.220" if self.show_banner else "histórico retomado",
            f"❯ {context}",
            "● resposta anterior",
            "─" * self.pane_width,
            "❯\u00a0",
            "─" * self.pane_width,
            "Opus 4.8",
        ]
        if isinstance(kwargs.get("start"), int):
            start = int(kwargs["start"])
            end = int(kwargs.get("end", start))
            return lines[start : end + 1]
        return lines


class _RelaunchServer:
    socket_name = None

    def __init__(
        self,
        old_pane: _BootstrapPane,
        replacement_pane: _RelaunchPane,
        *,
        kill_old_returncode: int = 0,
        old_disappears_on_kill_error: bool = False,
    ) -> None:
        old_pane.window = SimpleNamespace(window_id="@old")
        old_pane.pane_pid = 111
        self.old_pane = old_pane
        self.replacement_pane = replacement_pane
        self.active_pane = old_pane
        self.kill_old_returncode = kill_old_returncode
        self.old_disappears_on_kill_error = old_disappears_on_kill_error
        self.window_ids = {"@old"}
        self.commands: list[tuple[str, ...]] = []
        self.env_calls: list[tuple[str, str | None]] = []
        self.sessions = SimpleNamespace(get=self._get_session)

    def _get_session(self, **_kwargs: object) -> SimpleNamespace:
        windows = SimpleNamespace(
            get=lambda **_window_kwargs: SimpleNamespace(
                active_pane=self.replacement_pane
            )
        )
        return SimpleNamespace(
            active_pane=self.active_pane,
            windows=windows,
            set_environment=lambda name, value: self.env_calls.append(
                (name, value)
            ),
            unset_environment=lambda name: self.env_calls.append((name, None)),
        )

    def has_session(self, _session_name: str) -> bool:
        return True

    def cmd(self, *args: str) -> SimpleNamespace:
        self.commands.append(args)
        if args and args[0] == "new-window":
            self.window_ids.add("@replacement")
            return SimpleNamespace(
                returncode=0,
                stdout=["@replacement\t%replacement"],
                stderr=[],
            )
        if args[:3] == ("kill-window", "-t", "@old"):
            if self.kill_old_returncode == 0:
                self.active_pane = self.replacement_pane
                self.window_ids.remove("@old")
            elif self.old_disappears_on_kill_error:
                self.active_pane = self.replacement_pane
                self.window_ids.remove("@old")
            return SimpleNamespace(
                returncode=self.kill_old_returncode,
                stdout=[],
                stderr=["kill falhou"] if self.kill_old_returncode else [],
            )
        if args[:3] == ("kill-window", "-t", "@replacement"):
            self.window_ids.remove("@replacement")
        if args and args[0] == "list-windows":
            return SimpleNamespace(
                returncode=0,
                stdout=sorted(self.window_ids),
                stderr=[],
            )
        return SimpleNamespace(returncode=0, stdout=[], stderr=[])


class _FakeServer:
    socket_name = None

    def __init__(self, pane: _FakePane) -> None:
        self.deleted_buffers: list[str] = []
        self.sessions = SimpleNamespace(get=lambda **_kwargs: SimpleNamespace(active_pane=pane))

    def has_session(self, _session_name: str) -> bool:
        return True

    def cmd(self, *_args: str) -> SimpleNamespace:
        if _args and _args[0] == "delete-buffer":
            self.deleted_buffers.append(_args[-1])
        return SimpleNamespace(returncode=0, stdout=[], stderr=[])


def _driver_patches(pane: _FakePane, *, server: _FakeServer | None = None):
    completed = SimpleNamespace(returncode=0, stdout="", stderr="")
    return (
        patch("services.tmux_driver._server_for", return_value=server or _FakeServer(pane)),
        patch("services.tmux_driver.subprocess.run", return_value=completed),
        patch.object(tmux_driver, "_PRE_PASTE_CONFIRM_TIMEOUT_S", 0.25),
        patch.object(tmux_driver, "_SUBMIT_CONFIRM_TIMEOUT_S", 0.25),
        patch.object(tmux_driver, "_RECOVERY_STEP_TIMEOUT_S", 0.05),
        patch.object(tmux_driver, "_SUBMIT_POLL_INTERVAL_S", 0.001),
        patch.object(tmux_driver, "_SUBMIT_ENTER_RETRY_INTERVAL_S", 0.02),
    )


def _send(pane: _FakePane, text: str | None = None) -> bool:
    patches = _driver_patches(pane)
    with (
        patches[0],
        patches[1],
        patches[2],
        patches[3],
        patches[4],
        patches[5],
        patches[6],
    ):
        return tmux_driver._send_message_sync("pane-teste", text or pane.payload)


def _recover(pane: _FakePane) -> dict[str, bool | int | str]:
    patches = _driver_patches(pane)
    with (
        patches[0],
        patches[1],
        patches[2],
        patches[3],
        patches[4],
        patches[5],
        patches[6],
    ):
        return tmux_driver._recover_input_sync("pane-teste")


def test_send_retries_unknown_snapshots_until_input_stabilizes() -> None:
    pane = _FakePane(
        "mensagem de teste",
        unknown_before_readable=3,
        unknown_after_paste=3,
        unknown_after_enter=3,
    )

    assert _send(pane) is True
    assert pane.paste_count == 1
    assert pane.enter_count == 1


def test_send_handles_busy_pane_and_retries_lost_first_enter() -> None:
    pane = _FakePane("pane ocupada", enter_succeeds_on=2, unknown_after_paste=5)

    assert _send(pane) is True
    assert pane.enter_count == 2
    assert pane.state == "empty"


def test_send_waits_for_delayed_submit_before_retrying_enter() -> None:
    pane = _DelayedSubmitPane("pane lenta", clear_after_reads=6)

    assert _send(pane) is True
    assert pane.enter_count == 1


def test_send_accepts_real_layout_with_only_bottom_input_border() -> None:
    pane = _BottomBorderOnlyPane("layout real")

    assert _send(pane) is True


def test_snapshot_removes_tui_padding_without_changing_input() -> None:
    pane = _PaddedCapturePane("texto humano")
    pane.state = "armed"

    snapshot = tmux_driver._capture_input_snapshot(pane)

    assert snapshot == tmux_driver._PaneInputSnapshot("armed", "texto humano")


def test_snapshot_treats_real_claude_placeholder_capture_as_empty() -> None:
    pane = _StyledCapturePane(
        '\x1b[39m❯ \x1b[2mTry "create a util logging.py that..."\x1b[0m',
        cursor_x=2,
    )

    snapshot = tmux_driver._capture_input_snapshot(pane)

    assert snapshot == tmux_driver._PaneInputSnapshot(
        "empty", 'Try "create a util logging.py that..."'
    )
    assert all(call["escape_sequences"] is True for call in pane.capture_calls)


def test_snapshot_keeps_real_human_input_capture_armed() -> None:
    pane = _StyledCapturePane("\x1b[39m❯ texto humano de teste", cursor_x=23)

    snapshot = tmux_driver._capture_input_snapshot(pane)

    assert snapshot == tmux_driver._PaneInputSnapshot("armed", "texto humano de teste")


def test_snapshot_understands_combined_dim_and_intensity_resets() -> None:
    for dim_sequence, reset_sequence in (("0;2", "0"), ("2;39", "22")):
        pane = _StyledCapturePane(
            f"\x1b[39m❯ \x1b[{dim_sequence}mplaceholder\x1b[{reset_sequence}m",
            cursor_x=2,
        )

        assert tmux_driver._capture_input_snapshot(pane) == (
            "empty",
            "placeholder",
        )


def test_snapshot_keeps_mixed_dim_and_non_dim_content_armed() -> None:
    pane = _StyledCapturePane(
        "\x1b[39m❯ \x1b[2mplaceholder \x1b[22mtexto humano",
        cursor_x=2,
    )

    assert tmux_driver._capture_input_snapshot(pane) == (
        "armed",
        "placeholder texto humano",
    )


def test_snapshot_does_not_mistake_truecolor_mode_for_dim() -> None:
    pane = _StyledCapturePane(
        "\x1b[39m❯ \x1b[38;2;100;120;140mtexto humano",
        cursor_x=2,
    )

    assert tmux_driver._capture_input_snapshot(pane) == ("armed", "texto humano")


def test_snapshot_falls_back_to_old_behavior_when_sgr_capture_fails() -> None:
    pane = _EscapeCaptureFailurePane("texto humano")
    pane.state = "armed"

    assert tmux_driver._capture_input_snapshot(pane) == ("armed", "texto humano")


def test_send_treats_partial_paste_render_as_transient() -> None:
    pane = _PartialPastePane("payload completo e comprido")

    assert _send(pane) is True


def test_send_detects_nonzero_paste_returncode() -> None:
    pane = _FakePane("não colar", paste_returncode=1)

    assert _send(pane) is False
    assert pane.enter_count == 0


def test_send_revalidates_empty_after_buffer_load() -> None:
    pane = _FakePane("payload cockpit")
    server = _FakeServer(pane)

    def load_then_human_types(_server: _FakeServer, _text: str) -> str:
        pane.state = "armed"
        pane.visible_text = "rascunho humano"
        return "buffer-teste"

    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._load_tmux_buffer", side_effect=load_then_human_types),
        patch.object(tmux_driver, "_PRE_PASTE_CONFIRM_TIMEOUT_S", 0.02),
        patch.object(tmux_driver, "_SUBMIT_POLL_INTERVAL_S", 0.001),
    ):
        delivered = tmux_driver._send_message_sync("pane-teste", pane.payload)

    assert delivered is False
    assert pane.visible_text == "rascunho humano"
    assert pane.paste_count == 0
    assert pane.clear_count == 0


def test_visible_text_is_armed_even_when_cursor_reports_start_of_prompt() -> None:
    pane = _CursorAtStartWhileArmedPane("cursor dessincronizado", enter_succeeds_on=2)

    assert _send(pane) is True
    assert pane.enter_count == 2


def test_send_returns_false_and_clears_only_own_payload_after_retry_cap() -> None:
    pane = _FakePane("mensagem pendurada", enter_succeeds_on=None)

    assert _send(pane) is False
    assert pane.enter_count == tmux_driver._SUBMIT_MAX_ENTER_ATTEMPTS
    assert pane.state == "empty"
    assert pane.clear_count == 1


def test_send_does_not_invent_transcript_proof_when_baseline_was_unreadable() -> None:
    pane = _FakePane("mensagem antiga", enter_succeeds_on=None)
    patches = _driver_patches(pane)
    count_calls = 0

    def unreadable_then_old_prompt(*_args: object) -> int | None:
        nonlocal count_calls
        count_calls += 1
        return None if count_calls == 1 else 1

    with (
        patches[0],
        patches[1],
        patches[2],
        patches[3],
        patches[4],
        patches[5],
        patches[6],
        patch(
            "services.tmux_driver._count_payload_prompt_lines",
            side_effect=unreadable_then_old_prompt,
        ),
    ):
        delivered = tmux_driver._send_message_sync("pane-teste", pane.payload)

    assert delivered is False


def test_send_never_clears_or_replaces_human_text_already_armed() -> None:
    pane = _FakePane("payload cockpit")
    pane.state = "armed"
    pane.visible_text = "rascunho digitado por pessoa"

    assert _send(pane) is False
    assert pane.visible_text == "rascunho digitado por pessoa"
    assert pane.clear_count == 0
    assert pane.paste_count == 0
    assert pane.enter_count == 0


def test_send_never_clears_human_text_that_appears_during_submission() -> None:
    pane = _FakePane(
        "payload cockpit",
        enter_succeeds_on=None,
        replacement_on_enter="novo texto humano",
    )

    assert _send(pane) is False
    assert pane.visible_text == "novo texto humano"
    assert pane.clear_count == 0


def test_send_never_clears_payload_with_human_suffix() -> None:
    pane = _FakePane(
        "payload cockpit",
        enter_succeeds_on=None,
        replacement_on_enter="payload cockpit + complemento humano",
    )

    assert _send(pane) is False
    assert pane.visible_text == "payload cockpit + complemento humano"
    assert pane.clear_count == 0


def test_send_returns_false_when_enter_command_returns_nonzero() -> None:
    pane = _EnterErrorPane("enter rejeitado")

    assert _send(pane) is False
    assert pane.enter_count == 0


def test_send_accepts_multiline_paste_marker_as_armed_input() -> None:
    pane = _FakePane("linha 1\nlinha 2")

    assert _send(pane) is True


def test_send_never_clears_generic_multiline_marker_without_ownership_proof() -> None:
    pane = _FakePane("linha 1\nlinha 2", enter_succeeds_on=None)

    assert _send(pane) is False
    assert pane.clear_count == 0
    assert pane.state == "armed"


def test_long_single_line_can_be_observed_by_pasted_text_marker() -> None:
    snapshot = tmux_driver._PaneInputSnapshot("armed", "[Pasted text #3 +1 lines]")

    assert tmux_driver._snapshot_contains_payload(snapshot, "x" * 1000) is True


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


def test_recover_reports_empty_at_step_two() -> None:
    pane = _FakePane("irrelevante")

    assert _recover(pane) == {"tmux_delivered": True, "degrau": 2, "acao": "input_vazio"}


def test_recover_submits_armed_text_with_enter_at_step_three() -> None:
    pane = _FakePane("texto humano")
    pane.state = "armed"

    assert _recover(pane) == {"tmux_delivered": True, "degrau": 3, "acao": "enter"}
    assert pane.clear_count == 0


def test_recover_repastes_exact_same_text_at_step_four() -> None:
    pane = _FakePane("texto humano", enter_succeeds_on=2)
    pane.state = "armed"

    assert _recover(pane) == {
        "tmux_delivered": True,
        "degrau": 4,
        "acao": "recolar_enter",
    }
    assert pane.clear_count == 1
    assert pane.paste_count == 1


def test_recover_preserves_leading_whitespace_when_repasting() -> None:
    pane = _FakePane("  texto humano com espacos", enter_succeeds_on=2)
    pane.state = "armed"

    assert _recover(pane)["degrau"] == 4
    assert pane.payload == "  texto humano com espacos"


def test_recover_refuses_unicode_width_without_touching_input() -> None:
    pane = _FakePane("texto com ç", enter_succeeds_on=2)
    pane.state = "armed"

    result = _recover(pane)

    assert result["acao"] == "texto_armado_nao_totalmente_visivel"
    assert pane.clear_count == 0
    assert pane.paste_count == 0


def test_recover_refuses_text_spanning_multiple_visible_rows() -> None:
    pane = _SoftWrappedPane("texto muito longo sem quebra lógica", enter_succeeds_on=2)
    pane.state = "armed"

    result = _recover(pane)

    assert result == {
        "tmux_delivered": False,
        "degrau": 5,
        "acao": "texto_armado_nao_totalmente_visivel",
    }
    assert pane.clear_count == 0
    assert pane.paste_count == 0


def test_recover_refuses_hard_multiline_without_touching_input() -> None:
    pane = _HardMultilinePane("linha 1\nlinha 2", enter_succeeds_on=2)
    pane.state = "armed"

    result = _recover(pane)

    assert result == {
        "tmux_delivered": False,
        "degrau": 5,
        "acao": "texto_armado_nao_totalmente_visivel",
    }
    assert pane.clear_count == 0
    assert pane.paste_count == 0


def test_recover_refuses_single_row_scrolled_input_without_clearing() -> None:
    pane = _SingleRowScrolledPane("sufixo visível", enter_succeeds_on=2)
    pane.state = "armed"

    result = _recover(pane)

    assert result["acao"] == "texto_armado_nao_totalmente_visivel"
    assert pane.clear_count == 0
    assert pane.paste_count == 0


def test_recover_does_not_repaste_until_c_u_is_observed_empty() -> None:
    pane = _ClearNoOpPane("texto humano", enter_succeeds_on=None)
    pane.state = "armed"

    result = _recover(pane)

    assert result["tmux_delivered"] is False
    assert result["degrau"] == 5
    assert result["acao"] == "limpeza_nao_confirmada_buffer_preservado"
    assert str(result["buffer_name"]).startswith("cockpit-dispatch-")
    assert pane.paste_count == 0


def test_recover_returns_buffer_name_when_repaste_fails() -> None:
    pane = _FakePane("texto humano", enter_succeeds_on=2, paste_returncode=1)
    pane.state = "armed"
    server = _FakeServer(pane)
    patches = _driver_patches(pane, server=server)

    with (
        patches[0],
        patches[1],
        patches[2],
        patches[3],
        patches[4],
        patches[5],
        patches[6],
    ):
        result = tmux_driver._recover_input_sync("pane-teste")

    assert result["tmux_delivered"] is False
    assert result["acao"] == "recolagem_falhou_buffer_preservado"
    assert str(result["buffer_name"]).startswith("cockpit-dispatch-")
    assert result["buffer_name"] not in server.deleted_buffers
    assert pane.clear_count == 1


def test_recover_reports_escape_command_failure() -> None:
    pane = _EscapeErrorPane("texto")

    assert _recover(pane) == {
        "tmux_delivered": False,
        "degrau": 5,
        "acao": "escape_falhou",
    }


def test_recover_never_clears_text_if_human_changes_it_after_first_enter() -> None:
    pane = _FakePane(
        "texto original",
        enter_succeeds_on=None,
        replacement_on_enter="texto novo da pessoa",
    )
    pane.state = "armed"

    result = _recover(pane)

    assert result["tmux_delivered"] is False
    assert result["degrau"] == 5
    assert pane.visible_text == "texto novo da pessoa"
    assert pane.clear_count == 0
    assert pane.paste_count == 0


def test_recover_does_not_claim_submission_when_input_emptied_without_proof() -> None:
    pane = _FakePane("texto humano", enter_succeeds_on=None)
    pane.state = "armed"

    def unconfirmed_then_human_clears(*_args, **_kwargs):
        pane.state = "empty"
        pane.visible_text = ""
        return False, 1

    with patch(
        "services.tmux_driver._confirm_armed_submission",
        side_effect=unconfirmed_then_human_clears,
    ):
        result = _recover(pane)

    assert result == {
        "tmux_delivered": False,
        "degrau": 5,
        "acao": "submissao_nao_confirmada",
    }


def test_dispatch_lock_registry_is_atomic_per_session() -> None:
    session_name = "lock-creation-race"
    tmux_driver._DISPATCH_LOCKS.pop(session_name, None)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        locks = list(executor.map(tmux_driver._dispatch_lock_for, [session_name] * 100))

    assert len({id(lock) for lock in locks}) == 1


def test_send_fails_fast_when_same_session_is_already_dispatching() -> None:
    pane = _FakePane("não deve aguardar")
    lock = tmux_driver._dispatch_lock_for("pane-teste")
    lock.acquire()
    patches = _driver_patches(pane)
    try:
        with (
            patches[0],
            patches[1],
            patch.object(tmux_driver, "_DISPATCH_LOCK_TIMEOUT_S", 0.01),
            pytest.raises(tmux_driver.TmuxSessionBusyError, match="sessão tmux ocupada"),
        ):
            tmux_driver._send_message_sync("pane-teste", pane.payload)
    finally:
        lock.release()

    assert pane.paste_count == 0
    assert pane.enter_count == 0


def test_recover_reports_busy_session_without_waiting_for_dispatch() -> None:
    pane = _FakePane("não deve aguardar")
    lock = tmux_driver._dispatch_lock_for("pane-teste")
    lock.acquire()
    try:
        with patch.object(tmux_driver, "_DISPATCH_LOCK_TIMEOUT_S", 0.01):
            result = _recover(pane)
    finally:
        lock.release()

    assert result == {
        "tmux_delivered": False,
        "degrau": 5,
        "acao": "sessao_ocupada",
    }
    assert pane.escape_count == 0


def test_long_tmux_operations_use_dedicated_executor(monkeypatch) -> None:
    def in_tmux_executor(*_args: object) -> bool:
        return threading.current_thread().name.startswith("cockpit-tmux")

    monkeypatch.setattr(tmux_driver, "_send_message_sync", in_tmux_executor)
    monkeypatch.setattr(
        tmux_driver,
        "_recover_input_sync",
        lambda *_args: {"in_tmux_executor": in_tmux_executor()},
    )
    monkeypatch.setattr(
        tmux_driver,
        "_restart_claude_with_resume_sync",
        lambda *_args: {"in_tmux_executor": in_tmux_executor()},
    )

    assert asyncio.run(tmux_driver.send_message("daniel", "oi")) is True
    assert asyncio.run(tmux_driver.recover_input("daniel"))["in_tmux_executor"] is True
    restarted = asyncio.run(
        tmux_driver.restart_claude_with_resume(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2",
        )
    )
    assert restarted["in_tmux_executor"] is True


def test_restart_replaces_window_and_confirms_resumed_conversation(tmp_path: Path) -> None:
    old_pane = _BootstrapPane()
    anchor = "pergunta anterior única do relaunch"
    old_pane.visible_context = anchor
    replacement_pane = _RelaunchPane(anchor)
    server = _RelaunchServer(old_pane, replacement_pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"

    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"user","message":{"role":"user","content":'
        f'"{anchor}"}}}}\n'
    )
    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
        patch("services.tmux_driver._pane_owner_pids", return_value={111, 112}),
        patch(
            "services.tmux_driver._pane_environment_snapshot",
            return_value={"PATH": "/test/bin:/usr/bin"},
        ),
        patch("services.tmux_driver._wait_for_processes_exit", return_value=True),
        patch.object(tmux_driver, "_BOOTSTRAP_POLL_INTERVAL_S", 0.001),
    ):
        result = tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert result == {"attempted": True, "confirmed": True}
    assert server.commands[:2] == [
        (
            "new-window",
            "-d",
            "-P",
            "-F",
            "#{window_id}\t#{pane_id}",
            "-t",
            "daniel:",
            "-c",
            "/home/clawd/repos/grupo_borges",
        ),
        ("kill-window", "-t", "@old"),
    ]
    # PATH/TELEGRAM_STATE_DIR não viram mais prefixo `VAR=valor` na string do
    # comando — vão pela env nativa da sessão tmux (ver `server.env_calls`).
    assert replacement_pane.sent_commands == [
        (
            "claude --dangerously-skip-permissions "
            "--model claude-opus-4-8 "
            f'--resume {session_id}; exec "${{SHELL:-/bin/sh}}"',
            False,
        )
    ]
    snapshot = {"PATH": "/test/bin:/usr/bin"}
    expected_env_calls = {
        (name, snapshot.get(name)) for name in tmux_driver._PRESERVED_ENV_VARS
    }
    assert set(server.env_calls) == expected_env_calls
    assert replacement_pane.entered == 1
    assert "respawn-pane" not in replacement_pane.sent_commands[0][0]
    assert "|| claude" not in replacement_pane.sent_commands[0][0]


def test_restart_preserves_telegram_state_dir_of_old_process(tmp_path: Path) -> None:
    old_pane = _BootstrapPane()
    anchor = "pergunta anterior única do relaunch"
    old_pane.visible_context = anchor
    replacement_pane = _RelaunchPane(anchor)
    server = _RelaunchServer(old_pane, replacement_pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"

    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"user","message":{"role":"user","content":'
        f'"{anchor}"}}}}\n'
    )
    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
        patch("services.tmux_driver._pane_owner_pids", return_value={111, 112}),
        patch(
            "services.tmux_driver._pane_environment_snapshot",
            return_value=(
                snapshot := {
                    "PATH": "/test/bin:/usr/bin",
                    "TELEGRAM_STATE_DIR": "/home/clawd/.claude/channels/telegram-daniel",
                }
            ),
        ),
        patch("services.tmux_driver._wait_for_processes_exit", return_value=True),
        patch.object(tmux_driver, "_BOOTSTRAP_POLL_INTERVAL_S", 0.001),
    ):
        result = tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert result == {"attempted": True, "confirmed": True}
    assert replacement_pane.sent_commands == [
        (
            "claude --dangerously-skip-permissions "
            "--model claude-opus-4-8 "
            f'--resume {session_id}; exec "${{SHELL:-/bin/sh}}"',
            False,
        )
    ]
    expected_env_calls = {
        (name, snapshot.get(name)) for name in tmux_driver._PRESERVED_ENV_VARS
    }
    assert set(server.env_calls) == expected_env_calls


def test_restart_unsets_telegram_state_dir_when_old_process_had_none(
    tmp_path: Path,
) -> None:
    """Agente que usa o default do plugin de propósito não herda um valor stale."""
    old_pane = _BootstrapPane()
    anchor = "pergunta anterior única do relaunch"
    old_pane.visible_context = anchor
    replacement_pane = _RelaunchPane(anchor)
    server = _RelaunchServer(old_pane, replacement_pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"

    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"user","message":{"role":"user","content":'
        f'"{anchor}"}}}}\n'
    )
    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
        patch("services.tmux_driver._pane_owner_pids", return_value={111, 112}),
        patch(
            "services.tmux_driver._pane_environment_snapshot",
            return_value={"PATH": "/test/bin"},
        ),
        patch("services.tmux_driver._wait_for_processes_exit", return_value=True),
        patch.object(tmux_driver, "_BOOTSTRAP_POLL_INTERVAL_S", 0.001),
    ):
        result = tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert result == {"attempted": True, "confirmed": True}
    assert ("TELEGRAM_STATE_DIR", None) in server.env_calls


def test_restart_preserves_kimi_routing_vars_of_hiro(tmp_path: Path) -> None:
    """Sem as 7 `ANTHROPIC_*`, o relaunch do Hiro bateria na Anthropic de verdade
    em vez do `k3` — preservar é o que torna seguro liberar o guard de model_family."""
    old_pane = _BootstrapPane()
    anchor = "pergunta anterior única do relaunch"
    old_pane.visible_context = anchor
    replacement_pane = _RelaunchPane(anchor)
    server = _RelaunchServer(old_pane, replacement_pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"

    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"user","message":{"role":"user","content":'
        f'"{anchor}"}}}}\n'
    )
    kimi_env = {
        "PATH": "/test/bin:/usr/bin",
        "ANTHROPIC_API_KEY": "sk-kimi-test",
        "ANTHROPIC_BASE_URL": "https://api.kimi.com/coding/",
        "ANTHROPIC_MODEL": "k3",
        "ANTHROPIC_DEFAULT_FABLE_MODEL": "k3",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "k3",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "k3",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "k3",
    }
    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
        patch("services.tmux_driver._pane_owner_pids", return_value={111, 112}),
        patch(
            "services.tmux_driver._pane_environment_snapshot",
            return_value=kimi_env,
        ),
        patch("services.tmux_driver._wait_for_processes_exit", return_value=True),
        patch.object(tmux_driver, "_BOOTSTRAP_POLL_INTERVAL_S", 0.001),
    ):
        result = tmux_driver._restart_claude_with_resume_sync(
            "hiro",
            "/home/clawd/repos/grupo_borges",
            "k3",
            session_id,
        )

    assert result == {"attempted": True, "confirmed": True}
    expected_env_calls = {
        (name, kimi_env.get(name)) for name in tmux_driver._PRESERVED_ENV_VARS
    }
    assert set(server.env_calls) == expected_env_calls
    # nenhuma das 7 vars vira `unset` — todas estavam presentes no processo antigo
    assert all(value is not None for name, value in server.env_calls if name != "TELEGRAM_STATE_DIR")


def test_resumed_tui_confirmation_does_not_depend_on_scrolled_banner() -> None:
    pane = _RelaunchPane("contexto retomado visível", show_banner=False)
    pane.enter()

    with patch.object(tmux_driver, "_BOOTSTRAP_POLL_INTERVAL_S", 0.001):
        result = tmux_driver._wait_for_resumed_claude_tui(
            pane,
            ["contexto retomado visível"],
        )

    assert result == {"attempted": True, "confirmed": True}


def test_resume_confirmation_rejects_short_generic_anchor() -> None:
    assert tmux_driver._anchor_is_visible("Claude respondeu ok", "ok") is False


def test_restart_does_not_confirm_banner_without_resumed_context(tmp_path: Path) -> None:
    old_pane = _BootstrapPane()
    old_pane.visible_context = "contexto esperado que deve reaparecer"
    replacement_pane = _RelaunchPane(
        "contexto esperado que deve reaparecer",
        show_anchor=False,
    )
    server = _RelaunchServer(old_pane, replacement_pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"
    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"assistant","message":{"content":'
        '[{"type":"text","text":"contexto esperado que deve reaparecer"}]}}\n'
    )

    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
        patch("services.tmux_driver._pane_owner_pids", return_value={111}),
        patch(
            "services.tmux_driver._pane_environment_snapshot",
            return_value={"PATH": "/test/bin"},
        ),
        patch("services.tmux_driver._wait_for_processes_exit", return_value=True),
        patch.object(tmux_driver, "_BOOTSTRAP_TIMEOUT_S", 0.01),
        patch.object(tmux_driver, "_BOOTSTRAP_POLL_INTERVAL_S", 0.001),
    ):
        result = tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert result == {"attempted": True, "confirmed": False}


def test_restart_escalates_to_sigkill_and_still_launches_when_old_process_lingers(
    tmp_path: Path,
) -> None:
    """Bug 7d1efe86: timeout de saída não pode mais deixar a window nova sem `send-keys`.

    Antes, um `_wait_for_processes_exit` estourado fazia a função retornar
    ANTES de lançar o Claude na window nova — sobrava shell vazio, sem
    conversa retomada e sem sinal de erro claro. Agora o timeout escala pra
    SIGKILL nos PIDs remanescentes e o lançamento acontece de qualquer jeito.
    """
    old_pane = _BootstrapPane()
    old_pane.visible_context = "contexto esperado que deve reaparecer"
    replacement_pane = _RelaunchPane("contexto esperado que deve reaparecer")
    server = _RelaunchServer(old_pane, replacement_pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"
    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"user","message":{"content":'
        '"contexto esperado que deve reaparecer"}}\n'
    )

    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
        patch("services.tmux_driver._pane_owner_pids", return_value={111}),
        patch(
            "services.tmux_driver._pane_environment_snapshot",
            return_value={"PATH": "/test/bin"},
        ),
        patch("services.tmux_driver._wait_for_processes_exit", return_value=False) as wait_mock,
        patch("services.tmux_driver._force_kill_processes") as force_kill_mock,
        patch.object(tmux_driver, "_BOOTSTRAP_POLL_INTERVAL_S", 0.001),
    ):
        result = tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    force_kill_mock.assert_called_once_with({111})
    assert wait_mock.call_count == 2
    assert replacement_pane.sent_commands == [
        (
            "claude --dangerously-skip-permissions "
            "--model claude-opus-4-8 "
            f'--resume {session_id}; exec "${{SHELL:-/bin/sh}}"',
            False,
        )
    ]
    assert result == {"attempted": True, "confirmed": True}


def test_restart_cleans_replacement_only_when_old_window_provably_survives(
    tmp_path: Path,
) -> None:
    old_pane = _BootstrapPane()
    old_pane.visible_context = "contexto esperado que deve reaparecer"
    replacement_pane = _RelaunchPane("contexto esperado que deve reaparecer")
    server = _RelaunchServer(
        old_pane,
        replacement_pane,
        kill_old_returncode=1,
    )
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"
    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"user","message":{"content":'
        '"contexto esperado que deve reaparecer"}}\n'
    )

    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
        patch("services.tmux_driver._pane_owner_pids", return_value={111}),
        patch(
            "services.tmux_driver._pane_environment_snapshot",
            return_value={"PATH": "/test/bin"},
        ),
    ):
        result = tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert result == {"attempted": False, "confirmed": False}
    assert server.commands[-1] == ("kill-window", "-t", "@replacement")
    assert server.window_ids == {"@old"}
    assert replacement_pane.sent_commands == []


def test_restart_preserves_replacement_when_old_disappears_despite_kill_error(
    tmp_path: Path,
) -> None:
    old_pane = _BootstrapPane()
    old_pane.visible_context = "contexto esperado que deve reaparecer"
    replacement_pane = _RelaunchPane("contexto esperado que deve reaparecer")
    server = _RelaunchServer(
        old_pane,
        replacement_pane,
        kill_old_returncode=1,
        old_disappears_on_kill_error=True,
    )
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"
    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"user","message":{"content":'
        '"contexto esperado que deve reaparecer"}}\n'
    )

    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
        patch("services.tmux_driver._pane_owner_pids", return_value={111}),
        patch(
            "services.tmux_driver._pane_environment_snapshot",
            return_value={"PATH": "/test/bin"},
        ),
    ):
        result = tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert result == {"attempted": False, "confirmed": False}
    assert server.window_ids == {"@replacement"}
    assert ("kill-window", "-t", "@replacement") not in server.commands


def test_restart_validates_before_destructive_respawn() -> None:
    pane = _BootstrapPane()
    server = _FakeServer(pane)

    with patch("services.tmux_driver._server_for", return_value=server):
        try:
            tmux_driver._restart_claude_with_resume_sync(
                "daniel",
                "/home/clawd/repos/grupo_borges",
                "modelo inválido",
                "não-é-uuid",
            )
        except ValueError:
            pass
        else:
            raise AssertionError("preflight inválido deveria falhar")

    assert pane.respawn_calls == []


def test_restart_refuses_resume_missing_from_current_workspace(tmp_path: Path) -> None:
    pane = _BootstrapPane()
    server = _FakeServer(pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"

    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch(
            "services.tmux_driver._claude_resume_jsonl_path",
            return_value=tmp_path / "ausente.jsonl",
        ),
        pytest.raises(ValueError, match="não pertence ao workspace atual"),
    ):
        tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert pane.respawn_calls == []


def test_restart_refuses_jsonl_from_another_visible_conversation(tmp_path: Path) -> None:
    pane = _BootstrapPane()
    pane.visible_context = "texto distintivo da conversa realmente aberta"
    replacement_pane = _RelaunchPane("texto distintivo de outra conversa")
    server = _RelaunchServer(pane, replacement_pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"
    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"user","message":{"content":'
        '"texto distintivo de outra conversa"}}\n'
    )

    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
        pytest.raises(ValueError, match="não corresponde à conversa visível"),
    ):
        tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert server.commands == []
    assert server.active_pane is pane


def test_resume_jsonl_path_is_scoped_to_encoded_current_workspace() -> None:
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"

    with patch("services.tmux_driver.Path.home", return_value=Path("/home/tester")):
        path = tmux_driver._claude_resume_jsonl_path(
            Path("/home/clawd/repos/grupo_borges"),
            session_id,
        )

    assert path == (
        Path("/home/tester/.claude/projects")
        / "-home-clawd-repos-grupo-borges"
        / f"{session_id}.jsonl"
    )


def test_restart_refuses_unexpected_active_pane_before_window_swap(tmp_path: Path) -> None:
    pane = _BootstrapPane()
    pane.pane_current_command = "bash"
    server = _FakeServer(pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"
    resume_jsonl = tmp_path / f"{session_id}.jsonl"
    resume_jsonl.write_text(
        '{"type":"user","message":{"content":'
        '"contexto existente e suficientemente distintivo"}}\n'
    )

    with (
        patch("services.tmux_driver._server_for", return_value=server),
        patch("services.tmux_driver._claude_resume_jsonl_path", return_value=resume_jsonl),
    ):
        result = tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert result == {"attempted": False, "confirmed": False}
    assert pane.respawn_calls == []
