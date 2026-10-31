"""Config efetiva por agente: settings, MCP CLI e escopos persistentes."""
from pathlib import Path
from types import SimpleNamespace
import json

import pytest

from test_agent_mcp import _build_request, _run, _servers_by_key, _write_json
from routers import agents as router
from services import agent_mcp_config as config
from services.agent_mcp_config import live_command


def _toggle(request, kind, id_, enabled):
    return _run(router.patch_agent_mcp("daniel", kind, id_, router.McpToggleRequest(enabled=enabled), request))


def test_fluytpos_effective_sources(tmp_path, monkeypatch):
    request, home, state, workspace = _build_request(tmp_path, monkeypatch)
    plugin_ids = [f"{name}@official" for name in ("context7", "superpowers", "document-skills", "other")]
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {id_: {} for id_ in plugin_ids}})
    _write_json(home / "settings.json", {"enabledPlugins": {id_: True for id_ in plugin_ids}})
    _write_json(workspace / ".claude/settings.json", {"enabledPlugins": {
        "superpowers@official": False, "document-skills@official": False, "other@official": False,
    }})
    _write_json(workspace / ".claude/settings.local.json", {"enabledPlugins": {"other@official": True, "context7@official": True}})
    settings_path = home / "agentes/fluytpos.settings.json"
    _write_json(settings_path, {"enabledPlugins": {"context7@official": False}})
    mcp_path = home / "agentes/fluytpos.mcp.json"
    _write_json(mcp_path, {"mcpServers": {name: {"command": "cli-server"} for name in (
        "ask-user", "context7_global", "supabase_geral",
    )}})
    user_servers = ("context7_global", "n8n", "rea", "shadcn", "supabase-ze", "supabase_geral")
    _write_json(state, {"mcpServers": {name: {"command": "user-server"} for name in user_servers}})
    monkeypatch.setattr(config, "live_command", lambda session: (
        ["claude", "--settings", str(settings_path), "--mcp-config", str(mcp_path)], workspace,
    ))

    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    for name in ("context7", "superpowers", "document-skills"):
        assert servers[("plugin", f"{name}@official")]["enabled"] is False
    assert servers[("plugin", "other@official")]["enabled"] is True
    assert servers[("plugin", "context7@official")]["origin"] == f"--settings {settings_path}"
    assert servers[("plugin", "superpowers@official")]["origin"] == str(workspace / ".claude/settings.json")
    for name in ("ask-user", "context7_global", "supabase_geral"):
        entry = servers[("mcp_config", name)]
        assert entry["enabled"] is True
        assert entry["toggleable"] is False
        assert entry["origin"] == f"--mcp-config {mcp_path}"
        assert entry["command_redacted"] == "cli-server"
        assert ("user_scope", name) not in servers
    for name in ("n8n", "rea", "shadcn", "supabase-ze"):
        assert servers[("user_scope", name)]["enabled"] is True
        assert servers[("user_scope", name)]["origin"] == str(state)


def test_scope_precedence_local_project_user_and_toggles(tmp_path, monkeypatch):
    request, _, state, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(state, {
        "mcpServers": {name: {"command": "user"} for name in ("same", "project-wins", "user", "off")},
        "projects": {str(workspace): {
            "mcpServers": {"same": {"command": "local"}, "local": {"command": "local"}},
            "enabledMcpjsonServers": ["same", "project-wins"],
            "disabledMcpServers": ["off"],
        }, "/another/workspace": {"mcpServers": {"foreign": {"command": "secret"}}}},
    })
    _write_json(workspace / ".mcp.json", {"mcpServers": {
        "same": {"command": "project"}, "project-wins": {"command": "project"},
    }})
    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    assert set(servers) == {("local_scope", "same"), ("local_scope", "local"),
                            ("mcp_json", "project-wins"), ("user_scope", "user"), ("user_scope", "off")}
    assert servers[("local_scope", "same")]["command_redacted"] == "local"
    assert servers[("mcp_json", "project-wins")]["command_redacted"] == "project"
    assert servers[("user_scope", "off")]["enabled"] is False
    before = json.loads(state.read_text())
    for kind, name in (("local_scope", "same"), ("user_scope", "user"), ("mcp_json", "project-wins")):
        _toggle(request, kind, name, False)
        assert _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[(kind, name)]["enabled"] is False
        _toggle(request, kind, name, True)
        assert _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[(kind, name)]["enabled"] is True
    after = json.loads(state.read_text())
    assert after["mcpServers"] == before["mcpServers"]
    assert after["projects"]["/another/workspace"] == before["projects"]["/another/workspace"]
    assert after["projects"][str(workspace)]["mcpServers"] == before["projects"][str(workspace)]["mcpServers"]


