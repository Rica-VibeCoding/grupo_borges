from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
import yaml

from client_app import create_client_app
from orchestrator.jsonl_watcher import encoded_cwd


@pytest.mark.asyncio
async def test_client_profile_reuses_routes_and_isolates_one_agent(tmp_path: Path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    projects = tmp_path / "claude" / "projects"
    folder = projects / encoded_cwd(str(workspace))
    folder.mkdir(parents=True)
    session_id = "12345678-1234-4234-8234-123456789012"
    (folder / f"{session_id}.jsonl").write_text(
        json.dumps({
            "type": "user", "uuid": "msg-1", "sessionId": session_id,
            "timestamp": "2026-10-03T12:00:00.000Z",
            "message": {"role": "user", "content": "Olá"},
        }) + "\n", encoding="utf-8",
    )
    config = tmp_path / "agent.yaml"
    config.write_text(yaml.safe_dump({"agents": [{
        "slug": "cliente_a", "name": "Cliente A", "tmux_session": "agente",
        "workspace_path": str(workspace), "cli_default": "claude_code",
        "model_default": "opus",
    }]}), encoding="utf-8")
    monkeypatch.setenv("GB_AGENTS_YAML", str(config))
    monkeypatch.setenv("GB_DB_PATH", str(tmp_path / "api.db"))
    monkeypatch.setenv("GB_CLAUDE_PROJECTS_DIR", str(projects))
    app = create_client_app(slug="cliente_a", token="t" * 40)
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=transport, base_url="http://local") as client:
        assert (await client.get("/health")).status_code == 200
        assert (await client.get("/api/agents/cliente_a")).status_code == 401
        headers = {"Authorization": "Bearer " + "t" * 40}
        response = await client.get("/api/agents/cliente_a", headers=headers)
        assert response.status_code == 200
        assert response.json()["slug"] == "cliente_a"
        response = await client.get("/api/agents/cliente_a/conversas?curtas=1", headers=headers)
        assert response.status_code == 200
        assert any(row["id"] == session_id for row in response.json()["conversas"])
        assert (await client.get("/api/agents/cliente_b", headers=headers)).status_code == 403
        assert (await client.post("/api/agents/cliente_b/input", headers=headers, json={"text": "x"})).status_code == 403
        assert (await client.get("/api/agents/cliente_a/mcp", headers=headers)).status_code == 404
        assert (await client.get("/api/fleet", headers=headers)).status_code == 404


def test_client_profile_refuses_multi_agent_config(tmp_path: Path, monkeypatch):
    config = tmp_path / "agent.yaml"
    config.write_text(yaml.safe_dump({"agents": [
        {"slug": "cliente_a"}, {"slug": "cliente_b"},
    ]}), encoding="utf-8")
    monkeypatch.setenv("GB_AGENTS_YAML", str(config))
    app = create_client_app(slug="cliente_a", token="t" * 40)
    with pytest.raises(RuntimeError, match="só o cliente"):
        import asyncio
        asyncio.run(_open_lifespan(app))


async def _open_lifespan(app):
    async with app.router.lifespan_context(app):
        pass
