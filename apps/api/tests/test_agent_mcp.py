"""JP-25 — endpoints MCP por agente."""
from __future__ import annotations

import json
import subprocess
import sys
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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


class FakeDB:
    def __init__(self, agent: dict) -> None:
        self.agent = agent

    async def get_agent(self, slug: str) -> dict | None:
        if slug == self.agent["slug"]:
            return self.agent
        return None


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _run(coro):
    return asyncio.run(coro)


def _build_request(tmp_path: Path, monkeypatch) -> tuple[SimpleNamespace, Path, Path, Path]:
    claude_home = tmp_path / "home" / ".claude"
    claude_json = tmp_path / "home" / ".claude.json"
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)

    monkeypatch.setattr(agents_router, "_CLAUDE_HOME", claude_home)
    monkeypatch.setattr(agents_router, "_CLAUDE_JSON", claude_json)

    agent = {**DANIEL, "workspace_path": str(workspace)}

    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                db=FakeDB(agent),
                agents_config={"agents": [agent]},
            )
        )
    )
    return request, claude_home, claude_json, workspace


def _servers_by_key(body: dict) -> dict[tuple[str, str], dict]:
    return {(server["kind"], server["id"]): server for server in body["servers"]}


def test_get_mcp_lists_plugin_and_project_servers_redacted(tmp_path: Path, monkeypatch) -> None:
    request, claude_home, claude_json, workspace = _build_request(tmp_path, monkeypatch)
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

    body = _run(agents_router.list_agent_mcp("daniel", request))
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
    serialized = json.dumps(body)
    assert "plugin-secret" not in serialized
    assert "env-secret" not in serialized
    assert "db-password" not in serialized
    assert "live-token" not in serialized


def test_get_mcp_includes_claude_ai_remote_from_ever_connected(tmp_path: Path, monkeypatch) -> None:
    request, _, claude_json, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(
        claude_json,
        {
            "claudeAiMcpEverConnected": ["claude.ai Supabase", "claude.ai Gmail"],
            "projects": {str(workspace): {"disabledMcpServers": []}},
        },
    )

    servers = _servers_by_key(_run(agents_router.list_agent_mcp("daniel", request)))
    assert servers[("remote", "claude.ai Supabase")] == {
        "kind": "remote",
        "id": "claude.ai Supabase",
        "name": "claude.ai Supabase",
        "enabled": True,
        "transport": "remote",
    }
    assert servers[("remote", "claude.ai Gmail")]["enabled"] is True


def test_get_mcp_marks_workspace_disabled_mcp_as_disabled(tmp_path: Path, monkeypatch) -> None:
    request, _, claude_json, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(
        claude_json,
        {
            "claudeAiMcpEverConnected": ["claude.ai Supabase"],
            "projects": {
                str(workspace): {
                    "disabledMcpServers": ["claude.ai Supabase", "context7_global"],
                }
            },
        },
    )

    servers = _servers_by_key(_run(agents_router.list_agent_mcp("daniel", request)))
    assert servers[("remote", "claude.ai Supabase")]["enabled"] is False
    assert servers[("user_scope", "context7_global")] == {
        "kind": "user_scope",
        "id": "context7_global",
        "name": "context7_global",
        "enabled": False,
        "transport": "unknown",
    }


def test_patch_mcp_plugin_invokes_claude_cli(tmp_path: Path, monkeypatch) -> None:
    """Toggle de plugin chama `claude plugin disable/enable` (não edita JSON).
    Mocka subprocess.run pra evitar mexer no estado real do CLI durante teste.
    """
    request, _, _, _ = _build_request(tmp_path, monkeypatch)
    calls: list[tuple[list[str], str | None]] = []

    def fake_run(cmd, **kwargs):
        calls.append((list(cmd), kwargs.get("cwd")))
        return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")

    monkeypatch.setattr(agents_router.subprocess, "run", fake_run)

    response = _run(
        agents_router.patch_agent_mcp(
            "daniel",
            "plugin",
            "telegram@claude-plugins-official",
            agents_router.McpToggleRequest(enabled=False),
            request,
        )
    )

    assert response == agents_router.McpToggleResponse(applied=True, requires_reload=True)
    assert len(calls) == 1
    cmd, cwd = calls[0]
    assert cmd == ["claude", "plugin", "disable", "telegram@claude-plugins-official"]
    # cwd = workspace do agente, pra settings.local.json override pegar.
    assert cwd is not None and cwd.endswith("workspace")


