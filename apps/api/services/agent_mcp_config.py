"""Fontes de configuração do Claude vivo, sem executar CLI nem expor seu argv.

Contrato: https://code.claude.com/docs/en/settings#settings-precedence e
https://code.claude.com/docs/en/mcp#scope-hierarchy-and-precedence.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
import json

from libtmux import exc as libtmux_exc

from services import tmux_driver

_PROC_ROOT = Path("/proc")


@dataclass
class McpConfig:
    layers: list[tuple[str, dict[str, Any], Path | None]] = field(default_factory=list)
    servers: dict[str, tuple[dict[str, Any], str]] = field(default_factory=dict)
    strict: bool = False
    local_settings: bool = True

    def plugin_state(self, plugin_id: str) -> tuple[bool, str | None, bool]:
        enabled, origin, toggleable = True, None, self.local_settings
        for source, settings, path in self.layers:
            plugins = settings.get("enabledPlugins")
            if isinstance(plugins, dict) and plugin_id in plugins:
                enabled = plugins[plugin_id] is not False
                origin = source
                toggleable = path is not None if source.startswith("--settings") else self.local_settings
        return enabled, origin, toggleable

    def plugin_target(self, plugin_id: str, workspace: Path) -> Path | None:
        # Um override --settings ganha de settings.local.json. Só escrevemos
        # nele quando é arquivo; JSON inline não tem destino persistente.
        for source, settings, path in reversed(self.layers):
            plugins = settings.get("enabledPlugins")
            if source.startswith("--settings") and isinstance(plugins, dict) and plugin_id in plugins:
                return path
        return workspace / ".claude" / "settings.local.json" if self.local_settings else None

    def names(self, key: str) -> set[str]:
        return {
            item for _, settings, _ in self.layers
            for item in (settings.get(key) if isinstance(settings.get(key), list) else [])
            if isinstance(item, str)
        }


def _read_process(pid: int) -> tuple[list[str], Path] | None:
    try:
        argv = (_PROC_ROOT / str(pid) / "cmdline").read_bytes().decode(errors="replace").split("\0")
        # Não confundir um shell cujo script menciona claude com o CLI vivo.
        executable = Path(argv[0]).name
        is_claude = executable == "claude" or executable.startswith("claude-")
        if executable in {"node", "bun"} and len(argv) > 1:
            is_claude = "claude" in argv[1] and argv[1].endswith((".js", ".mjs"))
        if not is_claude:
            return None
        return [arg for arg in argv if arg], (_PROC_ROOT / str(pid) / "cwd").resolve(strict=True)
    except (OSError, ValueError):
        return None


def live_command(session_name: str) -> tuple[list[str], Path] | None:
    """Mesmo socket/pane/foreground do driver; descendentes cobrem wrappers."""
    try:
        server = tmux_driver._server_for(session_name)
        if not server.has_session(session_name):
            return None
        pane = server.sessions.get(session_name=session_name).active_pane
        pane_pid = int(pane.pane_pid)
        pending = sorted(tmux_driver._pane_owner_pids(pane_pid), key=lambda pid: pid == pane_pid)
        seen: set[int] = set()
        while pending and len(seen) < tmux_driver._PANE_DESCENDANT_MAX:
            pid = pending.pop(0)
            if pid in seen:
                continue
            seen.add(pid)
            command = _read_process(pid)
            if command is not None:
                return command
            pending.extend(sorted(tmux_driver._child_pids(pid) - seen))
    except (libtmux_exc.LibTmuxException, OSError, ValueError, TypeError, AttributeError):
        pass
    return None


def _flag_values(argv: list[str], flag: str, *, multiple: bool = False) -> list[str]:
    values: list[str] = []
    index = 1
    while index < len(argv):
        arg = argv[index]
        if arg == "--":
            break
        if arg.startswith(flag + "="):
            values.append(arg.split("=", 1)[1])
        elif arg == flag:
            index += 1
            while index < len(argv) and not argv[index].startswith("-"):
                values.append(argv[index])
                index += 1
                if not multiple:
                    break
            continue
        index += 1
    return values


def load_config(
    agent: dict[str, Any], claude_home: Path,
    read_json: Callable[[Path, Any], Any],
) -> McpConfig:
    command = live_command(agent["tmux_session"])
    workspace = Path(agent["workspace_path"])
    argv, cwd = command if command else ([], workspace)
    config = McpConfig(strict="--strict-mcp-config" in argv)
    sources = _flag_values(argv, "--setting-sources")
    allowed = set(sources[-1].split(",")) if sources else {"user", "project", "local"}
    config.local_settings = "local" in allowed
    for scope, path in (
        ("user", claude_home / "settings.json"),
        ("project", workspace / ".claude" / "settings.json"),
        ("local", workspace / ".claude" / "settings.local.json"),
    ):
        if scope in allowed:
            settings = read_json(path, {})
            config.layers.append((str(path), settings if isinstance(settings, dict) else {}, path))

    def read_argument(value: str, flag: str) -> tuple[str, dict[str, Any], Path | None]:
        if value.lstrip().startswith("{"):
            try:
                payload = json.loads(value)
            except json.JSONDecodeError:
                payload = {}
            return f"{flag} (inline)", payload, None
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = cwd / path
        payload = read_json(path, {})
        return f"{flag} {path}", payload if isinstance(payload, dict) else {}, path

    for value in _flag_values(argv, "--settings"):
        config.layers.append(read_argument(value, "--settings"))
    for value in _flag_values(argv, "--mcp-config", multiple=True):
        source, payload, _ = read_argument(value, "--mcp-config")
        definitions = payload.get("mcpServers", {})
        if isinstance(definitions, dict):
            for name, definition in definitions.items():
                if isinstance(definition, dict):
                    config.servers[name] = definition, source
    return config
