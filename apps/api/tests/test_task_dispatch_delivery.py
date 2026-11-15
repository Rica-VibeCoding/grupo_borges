"""Reasons de entrega incerta preservam o tratamento atual das tasks."""
from __future__ import annotations

import json
import sqlite3
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from test_agent_input import DANIEL

from db.store import GrupoBorgesDB
from orchestrator.auto_dispatcher import AutoDispatcher
from routers.tasks import TaskDispatch, dispatch_task
from services import tmux_driver


@pytest.mark.parametrize("reason", ["envio_nao_confirmado", "envio_incerto"])
@pytest.mark.parametrize("source", ["manual", "auto"])
async def test_dispatch_uncertain_preserves_blocked_state(
    banco_fora_da_frota, monkeypatch, reason: str, source: str,
) -> None:
    db = GrupoBorgesDB(str(banco_fora_da_frota))
    db._sync_agents([DANIEL])
    await db.create_task(id="missao", title="Teste", assignee="daniel", status="ready")
    send = AsyncMock(return_value=tmux_driver.DeliveryResult(outcome="uncertain", reason=reason))
    monkeypatch.setattr(tmux_driver, "send_message", send)

    if source == "manual":
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))
        with pytest.raises(HTTPException) as erro:
            await dispatch_task("missao", TaskDispatch(), request)
        assert erro.value.status_code == 409
    else:
        await AutoDispatcher(db=db, interval_seconds=1, batch_size=1)._tick()

    assert (await db.get_task("missao"))["status"] == "blocked"
    send.assert_awaited_once()
    with sqlite3.connect(db.db_path) as conn:
        assert conn.execute("SELECT status, outcome FROM task_runs").fetchall() == [
            ("blocked", "dispatch_failed")
        ]
        [(payload,)] = conn.execute(
            "SELECT payload FROM task_events WHERE kind = 'dispatch.failed'"
        ).fetchall()
        assert json.loads(payload)["reason"] == reason
        assert json.loads(payload)["source"] == source
        assert conn.execute("SELECT COUNT(*) FROM task_events WHERE kind = 'dispatch'").fetchone()[0] == 0
