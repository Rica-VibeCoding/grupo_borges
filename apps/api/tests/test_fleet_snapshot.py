from __future__ import annotations

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
