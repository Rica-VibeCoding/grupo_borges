"""Testes focados no store SQLite."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import GrupoBorgesDB


@pytest.mark.asyncio
async def test_delete_jsonl_events_removes_only_target_agent_jsonl(tmp_path: Path) -> None:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents(
        [
            {
                "slug": slug,
                "name": slug.title(),
                "tmux_session": slug,
                "workspace_path": f"/tmp/{slug}",
                "model_default": "opus",
            }
            for slug in ("daniel", "hiro")
        ]
    )

    db._insert_task_event("jsonl:user", None, "daniel", None, {"type": "user"}, None)
    db._insert_task_event(
        "jsonl:assistant",
        None,
        "daniel",
        None,
        {"type": "assistant"},
        None,
    )
    db._insert_task_event("hook:stop", None, "daniel", None, {"type": "stop"}, None)
    db._insert_task_event("jsonl:user", None, "hiro", None, {"type": "user"}, None)

    deleted = await db.delete_jsonl_events("daniel")

    assert deleted == 2
    with db._connect() as conn:
        remaining = conn.execute(
            "SELECT agent_slug, kind FROM task_events ORDER BY id"
        ).fetchall()
    assert [(row["agent_slug"], row["kind"]) for row in remaining] == [
        ("daniel", "hook:stop"),
        ("hiro", "jsonl:user"),
    ]
