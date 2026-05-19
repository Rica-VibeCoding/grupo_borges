"""JP-25 — endpoints MCP por agente."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import agents as agents_router


DANIEL = {
    "slug": "daniel",
    "name": "Daniel Singh",
    "role": "reviewer",
    "emoji": "DS",
    "tmux_session": "daniel",
    "workspace_path": "",
    "cli_default": "claude_code",
    "model_default": "opus",
    "capabilities": [],
    "can_review": [],
}


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _build_app(tmp_path: Path, monkeypatch) -> tuple[FastAPI, Path, Path, Path]:
    claude_home = tmp_path / "home" / ".claude"
    claude_json = tmp_path / "home" / ".claude.json"
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)

    monkeypatch.setattr(agents_router, "_CLAUDE_HOME", claude_home)
    monkeypatch.setattr(agents_router, "_CLAUDE_JSON", claude_json)

    agent = {**DANIEL, "workspace_path": str(workspace)}
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([agent])

    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [agent]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app, claude_home, claude_json, workspace


def test_get_mcp_lists_plugin_and_project_servers_redacted(tmp_path: Path, monkeypatch) -> None:
    app, claude_home, claude_json, workspace = _build_app(tmp_path, monkeypatch)
    plugin_dir = tmp_path / "plugin"
    _write_json(
        plugin_dir / ".mcp.json",
        {
            "mcpServers": {
                "telegram": {
                    "transport": "stdio",
                    "command": "node",
                    "args": ["server.js", "--access-token", "plugin-secret"],
                    "description": "Telegram channel",
                    "env": {"API_TOKEN": "env-secret"},
                }
            }
        },
    )
    _write_json(
        claude_home / "settings.json",
        {"enabledPlugins": {"telegram@claude-plugins-official": True}},
    )
    _write_json(
        claude_home / "plugins" / "installed_plugins.json",
        {
            "plugins": [
                {
                    "id": "telegram@claude-plugins-official",
                    "name": "telegram",
                    "installPath": str(plugin_dir),
                }
            ]
        },
    )
    _write_json(
        workspace / ".mcp.json",
        {
            "supabase-ze": {
                "command": "npx",
                "args": ["-y", "@supabase/mcp-server@latest", "--password=db-password"],
                "headers": {"Authorization": "Bearer live-token"},
            }
        },
    )
    _write_json(
        claude_json,
        {
            "projects": {
                str(workspace): {
                    "enabledMcpjsonServers": ["supabase-ze"],
                    "disabledMcpjsonServers": [],
                }
            }
        },
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/mcp")

    assert response.status_code == 200
    body = response.json()
    assert body["servers"] == [
        {
            "kind": "plugin",
            "id": "telegram@claude-plugins-official",
            "name": "telegram",
            "enabled": True,
            "transport": "stdio",
            "description": "Telegram channel",
            "command_redacted": "node server.js --access-token <redacted>",
        },
        {
            "kind": "mcp_json",
            "id": "supabase-ze",
            "name": "supabase-ze",
            "enabled": True,
            "transport": "stdio",
            "command_redacted": "npx -y @supabase/mcp-server@latest --password=<redacted>",
        },
    ]
    serialized = response.text
    assert "plugin-secret" not in serialized
    assert "env-secret" not in serialized
    assert "db-password" not in serialized
    assert "live-token" not in serialized


def test_patch_mcp_plugin_updates_enabled_plugins(tmp_path: Path, monkeypatch) -> None:
    app, claude_home, _, _ = _build_app(tmp_path, monkeypatch)
    settings_path = claude_home / "settings.json"
    _write_json(settings_path, {"enabledPlugins": {"telegram@claude-plugins-official": True}})

    with TestClient(app) as client:
        response = client.patch(
            "/api/agents/daniel/mcp/plugin/telegram@claude-plugins-official",
            json={"enabled": False},
        )

    assert response.status_code == 200
    assert response.json() == {"applied": True, "requires_reload": True}
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    assert settings["enabledPlugins"]["telegram@claude-plugins-official"] is False


def test_patch_mcp_json_moves_between_enabled_and_disabled_lists(tmp_path: Path, monkeypatch) -> None:
    app, _, claude_json, workspace = _build_app(tmp_path, monkeypatch)
    _write_json(
        claude_json,
        {
            "projects": {
                str(workspace): {
                    "enabledMcpjsonServers": None,
                    "disabledMcpjsonServers": ["supabase-ze"],
                }
            }
        },
    )

    with TestClient(app) as client:
        response = client.patch(
            "/api/agents/daniel/mcp/mcp_json/supabase-ze",
            json={"enabled": True},
        )

    assert response.status_code == 200
    assert response.json() == {"applied": True, "requires_reload": True}
    state = json.loads(claude_json.read_text(encoding="utf-8"))
    project = state["projects"][str(workspace)]
    assert project["enabledMcpjsonServers"] == ["supabase-ze"]
    assert project["disabledMcpjsonServers"] == []


def test_reload_mcp_sends_reload_plugins_to_tmux(tmp_path: Path, monkeypatch) -> None:
    app, _, _, _ = _build_app(tmp_path, monkeypatch)

    with patch("routers.agents.tmux_driver.send_message", return_value=True) as send_message:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/mcp/reload")

    assert response.status_code == 200
    assert response.json() == {"tmux_delivered": True}
    send_message.assert_called_once_with("daniel", "/reload-plugins")
