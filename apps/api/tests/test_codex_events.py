from __future__ import annotations

import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import GrupoBorgesDB
from routers.codex_events import CodexEventCreate, _codex_lifecycle, _codex_state_update


TARA = {
    "slug": "tara",
    "name": "Tara Kaur",
    "role": "codex",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "codex",
    "model_default": "codex-gpt-5-5",
    "capabilities": [],
    "can_review": [],
}


DANIEL = {
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


def _setup_db(tmp_path: Path) -> GrupoBorgesDB:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL, TARA])
    return db


def _event(kind: str, payload: dict | None = None) -> CodexEventCreate:
    return CodexEventCreate(
        kind=kind,
        delegator_agent_slug="daniel",
        target_agent_slug="tara",
        payload=payload,
    )


def test_codex_events_update_agent_state(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)

    for event in (
        _event("tara.exec.started", {"started_at": 1_700_000_000, "label": "Opção C"}),
        _event("codex.turn.started"),
        _event(
            "codex.item.started",
            {"item": {"type": "command_execution", "command": "uv run pytest apps/api/tests"}},
        ),
        _event(
            "codex.item.completed",
            {"item": {"type": "agent_message", "text": "Backend completo com parser Codex."}},
        ),
        _event(
            "codex.turn.completed",
            {"usage": {"input_tokens": 32_000, "output_tokens": 100}},
        ),
        _event("tara.exec.completed"),
    ):
        db._update_agent_codex_state("tara", **_codex_state_update(event))
    status, detail = _codex_lifecycle(_event("tara.exec.completed"))
    db._update_agent_lifecycle(
        "tara",
        status=status,
        detail=detail,
        event="tara.exec.completed",
    )

    agent = db._get_agent("tara")
    fleet_agent = next(agent for agent in db._fleet_snapshot(24)["agents"] if agent["slug"] == "tara")

    assert agent["executor_kind"] == "codex"
    assert agent["status_line"] == "ocioso"
    assert agent["active_task_label"] == "Opção C"
    assert agent["context_pct"] is None
    assert fleet_agent["context_pct"] is None
    assert agent["session_started_at"] == 1_700_000_000
    assert agent["last_assistant_message"] == "Backend completo com parser Codex."
    assert agent["token_usage_json"] == '{"input_tokens": 32000, "output_tokens": 100}'
    assert agent["lifecycle_status"] == "ocioso"


def test_codex_failed_marks_lifecycle_offline(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)

    event = _event("tara.exec.failed", {"error": "processo abortou"})
    db._update_agent_codex_state("tara", **_codex_state_update(event))
    status, detail = _codex_lifecycle(event)
    db._update_agent_lifecycle(
        "tara",
        status=status,
        detail=detail,
        event="tara.exec.failed",
    )

    agent = db._get_agent("tara")
    fleet_agent = next(agent for agent in db._fleet_snapshot(24)["agents"] if agent["slug"] == "tara")

    assert agent["executor_kind"] == "codex"
    assert agent["status_line"] == "falhou: processo abortou"
    assert agent["lifecycle_status"] == "offline"
    assert fleet_agent["status"] == "offline"


def test_fleet_snapshot_keeps_new_fields_null_for_claude_code(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)

    daniel = next(agent for agent in db._fleet_snapshot(24)["agents"] if agent["slug"] == "daniel")

    assert daniel["executor_kind"] is None
    assert daniel["status_line"] is None
    assert daniel["active_task_label"] is None
    assert daniel["context_pct"] is None
    assert daniel["session_started_at"] is None
    assert daniel["last_assistant_message"] is None
    assert daniel["token_usage_json"] is None
