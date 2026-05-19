"""
GET  /api/agents                       — lista 6 agentes da frota com state agregado
GET  /api/agents/{slug}                — detalhe + state de um agente
GET  /api/agents/{slug}/sparkline      — eventos por hora (mini-chart de atividade)
GET  /api/agents/{slug}/skills         — skills do workspace (.claude/skills/*/SKILL.md)
GET  /api/agents/{slug}/docs           — docs do workspace (lista + resolved com @include)
GET  /api/agents/{slug}/tables         — tabelas do domínio do agente (de agents.yaml)
GET  /api/agents/{slug}/pane/stream    — DS-2: SSE com excerpt do pane (poll 1 Hz, dedupe sha1)
POST /api/agents/{slug}/input          — DS-2: envia texto pro pane via paste-buffer
POST /api/agents/{slug}/voice          — DS-54: upload áudio → STT (gpt-4o-transcribe) → send-keys
POST /api/agents/{slug}/image          — DS-54: upload imagem → path absoluto → send-keys
POST /api/agents/{slug}/model          — DS-2: troca modelo via /model <slug> + confirma na statusline
POST /api/agents/{slug}/subagents/spawn — LB-9: tool MCP spawn_subsession via HTTP
GET  /api/agents/{slug}/subagents      — LB-9: snapshot de subsessões ativas (polling REST 5s)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import sqlite3
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Literal

from fastapi import APIRouter, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from libtmux import exc as libtmux_exc
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse, ServerSentEvent

from db.store import GrupoBorgesDB, build_hour_series, hour_window
from mcp_tools.spawn_subsession import (
    SkillNotFoundError,
    SpawnSubsessionInput,
    TooManySubsessionsError,
    spawn_subsession,
)
from orchestrator.jsonl_watcher import (
    mark_stalled_subagents,
    subagent_active_snapshot,
    subagent_status_events_since,
)
from services import tmux_driver
from services import workspace_reader

router = APIRouter()
log = logging.getLogger(__name__)

_CLAUDE_HOME = Path.home() / ".claude"
_CLAUDE_JSON = Path.home() / ".claude.json"
_SECRET_KEY_RE = re.compile(r"token|secret|password|authorization", re.IGNORECASE)
_PLUGIN_INSTALL_PATH_KEYS = ("installPath", "install_path", "path", "dir")
_PLUGIN_ID_KEYS = ("id", "pluginId", "plugin_id")
_CLAUDE_AI_PREFIX = "claude.ai "
_PLUGIN_DISABLED_PREFIX = "plugin:"

@router.get("")
async def list_agents(request: Request):
    db: GrupoBorgesDB = request.app.state.db
    return await db.list_agents()


@router.get("/{slug}")
async def get_agent(slug: str, request: Request):
    db: GrupoBorgesDB = request.app.state.db
    agent = await db.get_agent(slug)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return agent


@router.get("/{slug}/sparkline")
async def get_agent_sparkline(
    slug: str,
    request: Request,
    hours: int = Query(default=24, ge=1, le=168),
) -> list[dict[str, Any]]:
    """Série horária de `task_events` do agente.

    Retorna `hours` buckets cobrindo `[hora_corrente_UTC - (hours-1), hora_corrente_UTC]`,
    inclusive — ou seja, a hora atual + (hours-1) anteriores. Horas sem evento entram
    com `count=0` pra UI consumir série contínua sem gap-fill no cliente.
    """
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")

    start_dt, _ = hour_window(hours)
    since_unix = int(start_dt.timestamp())
    counts = await db.event_counts_per_hour(slug, since_unix=since_unix)
    tokens = await db.event_tokens_per_hour(slug, since_unix=since_unix)
    return build_hour_series(counts, start_dt, hours, token_sums=tokens)


# ----- Fase 3: skills / docs / tables (alimenta o AgentModal) ---------------

@router.get("/{slug}/skills")
async def list_agent_skills(slug: str, request: Request) -> dict[str, Any]:
    """Skills disponíveis no workspace (parse de `.claude/skills/*/SKILL.md`).

    Detecta symlinks pra skills compartilhadas (`ze-shared/.claude/skills/`).
    """
    agent = await _get_agent_or_404(request, slug)
    skills = await asyncio.to_thread(workspace_reader.read_skills_cached, agent["workspace_path"])
    return {"slug": slug, "skills": skills, "count": len(skills)}


@router.get("/{slug}/docs")
async def list_agent_docs(
    slug: str,
    request: Request,
    filename: str | None = Query(default=None, description="Quando preenchido, devolve o conteúdo do doc"),
    resolve: bool = Query(default=False, description="Se true, expande @include inline (default: false — conteúdo cru)"),
) -> dict[str, Any]:
    """Docs do workspace (CLAUDE/SOUL/IDENTITY/AGENTS/TOOLS/OPS).

    Sem `filename`: lista os docs existentes (metadados leves).
    Com `filename`: devolve `content_md` cru (default) ou com `@include`
    expandido inline quando `resolve=true` (cap profundidade 5, cap 256KB).
    """
    agent = await _get_agent_or_404(request, slug)
    if filename:
        resolved = await asyncio.to_thread(
            workspace_reader.read_doc_resolved,
            agent["workspace_path"],
            filename,
            resolve=resolve,
        )
        if resolved is None:
            raise HTTPException(status_code=404, detail=f"Doc {filename} não encontrado em {slug}")
        return {"slug": slug, **resolved}

    docs = await asyncio.to_thread(workspace_reader.read_docs_cached, agent["workspace_path"])
    return {"slug": slug, "docs": docs, "count": len(docs)}


@router.get("/{slug}/tables")
async def list_agent_tables(slug: str, request: Request) -> dict[str, Any]:
    """Tabelas do domínio do agente — fonte de verdade: `agents.yaml`.

    Cada item: `{ name, db, description }`. Lista vazia é resposta válida
    (agente sem domínio de dados próprio).
    """
    await _get_agent_or_404(request, slug)
    config = request.app.state.agents_config
    tables: list[dict[str, Any]] = []
    for entry in config.get("agents", []):
        if entry.get("slug") == slug:
            tables = list(entry.get("domain_tables") or [])
            break
    return {"slug": slug, "tables": tables, "count": len(tables)}


async def _get_agent_or_404(request: Request, slug: str) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    agent = await db.get_agent(slug)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return agent


# ----- JP-25: MCP inventory / toggles --------------------------------------


class McpToggleRequest(BaseModel):
    enabled: bool


class McpToggleResponse(BaseModel):
    applied: bool
    requires_reload: bool


class McpReloadResponse(BaseModel):
    tmux_delivered: bool


def _read_json_file(path: Path, default: Any) -> Any:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"JSON inválido em {path}") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"erro lendo {path}: {exc}") from exc


def _atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
        text=True,
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_path, path)
    except OSError as exc:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"erro escrevendo {path}: {exc}") from exc


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if isinstance(item, str)]
    return []


def _mcp_server_defs(payload: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(payload, dict):
        return {}
    wrapped = payload.get("mcpServers")
    if isinstance(wrapped, dict):
        source = wrapped
    else:
        source = payload
    return {
        str(name): definition
        for name, definition in source.items()
        if isinstance(name, str) and isinstance(definition, dict)
    }


def _redact_args(args: Any) -> list[str]:
    if not isinstance(args, list):
        return []
    redacted: list[str] = []
    redact_next = False
    for raw in args:
        arg = str(raw)
        if redact_next:
            redacted.append("<redacted>")
            redact_next = False
            continue
        key = arg.split("=", 1)[0]
        if _SECRET_KEY_RE.search(key):
            if "=" in arg:
                redacted.append(f"{key}=<redacted>")
            else:
                redacted.append(arg)
                redact_next = True
            continue
        if _SECRET_KEY_RE.search(arg):
            redacted.append("<redacted>")
        else:
            redacted.append(arg)
    return redacted


def _redacted_command(definition: dict[str, Any]) -> str | None:
    command = definition.get("command")
    if not isinstance(command, str) or not command:
        return None
    parts = [command, *_redact_args(definition.get("args"))]
    return " ".join(parts)


def _transport(definition: dict[str, Any]) -> str:
    transport = definition.get("transport") or definition.get("type")
    if isinstance(transport, str) and transport:
        return transport
    if definition.get("command"):
        return "stdio"
    if definition.get("url"):
        return "http"
    return "unknown"


def _mcp_entry(kind: str, id_: str, name: str, enabled: bool, definition: dict[str, Any]) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "kind": kind,
        "id": id_,
        "name": name,
        "enabled": enabled,
        "transport": _transport(definition),
    }
    description = definition.get("description")
    if isinstance(description, str) and description:
        entry["description"] = description
    command_redacted = _redacted_command(definition)
    if command_redacted:
        entry["command_redacted"] = command_redacted
    return entry


def _project_state(claude_json: Any, workspace: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(claude_json, dict):
        claude_json = {}
    projects = claude_json.get("projects")
    if not isinstance(projects, dict):
        projects = {}
    project = projects.get(workspace)
    if not isinstance(project, dict):
        project = {}
    return projects, project


def _plugin_id(key: str | None, entry: Any) -> str | None:
    if isinstance(entry, dict):
        for field in _PLUGIN_ID_KEYS:
            value = entry.get(field)
            if isinstance(value, str) and value:
                return value
        name = entry.get("name")
        source = entry.get("source") or entry.get("registry")
        if isinstance(name, str) and isinstance(source, str) and name and source:
            return f"{name}@{source}"
    if key and "@" in key:
        return key
    return key


def _plugin_install_path(entry: Any) -> Path | None:
    if not isinstance(entry, dict):
        return None
    for field in _PLUGIN_INSTALL_PATH_KEYS:
        value = entry.get(field)
        if isinstance(value, str) and value:
            return Path(value).expanduser()
    return None


def _iter_installed_plugins(raw: Any) -> list[tuple[str, Path | None, dict[str, Any]]]:
    if isinstance(raw, dict) and "plugins" in raw:
        raw = raw["plugins"]

    items: list[tuple[str | None, Any]]
    if isinstance(raw, list):
        items = [(None, item) for item in raw]
    elif isinstance(raw, dict):
        items = list(raw.items())
    else:
        return []

    plugins: list[tuple[str, Path | None, dict[str, Any]]] = []
    for key, entry in items:
        metadata = entry if isinstance(entry, dict) else {}
        plugin_id = _plugin_id(str(key) if key else None, metadata)
        if not plugin_id:
            continue
        plugins.append((plugin_id, _plugin_install_path(metadata), metadata))
    return plugins


def _plugin_mcp_entry(plugin_id: str, install_path: Path | None, enabled: bool, metadata: dict[str, Any]) -> dict[str, Any] | None:
    if install_path is None:
        return _mcp_entry("plugin", plugin_id, metadata.get("name") or plugin_id.split("@", 1)[0], enabled, {})

    definitions = _mcp_server_defs(_read_json_file(install_path / ".mcp.json", {}))
    if not definitions:
        return None
    name, definition = next(iter(definitions.items()))
    return _mcp_entry("plugin", plugin_id, name, enabled, definition)


@router.get("/{slug}/mcp")
async def list_agent_mcp(slug: str, request: Request) -> dict[str, Any]:
    agent = await _get_agent_or_404(request, slug)
    workspace = Path(agent["workspace_path"])

    settings = _read_json_file(_CLAUDE_HOME / "settings.json", {})
    enabled_plugins = settings.get("enabledPlugins") if isinstance(settings, dict) else {}
    if not isinstance(enabled_plugins, dict):
        enabled_plugins = {}

    installed = _read_json_file(_CLAUDE_HOME / "plugins" / "installed_plugins.json", {})
    servers: list[dict[str, Any]] = []
    known_ids: set[str] = set()
    for plugin_id, install_path, metadata in _iter_installed_plugins(installed):
        enabled = enabled_plugins.get(plugin_id, True) is not False
        entry = _plugin_mcp_entry(plugin_id, install_path, enabled, metadata)
        if entry is not None:
            servers.append(entry)
            known_ids.add(plugin_id)
            known_ids.add(entry["name"])

    claude_json = _read_json_file(_CLAUDE_JSON, {})
    _, project = _project_state(claude_json, str(workspace))
    enabled_mcp = set(_as_list(project.get("enabledMcpjsonServers")))
    disabled_mcp = set(_as_list(project.get("disabledMcpjsonServers")))
    disabled_workspace_mcp = set(_as_list(project.get("disabledMcpServers")))

    for server_id, definition in _mcp_server_defs(_read_json_file(workspace / ".mcp.json", {})).items():
        enabled = server_id in enabled_mcp and server_id not in disabled_mcp
        servers.append(_mcp_entry("mcp_json", server_id, server_id, enabled, definition))
        known_ids.add(server_id)

    remote_ids = set(_as_list(claude_json.get("claudeAiMcpEverConnected") if isinstance(claude_json, dict) else None))
    remote_ids.update(item for item in disabled_workspace_mcp if item.startswith(_CLAUDE_AI_PREFIX))
    for server_id in sorted(remote_ids):
        enabled = server_id not in disabled_workspace_mcp
        servers.append(_mcp_entry("remote", server_id, server_id, enabled, {"transport": "remote"}))
        known_ids.add(server_id)

    for server_id in sorted(disabled_workspace_mcp):
        if server_id.startswith(_CLAUDE_AI_PREFIX) or server_id.startswith(_PLUGIN_DISABLED_PREFIX):
            continue
        if server_id in known_ids:
            continue
        servers.append(_mcp_entry("user_scope", server_id, server_id, False, {}))
        known_ids.add(server_id)

    return {"servers": servers}


@router.patch("/{slug}/mcp/{kind}/{id}", response_model=McpToggleResponse)
async def patch_agent_mcp(
    slug: str,
    kind: Literal["plugin", "mcp_json", "remote", "user_scope"],
    id: str,
    payload: McpToggleRequest,
    request: Request,
) -> McpToggleResponse:
    agent = await _get_agent_or_404(request, slug)

    if kind == "plugin":
        settings_path = _CLAUDE_HOME / "settings.json"
        settings = _read_json_file(settings_path, {})
        if not isinstance(settings, dict):
            settings = {}
        enabled_plugins = settings.get("enabledPlugins")
        if not isinstance(enabled_plugins, dict):
            enabled_plugins = {}
        enabled_plugins[id] = payload.enabled
        settings["enabledPlugins"] = enabled_plugins
        _atomic_write_json(settings_path, settings)
        return McpToggleResponse(applied=True, requires_reload=True)

    workspace = str(Path(agent["workspace_path"]))
    claude_json = _read_json_file(_CLAUDE_JSON, {})
    if not isinstance(claude_json, dict):
        claude_json = {}
    projects, project = _project_state(claude_json, workspace)

    if kind in {"remote", "user_scope"}:
        disabled_servers = _as_list(project.get("disabledMcpServers"))
        if payload.enabled:
            disabled_servers = [item for item in disabled_servers if item != id]
        elif id not in disabled_servers:
            disabled_servers.append(id)
        project["disabledMcpServers"] = disabled_servers
        projects[workspace] = project
        claude_json["projects"] = projects
        _atomic_write_json(_CLAUDE_JSON, claude_json)
        return McpToggleResponse(applied=True, requires_reload=True)

    enabled = _as_list(project.get("enabledMcpjsonServers"))
    disabled = _as_list(project.get("disabledMcpjsonServers"))
    if payload.enabled:
        if id not in enabled:
            enabled.append(id)
        disabled = [item for item in disabled if item != id]
    else:
        if id not in disabled:
            disabled.append(id)
        enabled = [item for item in enabled if item != id]

    project["enabledMcpjsonServers"] = enabled
    project["disabledMcpjsonServers"] = disabled
    projects[workspace] = project
    claude_json["projects"] = projects
    _atomic_write_json(_CLAUDE_JSON, claude_json)
    return McpToggleResponse(applied=True, requires_reload=True)


@router.post("/{slug}/mcp/reload", response_model=McpReloadResponse)
async def reload_agent_mcp(slug: str, request: Request) -> McpReloadResponse:
    agent = await _get_agent_or_404(request, slug)
    delivered = await tmux_driver.send_message(agent["tmux_session"], "/reload-plugins")
    return McpReloadResponse(tmux_delivered=delivered)


# ----- Chat / Pane endpoints (DS-2) ---------------------------------------
# Stubs. Tipos + roteamento + gates determinísticos prontos; lógica real entra
# em passo 2 (send_message, capture_pane loop, upsert_agent_state, task_event).

ChatModel = Literal["opus", "sonnet", "haiku"]


class PaneStreamEvent(BaseModel):
    excerpt: str
    captured_at: int
    executor_kind: str


class InputRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8192)
    idempotency_key: str = Field(min_length=1, max_length=128)


class InputResponse(BaseModel):
    tmux_delivered: bool
    sent_at: int


class ModelChangeRequest(BaseModel):
    model: ChatModel
    force: bool = False


class ModelChangeResponse(BaseModel):
    tmux_delivered: bool
    state_persisted: bool
    confirmed: bool
    model: str


_PANE_STREAM_POLL_S = 1.0
_PANE_STREAM_DISCONNECT_CHECK_S = 0.1
_MESSAGES_STREAM_LIMIT_DEFAULT = 200
_MESSAGES_STREAM_LIMIT_MAX = 500
_MESSAGES_STREAM_POLL_S = 0.25
_MESSAGES_STREAM_HEARTBEAT_S = 15.0
_MESSAGES_STREAM_SUBAGENT_STALL_SCAN_S = 10.0
_MESSAGES_STREAM_REPLAY_HEARTBEAT_EVERY = 50
# 200 linhas (era 80) cobre respostas longas sem cortar o topo. Configurável
# via env pro ops afinar sob carga sem deploy. `_PANE_STREAM_MAX_CHARS` foi a
# 20k acomodando linhas mais longas + escape sequences ANSI preservadas no
# stream (bandwidth real precisa ser medido em prod — backlog Fase 2).
_PANE_STREAM_LINE_LIMIT = int(os.getenv("COCKPIT_PANE_LINE_LIMIT", "200"))
_PANE_STREAM_MAX_CHARS = int(os.getenv("COCKPIT_PANE_MAX_CHARS", "20000"))


@router.get("/{slug}/pane/stream")
async def stream_agent_pane(slug: str, request: Request) -> EventSourceResponse:
    """SSE com excerpt do pane em tempo real (poll 1 Hz, dedupe por hash).

    - 404 quando agente não existe (antes de abrir o stream)
    - Loop: `capture_pane_excerpt(line_limit=_PANE_STREAM_LINE_LIMIT,
      max_chars=_PANE_STREAM_MAX_CHARS, preserve_ansi=True)` a cada 1s;
      defaults 200/20000, overrideable via env `COCKPIT_PANE_LINE_LIMIT` /
      `COCKPIT_PANE_MAX_CHARS`. Emite `event: pane` com `{excerpt,
      captured_at, executor_kind}` só quando hash sha1 do excerpt muda.
    - `preserve_ansi=True` mantém escape sequences pro front renderizar
      cores via `lib/pane-chrome.ts:parseAnsi`.
    - Encerra ao detectar `request.is_disconnected()` no início de cada tick.
    """
    agent = await _get_agent_or_404(request, slug)
    session = agent["tmux_session"]
    executor_kind = agent.get("executor_kind") or "claude_code"

    async def _pane_stream() -> AsyncGenerator[dict, None]:
        last_hash: str | None = None
        elapsed = _PANE_STREAM_POLL_S  # força captura no primeiro tick
        while True:
            if await request.is_disconnected():
                return
            if elapsed >= _PANE_STREAM_POLL_S:
                excerpt = (
                    await tmux_driver.capture_pane_excerpt(
                        session,
                        line_limit=_PANE_STREAM_LINE_LIMIT,
                        max_chars=_PANE_STREAM_MAX_CHARS,
                        preserve_ansi=True,
                    )
                    or ""
                )
                current_hash = hashlib.sha1(excerpt.encode("utf-8")).hexdigest()
                if current_hash != last_hash:
                    yield {
                        "event": "pane",
                        "data": json.dumps(
                            {
                                "excerpt": excerpt,
                                "captured_at": int(time.time()),
                                "executor_kind": executor_kind,
                            }
                        ),
                    }
                    last_hash = current_hash
                elapsed = 0.0
            # Sleep cooperativo: checa disconnect a cada 100ms pra teardown
            # rápido em TestClient e cliente real. asyncio.sleep(1s) cego
            # pendura a stream porque sse-starlette não cancela em close.
            await asyncio.sleep(_PANE_STREAM_DISCONNECT_CHECK_S)
            elapsed += _PANE_STREAM_DISCONNECT_CHECK_S

    return EventSourceResponse(_pane_stream())


def _canonical_jsonl_message_event(event: dict[str, Any]) -> dict[str, Any] | None:
    payload = event.get("payload")
    if not isinstance(payload, dict):
        return None
    uuid_value = payload.get("uuid")
    if not uuid_value:
        return None
    kind = payload.get("type")
    if not isinstance(kind, str) or not kind:
        raw_kind = event.get("kind")
        kind = raw_kind.removeprefix("jsonl:") if isinstance(raw_kind, str) else "unknown"
    return {
        "id": event["id"],
        "kind": kind,
        "uuid": uuid_value,
        "parent_uuid": payload.get("parentUuid"),
        "session_id": payload.get("sessionId"),
        "is_sidechain": bool(payload.get("isSidechain", False)),
        "user_type": payload.get("userType"),
        "timestamp": payload.get("timestamp"),
        "created_at": event["created_at"],
        "message": payload.get("message"),
        "agent_id": payload.get("agentId"),
        "tool_use_result": payload.get("toolUseResult"),
    }


def _sse_json(event: str, data: dict[str, Any]) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


def _subagent_sse(data: dict[str, Any]) -> ServerSentEvent:
    return ServerSentEvent(
        event="subagent_status",
        data=json.dumps(data, ensure_ascii=False),
    )


def _public_subagent_status(event: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in event.items() if key != "seq"}


@router.get("/{slug}/messages/stream")
async def stream_agent_messages(
    slug: str,
    request: Request,
    session_id: str | None = Query(default=None, alias="sessionId"),
    limit: int = Query(default=_MESSAGES_STREAM_LIMIT_DEFAULT, ge=1),
    since_id: int = Query(default=0, ge=0),
) -> EventSourceResponse:
    """SSE canônico dos eventos JSONL de conversa de um agente.

    Protocolo: `replay-start` → N `message` → `replay-end` → live polling
    com `heartbeat` a cada 15s. O cursor público é `task_events.id`.
    """
    db: GrupoBorgesDB = request.app.state.db
    await _get_agent_or_404(request, slug)

    capped_limit = min(limit, _MESSAGES_STREAM_LIMIT_MAX)
    resolved_session_id = session_id or await db.latest_jsonl_session_id(slug)

    async def _message_stream() -> AsyncGenerator[dict[str, str] | ServerSentEvent, None]:
        started_at = time.perf_counter()
        last_id = since_id
        last_heartbeat = time.monotonic()
        last_subagent_seq = 0
        last_stall_scan = time.monotonic()

        try:
            try:
                replay_events = await db.list_jsonl_message_events(
                    slug,
                    session_id=resolved_session_id,
                    since_id=since_id,
                    limit=capped_limit,
                )
            except sqlite3.OperationalError as e:
                log.warning("Erro SQLite recuperável no replay de %s: %s", slug, e)
                replay_events = []
                yield _sse_json(
                    "error",
                    {"code": "sqlite_operational_error", "detail": str(e)},
                )

            yield _sse_json(
                "replay-start",
                {"session_id": resolved_session_id, "total": len(replay_events)},
            )
            for index, event in enumerate(replay_events, start=1):
                if await request.is_disconnected():
                    return
                last_id = max(last_id, int(event["id"]))
                canonical = _canonical_jsonl_message_event(event)
                if canonical is not None:
                    yield _sse_json("message", canonical)
                if index % _MESSAGES_STREAM_REPLAY_HEARTBEAT_EVERY == 0:
                    now = time.monotonic()
                    if now - last_heartbeat >= _MESSAGES_STREAM_HEARTBEAT_S:
                        yield _sse_json("heartbeat", {"ts": int(time.time())})
                        last_heartbeat = now
            yield _sse_json(
                "replay-end",
                {
                    "last_id": last_id,
                    "elapsed_ms": int((time.perf_counter() - started_at) * 1000),
                },
            )
            initial_status_events, last_subagent_seq = subagent_status_events_since(
                slug,
                last_subagent_seq,
            )
            active_status_seen = set()
            for status_event in initial_status_events:
                public_event = _public_subagent_status(status_event)
                if public_event.get("status") == "active":
                    active_status_seen.add(public_event.get("parent_uuid"))
                yield _subagent_sse(public_event)
            for status_event in subagent_active_snapshot(slug):
                if status_event["parent_uuid"] not in active_status_seen:
                    yield _subagent_sse(status_event)

            while True:
                if await request.is_disconnected():
                    return

                try:
                    live_events = await db.list_jsonl_message_events(
                        slug,
                        session_id=resolved_session_id,
                        since_id=last_id,
                        limit=_MESSAGES_STREAM_LIMIT_MAX,
                    )
                except sqlite3.OperationalError as e:
                    log.warning("Erro SQLite recuperável no live stream de %s: %s", slug, e)
                    yield _sse_json(
                        "error",
                        {"code": "sqlite_operational_error", "detail": str(e)},
                    )
                    await asyncio.sleep(_MESSAGES_STREAM_POLL_S)
                    continue

                for event in live_events:
                    if await request.is_disconnected():
                        return
                    last_id = max(last_id, int(event["id"]))
                    canonical = _canonical_jsonl_message_event(event)
                    if canonical is not None:
                        yield _sse_json("message", canonical)

                now = time.monotonic()
                status_events, last_subagent_seq = subagent_status_events_since(
                    slug,
                    last_subagent_seq,
                )
                for status_event in status_events:
                    yield _subagent_sse(_public_subagent_status(status_event))

                if now - last_stall_scan >= _MESSAGES_STREAM_SUBAGENT_STALL_SCAN_S:
                    for status_event in mark_stalled_subagents(slug):
                        yield _subagent_sse(status_event)
                    _, last_subagent_seq = subagent_status_events_since(
                        slug,
                        last_subagent_seq,
                    )
                    last_stall_scan = now

                if now - last_heartbeat >= _MESSAGES_STREAM_HEARTBEAT_S:
                    yield _sse_json("heartbeat", {"ts": int(time.time())})
                    last_heartbeat = now

                await asyncio.sleep(_MESSAGES_STREAM_POLL_S)
        except asyncio.CancelledError:
            raise
        finally:
            log.debug("messages stream encerrado para agent=%s session_id=%s", slug, resolved_session_id)

    return EventSourceResponse(
        _message_stream(),
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{slug}/input", response_model=InputResponse)
async def send_agent_input(
    slug: str, payload: InputRequest, request: Request
) -> InputResponse:
    """Cola `payload.text` no pane ativo via tmux paste-buffer + Enter.

    - 404 quando agente não existe
    - 422 (Pydantic) em text vazio/>8KB ou idempotency_key vazio/>128
    - 409 `agent_pane_unavailable` quando send_message=False (pane fora do
      CLI esperado — guard do tmux_driver, ex: user trocou window)
    - 200 + `tmux_delivered=True` no caminho feliz
    """
    agent = await _get_agent_or_404(request, slug)
    delivered = await tmux_driver.send_message(agent["tmux_session"], payload.text)
    if not delivered:
        raise HTTPException(status_code=409, detail="agent_pane_unavailable")
    return InputResponse(tmux_delivered=True, sent_at=int(time.time()))


_VOICE_ALLOWED_MIMES = {"audio/ogg", "audio/webm", "audio/mp4", "audio/mpeg"}
_VOICE_MAX_BYTES = 10 * 1024 * 1024  # 10MB
_VOICE_STT_SCRIPT = "/home/clawd/repos/ze_claude/ze-shared/.claude/skills/voz/scripts/stt-openai.sh"
_VOICE_STT_TIMEOUT_S = 30
_VOICE_MIME_SUFFIX = {
    "audio/ogg": ".oga",
    "audio/webm": ".webm",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
}
_IMAGE_ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp"}
_IMAGE_MAX_BYTES = 10 * 1024 * 1024  # 10MB
_IMAGE_MIME_SUFFIX = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
_AGENT_UPLOADS_BASE = Path(__file__).resolve().parents[1] / "uploads" / "agents"


def _sniff_agent_image_type(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


@router.post("/{slug}/voice")
async def post_agent_voice(
    slug: str, audio: UploadFile, request: Request
) -> dict[str, Any]:
    """Upload áudio → STT (gpt-4o-transcribe) → envia transcrito via send-keys.

    - 404 quando agente não existe
    - 422 quando mime não suportado ou tamanho > 10MB
    - 502 `stt_failed` quando script STT retorna exit≠0
    - 502 `stt_empty` quando transcrição vem vazia
    - 504 `stt_timeout` quando STT estoura 30s
    - 200 + {transcribed, tmux_delivered, duration_ms} no caminho feliz

    Cleanup do arquivo temp acontece no `finally`.
    """
    agent = await _get_agent_or_404(request, slug)

    base_mime = (audio.content_type or "").split(";")[0].strip()
    if base_mime not in _VOICE_ALLOWED_MIMES:
        raise HTTPException(
            status_code=422, detail=f"mime não suportado: {audio.content_type}"
        )

    content = await audio.read()
    if len(content) > _VOICE_MAX_BYTES:
        raise HTTPException(status_code=422, detail="audio maior que 10MB")

    started_at = time.monotonic()
    # stt-openai.sh só converte via ffmpeg extensões não reconhecidas (.oga, .opus…).
    # .webm vai direto pra OpenAI mas alguns encodings de browser falham. Salvar sempre
    # como .oga força a conversão mp3 e resolve webm/mp4/ogg de uma vez.
    suffix = ".oga"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    try:
        tmp.write(content)
        tmp.close()

        try:
            result = await asyncio.to_thread(
                subprocess.run,
                [_VOICE_STT_SCRIPT, tmp_path],
                capture_output=True,
                timeout=_VOICE_STT_TIMEOUT_S,
                text=True,
            )
        except subprocess.TimeoutExpired as e:
            raise HTTPException(status_code=504, detail="stt_timeout") from e

        if result.returncode != 0:
            stderr_tail = (result.stderr or "").strip().splitlines()
            last = stderr_tail[-1] if stderr_tail else "unknown"
            raise HTTPException(status_code=502, detail=f"stt_failed: {last}")

        transcribed = (result.stdout or "").strip()
        if not transcribed:
            raise HTTPException(status_code=502, detail="stt_empty")

        delivered = await tmux_driver.send_message(
            agent["tmux_session"], transcribed
        )
        duration_ms = int((time.monotonic() - started_at) * 1000)
        return {
            "transcribed": transcribed,
            "tmux_delivered": delivered,
            "duration_ms": duration_ms,
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@router.post("/{slug}/image")
async def post_agent_image(
    slug: str,
    file: UploadFile,
    request: Request,
    caption: str | None = Form(default=None),
) -> dict[str, Any]:
    """Upload imagem → salva permanente → envia path absoluto via send-keys.

    - 404 quando agente não existe
    - 422 quando mime não suportado, tamanho > 10MB ou bytes não são imagem real
    - 200 + {path, tmux_delivered, duration_ms} no caminho feliz
    """
    agent = await _get_agent_or_404(request, slug)

    base_mime = (file.content_type or "").split(";")[0].strip()
    if base_mime not in _IMAGE_ALLOWED_MIMES:
        raise HTTPException(
            status_code=422, detail=f"mime não suportado: {file.content_type}"
        )

    content = await file.read()
    if len(content) > _IMAGE_MAX_BYTES:
        raise HTTPException(status_code=422, detail="imagem maior que 10MB")

    ext = _IMAGE_MIME_SUFFIX[base_mime]
    sniffed_ext = _sniff_agent_image_type(content)
    if sniffed_ext is None or sniffed_ext != ext:
        raise HTTPException(status_code=422, detail="arquivo não é imagem válida")

    started_at = time.monotonic()
    filename = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:12]}{ext}"
    dest_dir = _AGENT_UPLOADS_BASE / slug
    absolute_path = dest_dir / filename

    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(absolute_path.write_bytes, content)
    except OSError as exc:
        log.error("Erro ao salvar imagem do agente %s em %s: %s", slug, absolute_path, exc)
        raise HTTPException(status_code=500, detail="erro interno ao salvar imagem") from exc

    caption_text = (caption or "").strip()
    # Path SEMPRE em nova linha — single-line "Imagem enviada via cockpit: <path>"
    # faz o CC auto-anexar o path como imagem e consumir o texto, deixando só o
    # cabeçalho no input. Multi-linha quebra esse auto-detect.
    text = f"Imagem enviada via cockpit:\n{absolute_path}"
    if caption_text:
        text = f"{text}\nCaption: {caption_text}"

    delivered = await tmux_driver.send_message(agent["tmux_session"], text)
    duration_ms = int((time.monotonic() - started_at) * 1000)
    log.info("agent %s: imagem salva %s", slug, absolute_path)
    return {
        "path": str(absolute_path),
        "tmux_delivered": delivered,
        "duration_ms": duration_ms,
    }


@router.post("/{slug}/model", response_model=ModelChangeResponse)
async def change_agent_model(
    slug: str, payload: ModelChangeRequest, request: Request
) -> ModelChangeResponse:
    """Troca modelo do agente via `/model <slug>` (Claude Code).

    Gates:
    - 404 quando agente não existe
    - 422 (Pydantic) quando model fora do whitelist opus/sonnet/haiku
    - 422 `codex_no_runtime_model_switch` quando executor_kind=codex (DS-2.1)
    - 409 `agent_busy_confirm_required` quando lifecycle=trabalhando sem force

    Caminho feliz (200):
    1. envia `/model <slug>` via send_message
    2. picker idempotente: aguarda 300ms e envia Enter extra
    3. poll capture_pane_excerpt em t+500/1000/1500ms; regex parse_model_from_pane
       confirma propagação. `confirmed=False` é warning (não erro).
    4. persiste state_model SÓ se delivered=True (inversão v2)
    5. emite task_event `agent.model_change` com {from, to, actor, confirmed}
    """
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") == "codex":
        raise HTTPException(status_code=422, detail="codex_no_runtime_model_switch")
    if agent.get("lifecycle_status") == "trabalhando" and not payload.force:
        raise HTTPException(status_code=409, detail="agent_busy_confirm_required")

    db: GrupoBorgesDB = request.app.state.db
    session = agent["tmux_session"]
    target = payload.model
    from_model = agent.get("state_model") or agent.get("model_default")

    delivered = await tmux_driver.send_message(session, f"/model {target}")

    state_persisted = False
    confirmed = False

    if delivered:
        # Picker do /model pode parar em prompt de confirmação ("Switch to ... y/n").
        # Enter idempotente: sem picker, cai em prompt vazio e o CC ignora.
        await asyncio.sleep(0.3)
        await tmux_driver.press_enter(session)

        # Poll de confirmação em t+500/1000/1500ms (acumulado). Sai cedo no match.
        for _ in range(3):
            await asyncio.sleep(0.5)
            excerpt = await tmux_driver.capture_pane_excerpt(session)
            if tmux_driver.parse_model_from_pane(excerpt) == target:
                confirmed = True
                break

        # Persistência só após delivered=True (v2: sem regressão silenciosa).
        await db.upsert_agent_state(slug, model=target)
        state_persisted = True

        await db.insert_task_event(
            kind="agent.model_change",
            agent_slug=slug,
            payload={
                "from": from_model,
                "to": target,
                "actor": "cockpit",
                "confirmed": confirmed,
            },
        )

    return ModelChangeResponse(
        tmux_delivered=delivered,
        state_persisted=state_persisted,
        confirmed=confirmed,
        model=target,
    )


# DS-64 F4-1 — serve attachments do channel inbox (WhatsApp/Telegram).
# Path absoluto vem do XML `<channel ... attachment_path="...">` que o hook
# UserPromptSubmit injeta. Whitelist rígida: só caminhos sob a raiz oficial
# de inbox dos canais, resolvidos pra evitar `..` ou symlink escape.
_CHANNEL_ATTACHMENT_ROOT = Path("/home/clawd/.claude/channels").resolve()
_CHANNEL_MIME_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".oga": "audio/ogg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
}


@router.get("/{slug}/channel-attachment")
async def get_channel_attachment(
    slug: str, request: Request, path: str = Query(..., min_length=1)
) -> FileResponse:
    """Serve um arquivo recebido via canal (WhatsApp/Telegram inbox).

    - 404 quando agente não existe
    - 400 quando path está fora da whitelist (`~/.claude/channels/<canal>/inbox/`)
    - 404 quando arquivo não existe no disco
    """
    await _get_agent_or_404(request, slug)

    try:
        resolved = Path(path).resolve(strict=False)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"path inválido: {exc}") from exc

    try:
        resolved.relative_to(_CHANNEL_ATTACHMENT_ROOT)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="path fora da raiz de canais permitida",
        ) from exc

    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="arquivo não existe")

    suffix = resolved.suffix.lower()
    media_type = _CHANNEL_MIME_BY_SUFFIX.get(suffix, "application/octet-stream")
    return FileResponse(
        path=str(resolved),
        media_type=media_type,
        filename=resolved.name,
    )


# ----- LB-9 Bloco 1: subsessões spawned via tool MCP -------------------------


@router.post("/{slug}/subagents/spawn", status_code=status.HTTP_200_OK)
async def spawn_agent_subsession(
    slug: str,
    payload: SpawnSubsessionInput,
    request: Request,
) -> dict[str, Any]:
    """Cria subsessão filho com worktree isolado (LB-9 Bloco 1).

    - 404 quando agente não existe
    - 409 quando workspace pai tem mudanças não-commitadas
    - 409 quando tmux falha ao criar sessão
    - 200 + { subsession_id, session_name, status:"starting" } no caminho feliz
    """
    agent = await _get_agent_or_404(request, slug)
    db: GrupoBorgesDB = request.app.state.db
    workspace_path = agent.get("workspace_path", "")
    if not workspace_path:
        raise HTTPException(status_code=409, detail="workspace_path não configurado para o agente")

    try:
        result = await spawn_subsession(slug, workspace_path, payload, db)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except TooManySubsessionsError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except SkillNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except libtmux_exc.LibTmuxException as exc:
        raise HTTPException(status_code=409, detail=f"tmux error: {exc}") from exc

    return result


@router.post("/{slug}/destrava")
async def post_agent_destrava(slug: str, request: Request) -> dict[str, Any]:
    """Envia Escape no pane ativo do agente — destrava modais interativos do CC
    (`/status`, `/mcp`, `/memory`, `/config`, prompts de confirmação) que cobrem
    o input. Idempotente: sem modal aberto, Escape vira no-op no CC.

    - 404 quando agente não existe
    - 200 + {tmux_delivered, sent_at} no caminho feliz
    """
    agent = await _get_agent_or_404(request, slug)
    delivered = await tmux_driver.press_escape(agent["tmux_session"])
    return {"tmux_delivered": delivered, "sent_at": int(time.time())}


@router.get("/{slug}/subagents")
async def list_agent_subagents(
    slug: str,
    request: Request,
    task_id: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    """Snapshot das subsessões ativas do agente (polling REST 5s — LB-9 Bloco 2).

    Retorna subsessões ativas em _subagent_state, incluindo as spawned_by_tool
    (com task_id, session_name, visibility) e as nativas do CC (parent_uuid, status).

    Com `?task_id=` filtra só as tool-spawned daquela task (popover Bloco 3).
    """
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")

    return subagent_active_snapshot(slug, task_id=task_id)
