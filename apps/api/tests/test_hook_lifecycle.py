from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers.hooks import _hook_lifecycle


AGENT = {
    "slug": "daniel",
    "name": "Daniel Singh",
    "role": "reviewer",
    "emoji": "DS",
    "tmux_session": "daniel",
    "workspace_path": "/tmp/daniel",
    "cli_default": "claude_code",
    "model_default": "opus",
    "capabilities": [],
    "can_review": [],
}


def _setup_db(tmp_path: Path):
    from db.store import GrupoBorgesDB

    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([AGENT])
    return db


@pytest.mark.parametrize(
    ("event_kind", "payload", "expected"),
    [
        ("SessionStart", {}, ("ocioso", "sessão iniciada")),
        ("UserPromptSubmit", {"prompt": "executa a missão"}, ("trabalhando", "executa a missão")),
        (
            "PreToolUse",
            {"tool_name": "Edit", "tool_input": {"file_path": "apps/api/routers/hooks.py"}},
            ("trabalhando", "apps/api/routers/hooks.py"),
        ),
        (
            "PreToolUse",
            {"tool_name": "Bash", "tool_input": {"command": "uv run pytest tests/test_hooks.py"}},
            ("trabalhando", "uv run pytest tests/test_hooks.py"),
        ),
        (
            "PreToolUse",
            {"tool_name": "WebSearch", "tool_input": {"query": "FastAPI SSE docs"}},
            ("trabalhando", "FastAPI SSE docs"),
        ),
        ("PostToolUse", {"tool_name": "Edit"}, ("trabalhando", "Edit")),
        ("PostToolUseFailure", {"tool_name": "Bash"}, ("aguardando", "Bash")),
        ("SubagentStart", {"agent_type": "general-purpose"}, ("trabalhando", "general-purpose")),
        ("SubagentStop", {"agent_type": "general-purpose"}, ("trabalhando", "general-purpose")),
        ("Stop", {}, ("ocioso", "passou a bola")),
        ("StopFailure", {"reason": "precisa de input"}, ("aguardando", "precisa de input")),
        ("UnknownEvent", {}, ("trabalhando", "UnknownEvent")),
    ],
)
def test_hook_lifecycle_returns_4_states_only(
    event_kind: str,
    payload: dict,
    expected: tuple[str, str],
) -> None:
    status, detail = _hook_lifecycle(event_kind, payload)
    assert (status, detail) == expected
    assert status in {"ocioso", "trabalhando", "aguardando"}


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        (
            {"last_seen": None, "instances": [], "now": 1_000},
            "offline",
        ),
        (
            {
                "last_seen": 950,
                "instances": [],
                "lifecycle_status": "trabalhando",
                "lifecycle_updated_at": 950,
                "now": 1_000,
            },
            "trabalhando",
        ),
        (
            {
                "last_seen": 950,
                "instances": [],
                "lifecycle_status": "aguardando",
                "lifecycle_updated_at": 100,
                "now": 1_000,
            },
            "aguardando",
        ),
        (
            {
                "last_seen": 950,
                "instances": [],
                "lifecycle_status": "ocioso",
                "lifecycle_updated_at": 950,
                "now": 1_000,
            },
            "ocioso",
        ),
        (
            {"last_seen": 950, "instances": [{"status": "running"}], "now": 1_000},
            "trabalhando",
        ),
        (
            {"last_seen": 950, "instances": [{"status": "blocked"}], "now": 1_000},
            "aguardando",
        ),
        (
            {"last_seen": 950, "instances": [{"status": "done"}], "now": 1_000},
            "ocioso",
        ),
    ],
)
def test_derive_agent_status_4_values(kwargs: dict, expected: str) -> None:
    from db.store import derive_agent_status

    status = derive_agent_status(**kwargs)
    assert status == expected
    assert status in {"ocioso", "trabalhando", "aguardando", "offline"}


def test_derive_lifecycle_from_jsonl_assistant_end_turn() -> None:
    from db.store import derive_lifecycle_from_event

    payload = {"message": {"stop_reason": "end_turn", "content": []}}
    status, detail = derive_lifecycle_from_event("jsonl:assistant", payload)
    assert status == "ocioso"
    assert detail == "passou a bola"


def test_derive_lifecycle_jsonl_assistant_tool_use_does_not_emit_tool() -> None:
    """Pre-anúncio de tool_use no JSONL não deve sobrescrever o hook PreToolUse."""
    from db.store import derive_lifecycle_from_event

    payload = {
        "message": {
            "content": [{"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}],
        },
    }
    status, detail = derive_lifecycle_from_event("jsonl:assistant", payload)
    assert status is None
    assert detail is None


def test_jsonl_watcher_assistant_tool_use_returns_none() -> None:
    """Simetria: _jsonl_lifecycle no watcher não emite lifecycle pra tool_use."""
    from orchestrator.jsonl_watcher import _jsonl_lifecycle

    payload = {
        "type": "assistant",
        "message": {
            "content": [{"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}],
        },
    }
    status, detail = _jsonl_lifecycle(payload, "assistant")
    assert status is None
    assert detail is None
