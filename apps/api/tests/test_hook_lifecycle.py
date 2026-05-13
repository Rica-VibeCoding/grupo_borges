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


class _Clock:
    def __init__(self, now: int) -> None:
        self.now = now

    def time(self) -> int:
        return self.now


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"tool_name": "Read", "tool_input": {"file_path": "PLANO.md"}}, ("reading", "Read")),
        (
            {"tool_name": "Edit", "tool_input": {"file_path": "apps/api/routers/hooks.py"}},
            ("writing", "apps/api/routers/hooks.py"),
        ),
        (
            {"tool_name": "Bash", "tool_input": {"command": "uv run pytest tests/test_hooks.py"}},
            ("executing", "uv run pytest tests/test_hooks.py"),
        ),
        (
            {
                "tool_name": "Bash",
                "tool_input": {"command": "tmux send-keys -t vinicius 'STATE:'"},
            },
            ("handoff", "vinicius"),
        ),
        (
            {"tool_name": "WebFetch", "tool_input": {"url": "https://example.com/docs"}},
            ("searching", "https://example.com/docs"),
        ),
    ],
)
def test_pre_tool_lifecycle_microstates(payload: dict, expected: tuple[str, str]) -> None:
    assert _hook_lifecycle("PreToolUse", payload) == expected


def test_pre_tool_lifecycle_tmux_handoff_with_hyphen_and_quotes() -> None:
    hyphen = _hook_lifecycle(
        "PreToolUse",
        {"tool_name": "Bash", "tool_input": {"command": "tmux send-keys -t miga-dani 'oi'"}},
    )
    quoted = _hook_lifecycle(
        "PreToolUse",
        {"tool_name": "Bash", "tool_input": {"command": "tmux send-keys -t \"vinicius\" hi"}},
    )
    assert hyphen == ("handoff", "miga-dani")
    assert quoted == ("handoff", "vinicius")


def test_pre_tool_lifecycle_tmux_handoff_regex_vs_generic_bash() -> None:
    handoff = _hook_lifecycle(
        "PreToolUse",
        {
            "tool_name": "Bash",
            "tool_input": {"command": "printf x && tmux send-keys -t vinicius 'segue'"},
        },
    )
    generic = _hook_lifecycle(
        "PreToolUse",
        {"tool_name": "Bash", "tool_input": {"command": "printf x && pytest -q"}},
    )

    assert handoff == ("handoff", "vinicius")
    assert generic == ("executing", "printf x && pytest -q")


def test_derive_lifecycle_from_jsonl_assistant_end_turn() -> None:
    from db.store import derive_lifecycle_from_event

    payload = {"message": {"stop_reason": "end_turn", "content": []}}
    status, detail = derive_lifecycle_from_event("jsonl:assistant", payload)
    assert status == "idle"
    assert detail == "passou a bola"


def test_lifecycle_hold_suppresses_tool_done_inside_window(tmp_path: Path, monkeypatch) -> None:
    import db.store as store

    db = _setup_db(tmp_path)
    clock = _Clock(1_000)
    monkeypatch.setattr(store, "time", clock)

    db._update_agent_lifecycle(
        "daniel",
        status="writing",
        detail="apps/api/db/store.py",
        event="hook:PreToolUse",
    )
    clock.now += 1
    db._update_agent_lifecycle(
        "daniel",
        status="tool_done",
        detail="Edit",
        event="hook:PostToolUse",
    )

    agent = db._get_agent("daniel")
    assert agent["lifecycle_status"] == "writing"
    assert agent["lifecycle_detail"] == "apps/api/db/store.py"
    assert agent["lifecycle_event"] == "hook:PostToolUse"
    assert agent["lifecycle_updated_at"] == 1_000


def test_lifecycle_hold_allows_tool_done_after_window(tmp_path: Path, monkeypatch) -> None:
    import db.store as store

    db = _setup_db(tmp_path)
    clock = _Clock(1_000)
    monkeypatch.setattr(store, "time", clock)

    db._update_agent_lifecycle(
        "daniel",
        status="writing",
        detail="apps/api/db/store.py",
        event="hook:PreToolUse",
    )
    clock.now += 10
    db._update_agent_lifecycle(
        "daniel",
        status="tool_done",
        detail="Edit",
        event="hook:PostToolUse",
    )

    agent = db._get_agent("daniel")
    assert agent["lifecycle_status"] == "tool_done"
    assert agent["lifecycle_detail"] == "Edit"
    assert agent["lifecycle_event"] == "hook:PostToolUse"
    assert agent["lifecycle_updated_at"] == 1_010
