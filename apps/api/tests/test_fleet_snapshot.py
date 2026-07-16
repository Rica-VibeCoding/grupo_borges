from __future__ import annotations

import json
import time
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import fleet as fleet_router


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

TARA = {
    "slug": "tara",
    "name": "Tara Kaur",
    "role": "codex",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "codex",
    "model_default": "codex-gpt-5-6-sol",
    "capabilities": [],
    "can_review": [],
}


def _setup_db(tmp_path: Path) -> GrupoBorgesDB:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([AGENT])
    return db


def _create_task(
    db: GrupoBorgesDB,
    *,
    id: str,
    title: str,
    assignee: str,
    status: str,
) -> dict:
    return db._create_task(
        id=id,
        title=title,
        assignee=assignee,
        body=None,
        instance_id=None,
        origin_agent=None,
        skill_hint=None,
        status=status,
        priority=0,
        idempotency_key=None,
    )


def _agent_from_snapshot(snapshot: dict, slug: str) -> dict:
    return next(agent for agent in snapshot["agents"] if agent["slug"] == slug)


def test_fleet_snapshot_ignores_ready_and_backlog_tasks(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)
    _create_task(
        db,
        id="ready-task",
        title="Ready task",
        assignee="daniel",
        status="ready",
    )
    _create_task(
        db,
        id="backlog-task",
        title="Backlog task",
        assignee="daniel",
        status="backlog",
    )

    snapshot = db._fleet_snapshot(24)

    assert _agent_from_snapshot(snapshot, "daniel")["current_task_id"] is None


def test_fleet_snapshot_uses_running_task_display_id(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)
    running = _create_task(
        db,
        id="running-task",
        title="Running task",
        assignee="daniel",
        status="running",
    )
    _create_task(
        db,
        id="ready-task",
        title="Ready task",
        assignee="daniel",
        status="ready",
    )

    snapshot = db._fleet_snapshot(24)

    assert _agent_from_snapshot(snapshot, "daniel")["current_task_id"] == running["human_id"]


def test_fleet_route_hydrates_claude_context_pct_from_status_file(tmp_path: Path, monkeypatch) -> None:
    db = _setup_db(tmp_path)
    session_id = f"fleet-context-{int(time.time())}"
    db._insert_task_event(
        "jsonl:assistant",
        task_id=None,
        agent_slug="daniel",
        instance_id=None,
        payload={"uuid": f"uuid-{session_id}", "sessionId": session_id},
        raw_jsonl=None,
    )
    status_path = Path(f"/tmp/cc-status-{session_id}.json")
    status_path.write_text(
        json.dumps(
            {
                "context_window": {
                    "used_percentage": 42,
                },
            }
        ),
        encoding="utf-8",
    )

    async def fake_capture(_session_name: str) -> str:
        return "Opus 4.8 - Cascading... (3m 33s · 12.7k tokens)"

    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", fake_capture)

    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")

    try:
        with TestClient(app) as client:
            response = client.get("/api/fleet")

        assert response.status_code == 200
        agent = _agent_from_snapshot(response.json(), "daniel")
        assert agent["context_pct"] == 42
    finally:
        status_path.unlink(missing_ok=True)


def test_fleet_route_hydrates_codex_tokens_used_from_native_thread(tmp_path: Path, monkeypatch) -> None:
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])
    db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        context_pct=100.0,
        codex_next_fresh=1,
    )

    async def fake_capture(_session_name: str) -> str:
        return "GPT-5.6 Sol - 00:03:03"

    def fake_find_latest_thread(cwd: str):
        assert cwd == "/tmp/tara"
        return SimpleNamespace(tokens_used=9_712_154)

    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", fake_capture)
    monkeypatch.setattr(fleet_router.codex_reader, "find_latest_thread", fake_find_latest_thread)

    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")

    with TestClient(app) as client:
        response = client.get("/api/fleet")

    assert response.status_code == 200
    agent = _agent_from_snapshot(response.json(), "tara")
    assert agent["codex_tokens_used"] == 9_712_154
    assert agent["codex_next_fresh"] is True
    assert agent["context_pct"] is None