def test_plugin_toggle_respects_cli_settings_precedence(tmp_path, monkeypatch):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {"context7@official": {}}})
    target = tmp_path / "agent.settings.json"
    original = {"enabledPlugins": {"context7@official": False, "other": True}, "env": {"KEEP": "value"}}
    _write_json(target, original)
    monkeypatch.setattr(config, "live_command", lambda _: (["claude", f"--settings={target}"], workspace))
    _toggle(request, "plugin", "context7@official", True)
    assert json.loads(target.read_text()) == {**original, "enabledPlugins": {"context7@official": True, "other": True}}
    assert not (workspace / ".claude/settings.local.json").exists()
    assert not (home / "settings.json").exists()
    assert _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("plugin", "context7@official")]["enabled"] is True


@pytest.mark.parametrize("inline", [False, True])
def test_cli_mcp_toggle_rejected_without_writes(tmp_path, monkeypatch, inline):
    request, _, state, workspace = _build_request(tmp_path, monkeypatch)
    mcp = {"mcpServers": {"ask-user": {"command": "node"}}}
    target = tmp_path / "cli.mcp.json"
    _write_json(target, mcp)
    value = json.dumps(mcp) if inline else str(target)
    monkeypatch.setattr(config, "live_command", lambda _: (["claude", "--mcp-config", value], workspace))
    for kind in ("mcp_config", "user_scope", "mcp_json", "local_scope"):
        with pytest.raises(router.HTTPException) as exc:
            _toggle(request, kind, "ask-user", False)
        assert exc.value.status_code == 422
    assert not state.exists()
    assert json.loads(target.read_text()) == mcp


def test_inline_settings_plugin_toggle_rejected_without_writes(tmp_path, monkeypatch):
    request, home, state, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {"context7@official": {}}})
    inline = json.dumps({"enabledPlugins": {"context7@official": False}})
    monkeypatch.setattr(config, "live_command", lambda _: (["claude", "--settings", inline], workspace))
    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    assert servers[("plugin", "context7@official")]["toggleable"] is False
    assert inline not in json.dumps(servers[("plugin", "context7@official")])
    with pytest.raises(router.HTTPException) as exc:
        _toggle(request, "plugin", "context7@official", True)
    assert exc.value.status_code == 422
    assert not (workspace / ".claude/settings.local.json").exists()
    assert not state.exists()


def test_strict_multiple_relative_and_inline_configs(tmp_path, monkeypatch):
    request, _, state, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(state, {"mcpServers": {"user": {"command": "user"}}, "claudeAiMcpEverConnected": ["claude.ai Docs"]})
    _write_json(workspace / ".mcp.json", {"project": {"command": "project"}})
    _write_json(tmp_path / "one.json", {"mcpServers": {"one": {"command": "one"}, "same": {"command": "old"}}})
    _write_json(tmp_path / "two.json", {"mcpServers": {"two": {"command": "two"}}})
    monkeypatch.setattr(config, "live_command", lambda _: ([
        "claude", "--strict-mcp-config", "--mcp-config", "one.json", "two.json",
        '--mcp-config={"mcpServers":{"same":{"command":"new"}}}',
    ], tmp_path))
    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    assert set(servers) == {("mcp_config", name) for name in ("one", "two", "same")}
    assert servers[("mcp_config", "same")]["command_redacted"] == "new"