def test_patch_mcp_json_moves_between_enabled_and_disabled_lists(tmp_path: Path, monkeypatch) -> None:
    request, _, claude_json, workspace = _build_request(tmp_path, monkeypatch)
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

    response = _run(
        agents_router.patch_agent_mcp(
            "daniel",
            "mcp_json",
            "supabase-ze",
            agents_router.McpToggleRequest(enabled=True),
            request,
        )
    )

    assert response == agents_router.McpToggleResponse(applied=True, requires_reload=True)
    state = json.loads(claude_json.read_text(encoding="utf-8"))
    project = state["projects"][str(workspace)]
    assert project["enabledMcpjsonServers"] == ["supabase-ze"]
    assert project["disabledMcpjsonServers"] == []


def test_patch_mcp_remote_disabled_adds_to_disabled_mcp_servers(tmp_path: Path, monkeypatch) -> None:
    request, _, claude_json, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(claude_json, {"projects": {str(workspace): {"disabledMcpServers": None}}})

    response = _run(
        agents_router.patch_agent_mcp(
            "daniel",
            "remote",
            "claude.ai Supabase",
            agents_router.McpToggleRequest(enabled=False),
            request,
        )
    )

    assert response == agents_router.McpToggleResponse(applied=True, requires_reload=True)
    state = json.loads(claude_json.read_text(encoding="utf-8"))
    assert state["projects"][str(workspace)]["disabledMcpServers"] == ["claude.ai Supabase"]


def test_patch_mcp_remote_enabled_removes_from_disabled_mcp_servers(tmp_path: Path, monkeypatch) -> None:
    request, _, claude_json, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(
        claude_json,
        {"projects": {str(workspace): {"disabledMcpServers": ["claude.ai Supabase", "context7_global"]}}},
    )

    response = _run(
        agents_router.patch_agent_mcp(
            "daniel",
            "remote",
            "claude.ai Supabase",
            agents_router.McpToggleRequest(enabled=True),
            request,
        )
    )

    assert response == agents_router.McpToggleResponse(applied=True, requires_reload=True)
    state = json.loads(claude_json.read_text(encoding="utf-8"))
    assert state["projects"][str(workspace)]["disabledMcpServers"] == ["context7_global"]


def test_patch_mcp_user_scope_updates_disabled_mcp_servers(tmp_path: Path, monkeypatch) -> None:
    request, _, claude_json, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(claude_json, {"projects": {str(workspace): {"disabledMcpServers": []}}})

    disable_response = _run(
        agents_router.patch_agent_mcp(
            "daniel",
            "user_scope",
            "context7_global",
            agents_router.McpToggleRequest(enabled=False),
            request,
        )
    )
    enable_response = _run(
        agents_router.patch_agent_mcp(
            "daniel",
            "user_scope",
            "context7_global",
            agents_router.McpToggleRequest(enabled=True),
            request,
        )
    )

    assert disable_response == agents_router.McpToggleResponse(applied=True, requires_reload=True)
    assert enable_response == agents_router.McpToggleResponse(applied=True, requires_reload=True)
    state = json.loads(claude_json.read_text(encoding="utf-8"))
    assert state["projects"][str(workspace)]["disabledMcpServers"] == []


def test_reload_mcp_sends_reload_plugins_to_tmux(tmp_path: Path, monkeypatch) -> None:
    request, _, _, _ = _build_request(tmp_path, monkeypatch)

    with patch("routers.agents.tmux_driver.send_message", return_value=True) as send_message:
        response = _run(agents_router.reload_agent_mcp("daniel", request))

    assert response == agents_router.McpReloadResponse(tmux_delivered=True)
    send_message.assert_called_once_with("daniel", "/reload-plugins")
