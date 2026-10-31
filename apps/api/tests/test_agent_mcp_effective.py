"""Config efetiva por agente: settings, MCP CLI e escopos persistentes."""
from pathlib import Path
from types import SimpleNamespace
import json
import stat

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
        assert entry["toggleable"] == "enable_only"
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


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("relative", [False, True])
def test_plugin_toggle_respects_cli_settings_precedence(tmp_path, monkeypatch, enabled, relative):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {"context7@official": {}}})
    target = tmp_path / "agent.settings.json"
    original = {
        "enabledPlugins": {"context7@official": not enabled, "other": True},
        "env": {"KEEP": "value"}, "permissions": {"allow": ["Read"]},
    }
    _write_json(target, original)
    target.chmod(0o640)
    value = target.name if relative else str(target)
    monkeypatch.setattr(config, "live_command", lambda _: (["claude", f"--settings={value}"], tmp_path))
    before = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("plugin", "context7@official")]
    assert before["enabled"] is not enabled
    assert before.get("toggleable", True) is True
    assert before["origin"] == f"--settings {target}"
    response = _toggle(request, "plugin", "context7@official", enabled)
    assert response == router.McpToggleResponse(applied=True, requires_reload=True)
    assert json.loads(target.read_text()) == {**original, "enabledPlugins": {"context7@official": enabled, "other": True}}
    assert stat.S_IMODE(target.stat().st_mode) == 0o640
    assert not (workspace / ".claude/settings.local.json").exists()
    assert not (home / "settings.json").exists()
    assert _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("plugin", "context7@official")]["enabled"] is enabled


@pytest.mark.parametrize("scope", ["cli", "local", "project", "user", "new_user"])
def test_plugin_toggle_writes_only_explicit_or_local_settings(tmp_path, monkeypatch, scope):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    plugin_id = "context7@official"
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {plugin_id: {}}})
    paths = [
        home / "settings.json", workspace / ".claude/settings.json",
        workspace / ".claude/settings.local.json", home / "agentes/daniel.settings.json",
    ]
    target_index = {"cli": 3, "local": 2, "project": 1, "user": 0, "new_user": 0}[scope]
    existing = paths[target_index]
    target = existing if scope == "cli" else paths[2]
    for path in paths[:target_index]:
        _write_json(path, {"enabledPlugins": {plugin_id: True}})
    original = {"env": {"KEEP": "yes"}, "enabledPlugins": {"other": False}}
    if scope != "new_user":
        _write_json(existing, original)
        existing.chmod(0o644)
    if scope == "cli":
        monkeypatch.setattr(config, "live_command", lambda _: (["claude", "--settings", str(target)], workspace))
    untouched = {path: path.read_bytes() if path.exists() else None for path in paths if path != target}

    _toggle(request, "plugin", plugin_id, False)

    expected = original if target == existing and scope != "new_user" else {}
    assert json.loads(target.read_text()) == {
        **expected, "enabledPlugins": {**expected.get("enabledPlugins", {}), plugin_id: False},
    }
    if target == existing and scope != "new_user":
        assert stat.S_IMODE(target.stat().st_mode) == 0o644
    assert {path: path.read_bytes() if path.exists() else None for path in untouched} == untouched
    entry = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("plugin", plugin_id)]
    assert entry["enabled"] is False
    assert entry.get("toggleable", True) is True
    assert entry["origin"] == (f"--settings {target}" if scope == "cli" else str(target))


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


@pytest.mark.parametrize("has_plugin", [False, True])
def test_inline_settings_plugin_toggle_rejected_without_writes(tmp_path, monkeypatch, has_plugin):
    request, home, state, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {"context7@official": {}}})
    target = home / "settings.json"
    original = {"enabledPlugins": {"context7@official": False}, "env": {"KEEP": "yes"}}
    _write_json(target, original)
    before = target.read_bytes()
    inline = json.dumps({"enabledPlugins": {"context7@official": False}} if has_plugin else {"env": {"SESSION": "yes"}})
    monkeypatch.setattr(config, "live_command", lambda _: (["claude", "--settings", inline], workspace))
    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    assert servers[("plugin", "context7@official")]["toggleable"] is False
    assert inline not in json.dumps(servers[("plugin", "context7@official")])
    with pytest.raises(router.HTTPException) as exc:
        _toggle(request, "plugin", "context7@official", True)
    assert exc.value.status_code == 422
    assert exc.value.detail == "override de sessão não suporta toggle seguro"
    assert target.read_bytes() == before
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


@pytest.mark.parametrize("legacy", [False, True])
def test_plugin_installations_belong_to_target_workspace(tmp_path, monkeypatch, legacy):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {
        "shared@official": [
            {"scope": "project", "projectPath": "/another", "name": "foreign"},
            {"scope": "user", "name": "global"},
            {"scope": "project", "projectPath": str(workspace), "name": "target"},
        ],
        "foreign@official": {"scope": "local", "projectPath": "/another"} if legacy else [
            {"scope": "local", "projectPath": "/another"},
        ],
    }})
    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    assert set(servers) == {("plugin", "shared@official")}
    assert servers[("plugin", "shared@official")]["name"] == "target"


@pytest.mark.parametrize("sources", ["user", "project", "user,project"])
def test_setting_sources_without_local_rejects_plugin_writes(tmp_path, monkeypatch, sources):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {"test@official": {}}})
    paths = [home / "settings.json", workspace / ".claude/settings.json", workspace / ".claude/settings.local.json"]
    for path in paths:
        _write_json(path, {"enabledPlugins": {"test@official": path == paths[-1]}})
    before = {path: path.read_bytes() for path in paths}
    monkeypatch.setattr(config, "live_command", lambda _: (["claude", f"--setting-sources={sources}"], workspace))
    entry = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("plugin", "test@official")]
    assert entry["enabled"] is False
    assert entry["toggleable"] is False
    with pytest.raises(router.HTTPException) as exc:
        _toggle(request, "plugin", "test@official", True)
    assert exc.value.status_code == 422
    assert {path: path.read_bytes() for path in paths} == before