def test_project_settings_without_live_process_and_approval_controls(tmp_path, monkeypatch):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {"superpowers@official": {}}})
    _write_json(home / "settings.json", {"enabledPlugins": {"superpowers@official": True}})
    _write_json(workspace / ".claude/settings.json", {
        "enabledPlugins": {"superpowers@official": False}, "enableAllProjectMcpServers": True,
        "disabledMcpjsonServers": ["blocked"], "enabledMcpjsonServers": None,
    })
    _write_json(workspace / ".mcp.json", {name: {"command": "server"} for name in ("auto", "blocked")})
    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    assert servers[("plugin", "superpowers@official")]["enabled"] is False
    assert servers[("mcp_json", "auto")]["enabled"] is True
    assert servers[("mcp_json", "blocked")]["enabled"] is False
    assert servers[("mcp_json", "blocked")]["toggleable"] is False
    _toggle(request, "mcp_json", "auto", False)
    assert _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("mcp_json", "auto")]["enabled"] is False
    with pytest.raises(router.HTTPException) as exc:
        _toggle(request, "mcp_json", "blocked", True)
    assert exc.value.status_code == 422


def test_live_command_uses_driver_socket_foreground_and_children(tmp_path, monkeypatch):
    proc = tmp_path / "proc"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    for pid, argv in ((10, ["bash", "-c", "claude --settings fake"]),
                      (20, ["wrapper"]), (21, ["claude", "--settings", "real.json"])):
        folder = proc / str(pid)
        folder.mkdir(parents=True)
        (folder / "cmdline").write_bytes("\0".join(argv).encode() + b"\0")
        (folder / "cwd").symlink_to(workspace, target_is_directory=True)
    monkeypatch.setattr(config, "_PROC_ROOT", proc)
    sessions = SimpleNamespace(get=lambda **kw: SimpleNamespace(active_pane=SimpleNamespace(pane_pid="10")))
    seen = []
    def server_for(name):
        seen.append(name)
        return SimpleNamespace(has_session=lambda name: True, sessions=sessions)
    monkeypatch.setattr(config.tmux_driver, "_server_for", server_for)
    monkeypatch.setattr(config.tmux_driver, "_pane_owner_pids", lambda pid: {10, 20})
    monkeypatch.setattr(config.tmux_driver, "_child_pids", lambda pid: {21} if pid == 20 else set())
    assert live_command("agent-socket") == (["claude", "--settings", "real.json"], workspace)
    assert seen == ["agent-socket"]
    (proc / "21/cmdline").unlink()
    assert live_command("agent-socket") is None


def test_plugin_installations_belong_to_target_workspace(tmp_path, monkeypatch):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {
        "shared@official": [
            {"scope": "project", "projectPath": "/another", "name": "foreign"},
            {"scope": "user", "name": "global"},
            {"scope": "project", "projectPath": str(workspace), "name": "target"},
        ],
        "foreign@official": [{"scope": "local", "projectPath": "/another"}],
    }})
    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    assert set(servers) == {("plugin", "shared@official")}
    assert servers[("plugin", "shared@official")]["name"] == "target"


def test_setting_sources_without_local_disables_ineffective_plugin_toggle(tmp_path, monkeypatch):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {"test@official": {}}})
    _write_json(home / "settings.json", {"enabledPlugins": {"test@official": False}})
    _write_json(workspace / ".claude/settings.local.json", {"enabledPlugins": {"test@official": True}})
    monkeypatch.setattr(config, "live_command", lambda _: (["claude", "--setting-sources=user"], workspace))
    entry = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("plugin", "test@official")]
    assert entry["enabled"] is False
    assert entry["toggleable"] is False
    with pytest.raises(router.HTTPException) as exc:
        _toggle(request, "plugin", "test@official", True)
    assert exc.value.status_code == 422
