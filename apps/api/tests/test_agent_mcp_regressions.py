"""Regressões da revisão MCP: isolamento, cwd/boot e controles direcionais."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest

from test_agent_mcp import _build_request, _run, _servers_by_key, _write_json
from test_agent_mcp_effective import _toggle
from routers import agents as router
from services import agent_mcp_config as config


def _process(proc, pid, argv, cwd):
    folder = proc / str(pid)
    folder.mkdir(parents=True)
    (folder / "cmdline").write_bytes("\0".join(argv).encode() + b"\0")
    (folder / "cwd").symlink_to(cwd, target_is_directory=True)


@pytest.mark.parametrize("flags", [["--setting-sources", ""], ["--setting-sources="]])
def test_empty_setting_sources_survives_proc_and_prevents_writes(tmp_path, monkeypatch, flags):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {"test@official": {}}})
    paths = [home / "settings.json", workspace / ".claude/settings.json", workspace / ".claude/settings.local.json"]
    for path in paths:
        _write_json(path, {"enabledPlugins": {"test@official": False}})
    before = {path: path.read_bytes() for path in paths}
    proc = tmp_path / "proc"
    _process(proc, 20, ["claude", *flags], workspace)
    monkeypatch.setattr(config, "_PROC_ROOT", proc)
    monkeypatch.setattr(config, "live_command", lambda _: config._read_process(20))
    assert config._read_process(20) == (["claude", *flags], workspace)
    effective = config.load_config(request.app.state.db.agent, home, router._read_json_file)
    assert effective.layers == []
    entry = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("plugin", "test@official")]
    assert entry["enabled"] is True
    assert entry["toggleable"] is False
    with pytest.raises(router.HTTPException) as exc:
        _toggle(request, "plugin", "test@official", False)
    assert exc.value.status_code == 422
    assert {path: path.read_bytes() for path in paths} == before


@pytest.mark.parametrize("source", ["live", "boot"])
def test_effective_cwd_controls_settings_plugins_mcp_and_project_writes(tmp_path, monkeypatch, source):
    request, home, state, workspace = _build_request(tmp_path, monkeypatch)
    cwd = tmp_path / "actual-cwd"
    plugin, local_plugin = "test@official", "local@official"
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {
        plugin: [{"scope": "project", "projectPath": str(workspace), "name": "wrong"},
                 {"scope": "project", "projectPath": str(cwd), "name": "right"}],
        local_plugin: {},
    }})
    _write_json(workspace / ".claude/settings.json", {"enabledPlugins": {plugin: True}})
    _write_json(workspace / ".claude/settings.local.json", {"enabledPlugins": {local_plugin: True}})
    _write_json(workspace / ".mcp.json", {"wrong": {"command": "wrong"}})
    _write_json(cwd / ".claude/settings.json", {"enabledPlugins": {plugin: False}})
    _write_json(cwd / ".claude/settings.local.json", {"enabledPlugins": {local_plugin: False}})
    _write_json(cwd / ".mcp.json", {"project-server": {"command": "right"}})
    original = {"projects": {
        str(workspace): {"disabledMcpServers": ["keep"]},
        str(cwd): {"mcpServers": {"local-server": {"command": "local"}},
                   "disabledMcpServers": ["local-server", "project-server"]},
    }, "unrelated": "keep"}
    _write_json(state, original)
    untouched = {path: path.read_bytes() for path in workspace.rglob("*.json")}
    if source == "live":
        # Mesmo um boot divergente não pode ganhar do processo vivo.
        _write_json(tmp_path / "agentes.json", {"agentes": [{"id": "daniel", "cwd": str(workspace), "flags": []}]})
        monkeypatch.setattr(config, "live_command", lambda _: (["claude"], cwd))
    else:
        _write_json(tmp_path / "agentes.json", {"agentes": [{"id": "daniel", "cwd": str(cwd), "flags": []}]})
    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    assert set(servers) == {("plugin", plugin), ("plugin", local_plugin),
                            ("mcp_json", "project-server"), ("local_scope", "local-server")}
    assert servers[("plugin", plugin)]["name"] == "right"
    assert servers[("plugin", plugin)]["origin"] == str(cwd / ".claude/settings.json")
    assert all(server["enabled"] is False for server in servers.values())
    for kind, name in (("plugin", plugin), ("mcp_json", "project-server"), ("local_scope", "local-server")):
        _toggle(request, kind, name, True)
        assert _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[(kind, name)]["enabled"] is True
    assert json.loads((cwd / ".claude/settings.local.json").read_text())["enabledPlugins"] == {
        plugin: True, local_plugin: False,
    }
    assert {path: path.read_bytes() for path in untouched} == untouched
    after = json.loads(state.read_text())
    assert after["projects"][str(workspace)] == original["projects"][str(workspace)]
    assert after["projects"][str(cwd)]["disabledMcpServers"] == []
    assert after["unrelated"] == "keep"


@pytest.mark.parametrize("match_field", ["id", "sessao"])
@pytest.mark.parametrize("relative", [False, True])
def test_stopped_agent_uses_boot_settings_and_mcp_flags(tmp_path, monkeypatch, match_field, relative):
    request, home, state, workspace = _build_request(tmp_path, monkeypatch)
    cwd = tmp_path / "boot-cwd"
    settings, mcp = cwd / "agent.settings.json", cwd / "agent.mcp.json"
    _write_json(settings, {"enabledPlugins": {"test@official": False}, "env": {"KEEP": "yes"}})
    _write_json(mcp, {"mcpServers": {"boot-server": {"command": "boot"}}})
    _write_json(home / "plugins/installed_plugins.json", {"plugins": {"test@official": {}}})
    flags = ["--setting-sources", "", "--settings", settings.name if relative else str(settings),
             "--mcp-config", mcp.name if relative else str(mcp)]
    boot = tmp_path / "custom" / "agentes.json"
    monkeypatch.setenv("COCKPIT_MAQUINA_AGENTES", str(boot))
    _write_json(boot, {"agentes": [
        {"id": "other", "cwd": str(workspace), "flags": []},
        {match_field: "daniel", "cwd": str(cwd), "flags": flags},
    ]})
    original_boot, original_mcp = boot.read_bytes(), mcp.read_bytes()
    servers = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))
    assert servers[("plugin", "test@official")]["enabled"] is False
    assert servers[("plugin", "test@official")]["origin"] == f"--settings {settings}"
    assert servers[("mcp_config", "boot-server")]["origin"] == f"--mcp-config {mcp}"
    _toggle(request, "plugin", "test@official", True)
    assert json.loads(settings.read_text()) == {"enabledPlugins": {"test@official": True}, "env": {"KEEP": "yes"}}
    assert _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("plugin", "test@official")]["enabled"] is True
    with pytest.raises(router.HTTPException) as exc:
        _toggle(request, "mcp_config", "boot-server", False)
    assert exc.value.status_code == 422
    assert not state.exists()
    _write_json(state, {"projects": {str(cwd): {"disabledMcpServers": ["boot-server"]}}})
    _toggle(request, "mcp_config", "boot-server", True)
    assert json.loads(state.read_text())["projects"] == {str(cwd): {"disabledMcpServers": []}}
    assert _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("mcp_config", "boot-server")]["enabled"] is True
    assert not (workspace / ".claude/settings.local.json").exists()
    assert not (home / "settings.json").exists()
    assert boot.read_bytes() == original_boot
    assert mcp.read_bytes() == original_mcp


def test_boot_file_default_path_and_missing_or_unknown_agent(tmp_path, monkeypatch):
    request, home, _, workspace = _build_request(tmp_path, monkeypatch)
    monkeypatch.delenv("COCKPIT_MAQUINA_AGENTES")
    monkeypatch.setenv("HOME", str(tmp_path))
    agent = request.app.state.db.agent
    assert config.load_config(agent, home, router._read_json_file).cwd == workspace
    boot = tmp_path / ".local/share/cockpit-maquina/agentes.json"
    _write_json(boot, {"agentes": [{"id": "other", "cwd": "/other", "flags": []}]})
    assert config.load_config(agent, home, router._read_json_file).cwd == workspace
    _write_json(boot, {"agentes": [{"sessao": "daniel", "cwd": str(tmp_path), "flags": []}]})
    assert config.load_config(agent, home, router._read_json_file).cwd == tmp_path


@pytest.mark.parametrize("strict", [False, True])
@pytest.mark.parametrize("kind", ["mcp_config", "user_scope", "local_scope", "mcp_json"])
def test_cli_mcp_can_only_remove_persistent_disable(tmp_path, monkeypatch, strict, kind):
    request, _, state, workspace = _build_request(tmp_path, monkeypatch)
    original = {"mcpServers": {"same": {"command": "user"}}, "projects": {str(workspace): {
        "disabledMcpServers": ["same", "keep"], "enabledMcpjsonServers": ["approved"],
        "disabledMcpjsonServers": ["denied"], "unrelated": "keep",
    }}}
    _write_json(state, original)
    _write_json(workspace / "cli.json", {"mcpServers": {"same": {"command": "cli"}}})
    argv = ["claude", "--mcp-config", "cli.json", *(["--strict-mcp-config"] if strict else [])]
    monkeypatch.setattr(config, "live_command", lambda _: (argv, workspace))
    entry = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("mcp_config", "same")]
    assert entry["enabled"] is False
    assert entry["toggleable"] == "enable_only"
    _toggle(request, kind, "same", True)
    expected = json.loads(json.dumps(original))
    expected["projects"][str(workspace)]["disabledMcpServers"] = ["keep"]
    assert json.loads(state.read_text()) == expected
    entry = _servers_by_key(_run(router.list_agent_mcp("daniel", request)))[("mcp_config", "same")]
    assert entry["enabled"] is True
    assert entry["toggleable"] == "enable_only"
    before = state.read_bytes()
    with pytest.raises(router.HTTPException) as exc:
        _toggle(request, kind, "same", False)
    assert exc.value.status_code == 422
    assert state.read_bytes() == before
    assert json.loads((workspace / "cli.json").read_text()) == {"mcpServers": {"same": {"command": "cli"}}}


@pytest.mark.parametrize("wrapped", [False, True])
def test_two_claudes_in_pane_prefer_foreground_tree(tmp_path, monkeypatch, wrapped):
    proc = tmp_path / "proc"
    _process(proc, 10, ["bash"], tmp_path)
    _process(proc, 11, ["claude", "--settings", "background.json"], tmp_path)
    _process(proc, 20, ["wrapper"] if wrapped else ["claude", "--settings", "foreground.json"], tmp_path)
    _process(proc, 21, ["claude", "--settings", "foreground.json"], tmp_path)
    monkeypatch.setattr(config, "_PROC_ROOT", proc)
    sessions = SimpleNamespace(get=lambda **_: SimpleNamespace(active_pane=SimpleNamespace(pane_pid="10")))
    monkeypatch.setattr(config.tmux_driver, "_server_for", lambda _: SimpleNamespace(has_session=lambda _: True, sessions=sessions))
    monkeypatch.setattr(config.tmux_driver, "_pane_owner_pids", lambda _: {10, 20})
    monkeypatch.setattr(config.tmux_driver, "_child_pids", lambda pid: {10: {11, 20}, 20: {21}}.get(pid, set()))
    assert config.live_command("daniel") == (["claude", "--settings", "foreground.json"], tmp_path)


@pytest.mark.parametrize("kind", ["remote", "mcp_json"])
def test_claude_json_lock_rereads_after_concurrent_writer(tmp_path, monkeypatch, kind):
    request, _, state, workspace = _build_request(tmp_path, monkeypatch)
    _write_json(state, {"projects": {str(workspace): {"keep": True}}, "unrelated": "keep"})
    state.chmod(0o640)
    first_read, release_first, second_started, second_read = (Event() for _ in range(4))
    read_json = router._read_json_file
    write_json = router._atomic_write_json
    reads = []

    def read(path, default):
        payload = read_json(path, default)
        if path == state:
            reads.append(payload)
            if len(reads) == 1:
                first_read.set()
                assert release_first.wait(5)
            else:
                second_read.set()
        return payload

    def write(path, payload):
        # O segundo escritor não pode ler o estado antes do primeiro replace.
        assert not second_read.is_set() if len(reads) == 1 else second_read.is_set()
        write_json(path, payload)

    def second():
        second_started.set()
        return _toggle(request, kind, "second", False)

    monkeypatch.setattr(router, "_read_json_file", read)
    monkeypatch.setattr(router, "_atomic_write_json", write)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(_toggle, request, kind, "first", False)
        try:
            assert first_read.wait(5)
            later = pool.submit(second)
            assert second_started.wait(5)
            assert not second_read.wait(0.1)
        finally:
            release_first.set()
        assert first.result(timeout=5).applied
        assert later.result(timeout=5).applied
    final = json.loads(state.read_text())
    project = final["projects"][str(workspace)]
    assert set(project["disabledMcpServers"]) == {"first", "second"}
    if kind == "mcp_json":
        assert set(project["disabledMcpjsonServers"]) == {"first", "second"}
    assert project["keep"] is True
    assert final["unrelated"] == "keep"
    assert state.stat().st_mode & 0o777 == 0o640
