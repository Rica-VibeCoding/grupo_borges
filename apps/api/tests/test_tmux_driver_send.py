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
            cursor_x = 2 if self.state == "empty" else 20
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


class _PaddedCapturePane(_BottomBorderOnlyPane):
    def capture_pane(self, **kwargs: object) -> list[str]:
        if kwargs.get("join_wrapped") is True:
            content = self.visible_text if self.state == "armed" else ""
            return [f"❯ {content}".ljust(220)]
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

    def send_keys(self, command: str) -> None:
        self.sent_commands.append(command)

    def capture_pane(self, **_kwargs: object) -> list[str]:
        return ["Claude Code v2.0"]


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


def _driver_patches(pane: _FakePane):
    completed = SimpleNamespace(returncode=0, stdout="", stderr="")
    return (
        patch("services.tmux_driver._server_for", return_value=_FakeServer(pane)),
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

    assert _recover(pane) == {"tmux_delivered": False, "degrau": 2, "acao": "input_vazio"}


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
    pane = _FakePane("  texto humano com espaços", enter_succeeds_on=2)
    pane.state = "armed"

    assert _recover(pane)["degrau"] == 4
    assert pane.payload == "  texto humano com espaços"


def test_recover_joins_soft_wrap_without_inserting_newline() -> None:
    pane = _SoftWrappedPane("texto muito longo sem quebra lógica", enter_succeeds_on=2)
    pane.state = "armed"

    result = _recover(pane)

    assert result["tmux_delivered"] is True
    assert result["degrau"] == 4


def test_recover_does_not_repaste_until_c_u_is_observed_empty() -> None:
    pane = _ClearNoOpPane("texto humano", enter_succeeds_on=None)
    pane.state = "armed"

    result = _recover(pane)

    assert result == {
        "tmux_delivered": False,
        "degrau": 5,
        "acao": "limpeza_nao_confirmada_buffer_preservado",
    }
    assert pane.paste_count == 0


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


def test_restart_replaces_pane_and_bootstraps_exact_resume_session() -> None:
    pane = _BootstrapPane()
    server = _FakeServer(pane)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"

    with patch("services.tmux_driver._server_for", return_value=server):
        result = tmux_driver._restart_claude_with_resume_sync(
            "daniel",
            "/home/clawd/repos/grupo_borges",
            "claude-opus-4-8",
            session_id,
        )

    assert result == {"attempted": True, "confirmed": True}
    assert pane.sent_commands == []
    respawn = pane.respawn_calls[0]
    assert respawn[:4] == (
        "respawn-pane",
        "-k",
        "-c",
        "/home/clawd/repos/grupo_borges",
    )
    assert respawn[4].endswith(f"--resume {session_id}")


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
