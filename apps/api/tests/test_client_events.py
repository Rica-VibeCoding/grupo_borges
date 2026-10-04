from __future__ import annotations

import asyncio
import json
import time

import pytest
from starlette.requests import Request

from client_app import create_client_app
from routers import agents


@pytest.mark.asyncio
async def test_state_stream_emits_initial_and_watcher_change(monkeypatch):
    app = create_client_app(slug="cliente_a", token="t" * 40)
    state = {"lifecycle_status": "ocioso"}

    class FakeDB:
        async def get_agent(self, slug):
            return {"slug": slug, "tmux_session": "agente", **state}

    app.state.db = FakeDB()

    async def vida(_agent):
        return agents.AgentPainelVida(sessao=True, processo=True)

    async def cc_status(_db, _slug):
        return agents._CCStatus(None, None, None)

    monkeypatch.setattr(agents, "_build_painel_vida", vida)
    async def capture(_session):
        return "Opus 4.8 - 00:03:12 - [████░░░░░░] 40%"
    monkeypatch.setattr(agents.tmux_driver, "capture_pane_excerpt", capture)
    monkeypatch.setattr(agents, "_load_cc_status", cc_status)
    monkeypatch.setattr(agents, "_build_painel_contexto", lambda *_: agents.AgentPainelContexto(
        tokens=agents.AgentPainelTokens(), source="test", available=False,
    ))
    route = next(r for r in app.routes if getattr(r, "path", None) == "/api/agents/{slug}/events")

    async def receive():
        await asyncio.sleep(3600)

    request = Request({"type": "http", "method": "GET", "path": route.path,
                       "headers": [], "query_string": b"", "app": app}, receive)
    response = await route.endpoint("cliente_a", request)
    assert response.headers["x-accel-buffering"] == "no"
    first = await anext(response.body_iterator)
    assert first["event"] == "state"
    assert json.loads(first["data"])["status"] == "ocioso"
    assert json.loads(first["data"])["agent"]["pane_session_started_at"] is not None
    pending = asyncio.create_task(anext(response.body_iterator))
    await asyncio.sleep(0)
    state["lifecycle_status"] = "trabalhando"
    state["lifecycle_updated_at"] = int(time.time())
    await app.state.client_events.publish()
    second = await asyncio.wait_for(pending, 1)
    assert json.loads(second["data"])["status"] == "trabalhando"
    await response.body_iterator.aclose()
