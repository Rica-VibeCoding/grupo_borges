from __future__ import annotations

import asyncio
from pathlib import Path

from db.store import GrupoBorgesDB


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


def _setup_db(tmp_path: Path) -> GrupoBorgesDB:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    asyncio.run(db.startup())
    asyncio.run(db.sync_agents_from_yaml([AGENT]))
    return db


def _agent_from_snapshot(snapshot: dict, slug: str) -> dict:
    return next(agent for agent in snapshot["agents"] if agent["slug"] == slug)


def test_fleet_snapshot_ignores_ready_and_backlog_tasks(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)
    asyncio.run(
        db.create_task(
            id="ready-task",
            title="Ready task",
            assignee="daniel",
            status="ready",
        )
    )
    asyncio.run(
        db.create_task(
            id="backlog-task",
            title="Backlog task",
            assignee="daniel",
            status="backlog",
        )
    )

    snapshot = asyncio.run(db.fleet_snapshot())

    assert _agent_from_snapshot(snapshot, "daniel")["current_task_id"] is None


def test_fleet_snapshot_uses_running_task_display_id(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)
    running = asyncio.run(
        db.create_task(
            id="running-task",
            title="Running task",
            assignee="daniel",
            status="running",
        )
    )
    asyncio.run(
        db.create_task(
            id="ready-task",
            title="Ready task",
            assignee="daniel",
            status="ready",
        )
    )

    snapshot = asyncio.run(db.fleet_snapshot())

    assert _agent_from_snapshot(snapshot, "daniel")["current_task_id"] == running["human_id"]
