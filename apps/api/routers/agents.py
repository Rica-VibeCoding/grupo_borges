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
POST /api/agents/{slug}/model          — DS-2/DS-69: troca modelo (Claude /model em runtime · Codex persiste pra próxima exec)
GET  /api/agents/{slug}/codex/thread   — TK-25: resumo read-only da thread Codex atual (modelo/tokens/atividade)
GET  /api/agents/{slug}/codex/messages — TK-25: histórico read-only sanitizado da última thread Codex
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
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Literal, NamedTuple, get_args

import httpx
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
from orchestrator.synthetic_message import detect_synthetic_kind
from routers.ask_user import (
    ask_user_active_snapshot,
    ask_user_events_since,
    _public_event as _public_ask_user,
)
from services import codex_reader
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
_AGENT_PAINEL_ALLOWED_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
_CODEX_PAINEL_ALLOWED_EFFORTS = ["low", "medium", "high", "xhigh"]
# Kimi K3 (assinatura Kimi Code): o endpoint expõe think_efforts low/high/max
# (default high) — medium/xhigh NÃO existem no motor. Validado 19/07 via
# GET api.kimi.com/coding/v1/models.
_KIMI_PAINEL_ALLOWED_EFFORTS = ["low", "high", "max"]
_CODEX_ALLOWED_SANDBOXES = ["read-only", "workspace-write", "danger-full-access"]
_CODEX_DEFAULT_SANDBOX = "danger-full-access"
_TELECODEX_CONTROL_URL = os.environ.get(
    "TELECODEX_CONTROL_URL",
    "http://127.0.0.1:8787/control/new-thread",
)
_AGENT_PAINEL_QUOTA_STALE_AFTER_SECONDS = 20
# Kimi: mesmo endpoint do `/usage` do Kimi Code CLI — janela de 5h + cota
# semanal da assinatura. Cache curto: o painel faz poll e a cota anda devagar.
_KIMI_USAGES_URL = "https://api.kimi.com/coding/v1/usages"
_KIMI_USAGES_CACHE_TTL_SECONDS = 60
_KIMI_USAGES_FAILURE_TTL_SECONDS = 30
# Contexto: cc-status só atualiza em turno; idade > 5min = agente dormindo
# (mesmo limiar do OFFLINE da frota) -> UI marca "dados antigos".
_AGENT_PAINEL_CONTEXTO_STALE_AFTER_SECONDS = 300
_AGENT_PAINEL_SETTINGS_PATH = "settings.json"
_CC_STATUS_PREFIX = "cc-status-"
AgentPainelEffortValue = Literal["low", "medium", "high", "xhigh", "max"]
AgentPainelPermissionMode = Literal["ask", "bypassPermissions", "plan", "acceptEdits"]
AgentCodexSandboxValue = Literal["read-only", "workspace-write", "danger-full-access"]


class AgentPainelTokens(BaseModel):
    input: int = 0
    output: int = 0
    cache_creation: int = 0
    cache_read: int = 0
    total: int = 0


class AgentPainelContexto(BaseModel):
    model: str | None = None
    model_family: str | None = None
    context_window: int | None = None
    tokens: AgentPainelTokens
    pct: float | None = None
    source: str
    updated_at: int | None = None
    available: bool
    stale: bool = False


class AgentPainelEffort(BaseModel):
    value: str | None = None
    allowed: list[str] = Field(default_factory=lambda: list(_AGENT_PAINEL_ALLOWED_EFFORTS))
    source: str
    session_may_diverge: bool = True


class AgentPainelPermission(BaseModel):
    mode: AgentPainelPermissionMode
    source: str
    session_may_diverge: bool = True


class AgentPainelSandbox(BaseModel):
    value: AgentCodexSandboxValue
    allowed: list[str] = Field(default_factory=lambda: list(_CODEX_ALLOWED_SANDBOXES))
    source: str
    session_may_diverge: bool = True


class AgentPainelQuotaWindow(BaseModel):
    used_percentage: float | None = None
    resets_at: int | None = None
    remaining_seconds: int | None = None


class AgentPainelQuotas(BaseModel):
    status: Literal["available", "missing", "stale", "unknown"]
    source: str | None = None
    session_id: str | None = None
    updated_at: int | None = None
    stale_after_seconds: int = _AGENT_PAINEL_QUOTA_STALE_AFTER_SECONDS
    five_hour: AgentPainelQuotaWindow | None = None
    seven_day: AgentPainelQuotaWindow | None = None


class AgentPainelSubagentEntry(BaseModel):
    id: str | None = None
    name: str | None = None
    state: str | None = None
    sessionId: str | None = None
    cwd: str | None = None
    model: str | None = None
    context_pct: float | None = None
    context_tokens: int | None = None
    context_window_size: int | None = None
    started_at: int | None = None
    sender: str | None = None


class AgentPainelSubagents(BaseModel):
    count: int
    active_count: int
    items: list[AgentPainelSubagentEntry]


class AgentPainelResponse(BaseModel):
    slug: str
    generated_at: int
    contexto: AgentPainelContexto
    effort: AgentPainelEffort
    permission: AgentPainelPermission
    quotas: AgentPainelQuotas
    subagents: AgentPainelSubagents
    sandbox: AgentPainelSandbox | None = None
    codex_native: bool | None = None
    codex_next_fresh: bool | None = None


class AgentPainelEffortPatchRequest(BaseModel):
    effort: AgentPainelEffortValue


class AgentPainelPermissionPatchRequest(BaseModel):
    mode: AgentPainelPermissionMode


class AgentCodexSandboxPatchRequest(BaseModel):
    sandbox: AgentCodexSandboxValue


class AgentCodexNewThreadPatchRequest(BaseModel):
    armed: bool = True


class AgentPainelEffortPatchResponse(BaseModel):
    slug: str
    effort: str
    source: str
    session_may_diverge: bool = True
    written: bool = True


class AgentPainelPermissionPatchResponse(BaseModel):
    slug: str
    mode: AgentPainelPermissionMode
    source: str
    session_may_diverge: bool = True
    written: bool = True


class AgentCodexSandboxPatchResponse(BaseModel):
    slug: str
    sandbox: AgentCodexSandboxValue
    source: str
    session_may_diverge: bool = True
    written: bool = True


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


@router.get(
    "/{slug}/painel",
    response_model=AgentPainelResponse,
)
async def get_agent_painel(slug: str, request: Request) -> AgentPainelResponse:
    db: GrupoBorgesDB = request.app.state.db
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") == "codex":
        cwd = agent.get("workspace_path") or codex_reader.TARA_CWD
        thread = await asyncio.to_thread(
            codex_reader.find_latest_thread, cwd, _codex_db_path()
        )
        return AgentPainelResponse(
            slug=slug,
            generated_at=int(time.time()),
            contexto=_build_codex_painel_contexto(agent, thread),
            effort=_build_codex_painel_effort(agent),
            permission=_read_agent_permission(),
            quotas=AgentPainelQuotas(status="missing", source="codex-native"),
            subagents=AgentPainelSubagents(count=0, active_count=0, items=[]),
            sandbox=_build_codex_painel_sandbox(agent),
            codex_native=True,
            codex_next_fresh=bool(agent.get("codex_next_fresh")),
        )

    cc_status = await _load_cc_status(db, slug)
    is_kimi = agent.get("model_family") == "kimi"
    kimi_usages = None
    if is_kimi:
        kimi_api_key = getattr(request.app.state, "settings", None)
        kimi_api_key = getattr(kimi_api_key, "kimi_api_key", None)
        if kimi_api_key:
            kimi_usages = await _get_kimi_usages(kimi_api_key)
    contexto, effort, permission, quotas, subagents = await asyncio.gather(
        asyncio.to_thread(_build_painel_contexto, agent, cc_status),
        # Kimi: effort persistido em agent_state (env var de boot), não o
        # settings.json global — senão o card do Hiro mostraria o effort dos
        # agentes Anthropic e os 5 níveis que o motor não tem.
        asyncio.to_thread(_build_kimi_painel_effort, agent)
        if is_kimi
        else asyncio.to_thread(_read_agent_effort),
        asyncio.to_thread(_read_agent_permission),
        asyncio.to_thread(_build_kimi_painel_quotas, kimi_usages)
        if kimi_usages is not None
        else asyncio.to_thread(_build_painel_quotas, cc_status),
        asyncio.to_thread(_build_agent_subagents, agent.get("workspace_path")),
    )
    return AgentPainelResponse(
        slug=slug,
        generated_at=int(time.time()),
        contexto=contexto,
        effort=effort,
        permission=permission,
        quotas=quotas,
        subagents=subagents,
    )


@router.patch("/{slug}/effort", response_model=AgentPainelEffortPatchResponse)
async def patch_agent_effort(
    slug: str,
    patch: AgentPainelEffortPatchRequest,
    request: Request,
) -> AgentPainelEffortPatchResponse:
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") == "codex":
        if patch.effort not in _CODEX_PAINEL_ALLOWED_EFFORTS:
            raise HTTPException(status_code=422, detail="codex_effort_not_allowed")
        db: GrupoBorgesDB = request.app.state.db
        await db.update_agent_codex_state(slug, codex_reasoning_effort=patch.effort)
        return AgentPainelEffortPatchResponse(
            slug=slug,
            effort=patch.effort,
            source="agent_state.codex_reasoning_effort",
            session_may_diverge=True,
            written=True,
        )
    if agent.get("model_family") == "kimi":
        # Kimi pensa sempre; o nível é env var (CLAUDE_CODE_EFFORT_LEVEL) lida
        # no boot — persistir no settings.json global não teria efeito e ainda
        # vazaria pros outros agentes. Vale no próximo boot, como o modelo.
        if patch.effort not in _KIMI_PAINEL_ALLOWED_EFFORTS:
            raise HTTPException(status_code=422, detail="kimi_effort_not_allowed")
        db = request.app.state.db
        await db.update_agent_codex_state(slug, kimi_reasoning_effort=patch.effort)
        return AgentPainelEffortPatchResponse(
            slug=slug,
            effort=patch.effort,
            source="agent_state.kimi_reasoning_effort",
            session_may_diverge=True,
            written=True,
        )
    return await asyncio.to_thread(_write_agent_effort, slug, patch.effort)


@router.patch("/{slug}/codex-sandbox", response_model=AgentCodexSandboxPatchResponse)
async def patch_agent_codex_sandbox(
    slug: str,
    patch: AgentCodexSandboxPatchRequest,
    request: Request,
) -> AgentCodexSandboxPatchResponse:
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") != "codex":
        raise HTTPException(status_code=400, detail="not_a_codex_agent")
    db: GrupoBorgesDB = request.app.state.db
    await db.update_agent_codex_state(slug, codex_sandbox=patch.sandbox)
    return AgentCodexSandboxPatchResponse(
        slug=slug,
        sandbox=patch.sandbox,
        source="agent_state.codex_sandbox",
        session_may_diverge=True,
        written=True,
    )


@router.patch("/{slug}/codex-new-thread")
async def patch_agent_codex_new_thread(
    slug: str,
    patch: AgentCodexNewThreadPatchRequest,
    request: Request,
) -> dict[str, Any]:
    """Cria thread Codex nova imediatamente quando o executor local estiver disponível."""
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") != "codex":
        raise HTTPException(status_code=400, detail="not_a_codex_agent")
    db: GrupoBorgesDB = request.app.state.db
    if patch.armed:
        started = await _telecodex_new_thread()
        if started is not None:
            await db.update_agent_codex_state(slug, codex_next_fresh=0)
            return {
                "slug": slug,
                "armed": False,
                "thread_started": not bool(started.get("pending")),
                "thread_pending": bool(started.get("pending")),
                "thread_id": started.get("threadId"),
            }
        await db.update_agent_codex_state(slug, codex_next_fresh=1)
        return {"slug": slug, "armed": True, "thread_started": False, "thread_id": None}
    await db.update_agent_codex_state(slug, codex_next_fresh=0)
    return {"slug": slug, "armed": False, "thread_started": False, "thread_id": None}


@router.patch("/{slug}/permission-mode", response_model=AgentPainelPermissionPatchResponse)
async def patch_agent_permission_mode(
    slug: str,
    patch: AgentPainelPermissionPatchRequest,
    request: Request,
) -> AgentPainelPermissionPatchResponse:
    await _get_agent_or_404(request, slug)
    return await asyncio.to_thread(_write_agent_permission_mode, slug, patch.mode)


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


def _model_family(model: str | None) -> str | None:
    if not model:
        return None
    lowered = model.lower()
    # Motor Kimi: id cru `k3` / slugs `kimi-*` — agrupa tudo como "kimi" no painel.
    if "kimi" in lowered or lowered.startswith("k3"):
        return "kimi"
    for family in ("fable", "opus", "sonnet", "haiku", "codex", "gpt"):
        if family in lowered:
            return family
    return model


def _int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _num_or_none(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _build_codex_painel_contexto(
    agent: dict[str, Any],
    thread: codex_reader.CodexThread | None,
) -> AgentPainelContexto:
    model = (
        thread.model
        if thread is not None and thread.model
        else agent.get("state_model") or agent.get("model_default")
    )
    tokens_used = thread.tokens_used if thread is not None else 0
    updated_at = (
        int(thread.updated_at_ms / 1000)
        if thread is not None and thread.updated_at_ms is not None
        else None
    )
    return AgentPainelContexto(
        model=model,
        model_family=_model_family(model),
        tokens=AgentPainelTokens(total=tokens_used),
        pct=None,
        source=codex_reader.SOURCE,
        updated_at=updated_at,
        available=thread is not None,
    )


def _build_codex_painel_effort(agent: dict[str, Any]) -> AgentPainelEffort:
    value = agent.get("codex_reasoning_effort")
    if value not in _CODEX_PAINEL_ALLOWED_EFFORTS:
        value = None
    return AgentPainelEffort(
        value=value,
        allowed=list(_CODEX_PAINEL_ALLOWED_EFFORTS),
        source="agent_state.codex_reasoning_effort",
        session_may_diverge=True,
    )


def _build_kimi_painel_effort(agent: dict[str, Any]) -> AgentPainelEffort:
    value = agent.get("kimi_reasoning_effort")
    if value not in _KIMI_PAINEL_ALLOWED_EFFORTS:
        value = None
    return AgentPainelEffort(
        value=value,
        allowed=list(_KIMI_PAINEL_ALLOWED_EFFORTS),
        source="agent_state.kimi_reasoning_effort",
        session_may_diverge=True,
    )


def _build_codex_painel_sandbox(agent: dict[str, Any]) -> AgentPainelSandbox:
    value = agent.get("codex_sandbox")
    if value not in _CODEX_ALLOWED_SANDBOXES:
        value = _CODEX_DEFAULT_SANDBOX
    return AgentPainelSandbox(
        value=value,
        source="agent_state.codex_sandbox",
        session_may_diverge=True,
    )


class _CCStatus(NamedTuple):
    session_id: str | None
    path: Path | None
    payload: dict[str, Any] | None
    fell_back: bool = False


async def _load_cc_status(db: GrupoBorgesDB, slug: str) -> _CCStatus:
    """Lê /tmp/cc-status-<sessionId>.json escrito pela statusline do CC.

    Fonte única pra `_build_painel_contexto` (contexto/tokens) E pra
    `_build_painel_quotas` (rate limits): payload é parseado uma vez
    e propagado pra ambos via `asyncio.gather`.

    Fallback: a sessão mais recente pode não ter arquivo (sessão curta ou
    headless não roda statusline). Nesse caso anda pra trás nas sessões
    recentes até achar uma com arquivo legível, marcando `fell_back` —
    melhor mostrar o último contexto conhecido do que painel vazio.
    """
    session_ids = await db.recent_jsonl_session_ids(slug)
    if not session_ids:
        return _CCStatus(None, None, None)
    for session_id in session_ids:
        path = Path("/tmp") / f"{_CC_STATUS_PREFIX}{session_id}.json"
        if not path.exists():
            continue
        payload = await asyncio.to_thread(_read_json_file, path, None)
        if not isinstance(payload, dict):
            continue
        return _CCStatus(session_id, path, payload, session_id != session_ids[0])
    return _CCStatus(session_ids[0], Path("/tmp") / f"{_CC_STATUS_PREFIX}{session_ids[0]}.json", None)


def _build_painel_contexto(agent: dict[str, Any], cc_status: _CCStatus) -> AgentPainelContexto:
    payload = cc_status.payload or {}
    model_block = payload.get("model") if isinstance(payload.get("model"), dict) else {}
    model = (
        model_block.get("display_name")
        or model_block.get("id")
        or agent.get("state_model")
        or agent.get("model_default")
    )
    updated_at = _int_or_none(payload.get("updated_at"))
    context_window_block = payload.get("context_window")
    if not isinstance(context_window_block, dict):
        return AgentPainelContexto(
            model=model,
            model_family=_model_family(model),
            tokens=AgentPainelTokens(),
            pct=None,
            source=str(cc_status.path) if cc_status.path else "cc_status:missing",
            updated_at=updated_at,
            available=False,
        )
    stale = cc_status.fell_back or (
        updated_at is not None
        and int(time.time()) - updated_at > _AGENT_PAINEL_CONTEXTO_STALE_AFTER_SECONDS
    )

    usage = context_window_block.get("current_usage") if isinstance(context_window_block.get("current_usage"), dict) else {}
    input_tokens = _int_or_none(usage.get("input_tokens")) or 0
    output_tokens = _int_or_none(usage.get("output_tokens")) or 0
    cache_creation = _int_or_none(usage.get("cache_creation_input_tokens")) or 0
    cache_read = _int_or_none(usage.get("cache_read_input_tokens")) or 0
    total = input_tokens + output_tokens + cache_creation + cache_read
    context_window = _int_or_none(context_window_block.get("context_window_size"))
    pct = _num_or_none(context_window_block.get("used_percentage"))
    return AgentPainelContexto(
        model=model,
        model_family=_model_family(model),
        context_window=context_window,
        tokens=AgentPainelTokens(
            input=input_tokens,
            output=output_tokens,
            cache_creation=cache_creation,
            cache_read=cache_read,
            total=total,
        ),
        pct=pct,
        source=str(cc_status.path),
        updated_at=updated_at,
        available=True,
        stale=stale,
    )


def _read_agent_effort() -> AgentPainelEffort:
    settings_path = _agent_painel_settings_path()
    settings = _read_json_file(settings_path, {})
    value = settings.get("effortLevel") if isinstance(settings, dict) else None
    if value is not None:
        value = str(value)
    return AgentPainelEffort(value=value, source=str(settings_path))


def _agent_painel_settings_path() -> Path:
    return _CLAUDE_HOME / _AGENT_PAINEL_SETTINGS_PATH


def _write_agent_effort(slug: str, effort: AgentPainelEffortValue) -> AgentPainelEffortPatchResponse:
    settings_path = _agent_painel_settings_path()
    settings = _read_json_file(settings_path, {})
    if not isinstance(settings, dict):
        raise HTTPException(status_code=500, detail=f"JSON inválido em {settings_path}: raiz deve ser objeto")

    settings["effortLevel"] = effort
    _atomic_write_json(settings_path, settings)
    return AgentPainelEffortPatchResponse(
        slug=slug,
        effort=effort,
        source=str(settings_path),
        session_may_diverge=True,
        written=True,
    )


def _read_agent_permission() -> AgentPainelPermission:
    settings_path = _agent_painel_settings_path()
    settings = _read_json_file(settings_path, {})
    permissions = settings.get("permissions") if isinstance(settings, dict) else None
    mode = permissions.get("defaultMode") if isinstance(permissions, dict) else None
    if mode not in ("ask", "bypassPermissions", "plan", "acceptEdits"):
        mode = "ask"
    return AgentPainelPermission(mode=mode, source=str(settings_path))


def _write_agent_permission_mode(
    slug: str,
    mode: AgentPainelPermissionMode,
) -> AgentPainelPermissionPatchResponse:
    settings_path = _agent_painel_settings_path()
    settings = _read_json_file(settings_path, {})
    if not isinstance(settings, dict):
        raise HTTPException(status_code=500, detail=f"JSON inválido em {settings_path}: raiz deve ser objeto")

    permissions = settings.get("permissions")
    if not isinstance(permissions, dict):
        permissions = {}
    permissions["defaultMode"] = mode
    settings["permissions"] = permissions
    _atomic_write_json(settings_path, settings)
    return AgentPainelPermissionPatchResponse(
        slug=slug,
        mode=mode,
        source=str(settings_path),
        session_may_diverge=True,
        written=True,
    )


_kimi_usages_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}


def _fetch_kimi_usages_sync(api_key: str) -> dict[str, Any] | None:
    """GET /coding/v1/usages da assinatura Kimi Code (fonte do `/usage` do CLI).

    Devolve janela de 300min em `limits[]` e cota da assinatura em `usage`
    (valores numéricos vêm como string). Qualquer falha -> None (quem chama
    cai no comportamento antigo, baseado no cc-status).
    """
    request = urllib.request.Request(
        _KIMI_USAGES_URL,
        headers={"x-api-key": api_key, "accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


async def _get_kimi_usages(api_key: str) -> dict[str, Any] | None:
    now = time.time()
    cached = _kimi_usages_cache.get("kimi")
    if cached is not None:
        fetched_at, payload = cached
        ttl = (
            _KIMI_USAGES_CACHE_TTL_SECONDS
            if payload is not None
            else _KIMI_USAGES_FAILURE_TTL_SECONDS
        )
        if now - fetched_at < ttl:
            return payload
    payload = await asyncio.to_thread(_fetch_kimi_usages_sync, api_key)
    _kimi_usages_cache["kimi"] = (now, payload)
    return payload


def _kimi_quota_window(detail: Any, now: int) -> AgentPainelQuotaWindow | None:
    if not isinstance(detail, dict):
        return None
    try:
        limit = float(detail.get("limit"))
        used = float(detail.get("used"))
    except (TypeError, ValueError):
        return None
    if limit <= 0:
        return None
    resets_at = _parse_iso_epoch(detail.get("resetTime"))
    return AgentPainelQuotaWindow(
        used_percentage=round(used / limit * 100, 1),
        resets_at=resets_at,
        remaining_seconds=max(0, resets_at - now) if resets_at is not None else None,
    )


def _build_kimi_painel_quotas(kimi_usages: dict[str, Any]) -> AgentPainelQuotas:
    """Mapeia /coding/v1/usages pro mesmo shape 5h+7d que o CC mostra."""
    now = int(time.time())
    five_hour = None
    limits = kimi_usages.get("limits")
    entries = limits if isinstance(limits, list) else []
    for entry in entries:
        window = entry.get("window") if isinstance(entry, dict) else None
        if (
            isinstance(window, dict)
            and window.get("duration") == 300
            and window.get("timeUnit") == "TIME_UNIT_MINUTE"
        ):
            five_hour = _kimi_quota_window(entry.get("detail"), now)
            break
    if five_hour is None and entries and isinstance(entries[0], dict):
        five_hour = _kimi_quota_window(entries[0].get("detail"), now)
    return AgentPainelQuotas(
        status="available",
        source=_KIMI_USAGES_URL,
        updated_at=now,
        five_hour=five_hour,
        seven_day=_kimi_quota_window(kimi_usages.get("usage"), now),
    )


def _quota_window(raw: Any, now: int) -> AgentPainelQuotaWindow | None:
    if not isinstance(raw, dict):
        return None
    used_percentage = _num_or_none(raw.get("used_percentage"))
    resets_at = _int_or_none(raw.get("resets_at"))
    remaining_seconds = max(0, resets_at - now) if resets_at is not None else None
    return AgentPainelQuotaWindow(
        used_percentage=used_percentage,
        resets_at=resets_at,
        remaining_seconds=remaining_seconds,
    )


def _build_painel_quotas(cc_status: _CCStatus) -> AgentPainelQuotas:
    if cc_status.session_id is None:
        return AgentPainelQuotas(status="missing")
    source = str(cc_status.path) if cc_status.path else None
    if cc_status.payload is None:
        return AgentPainelQuotas(status="missing", source=source, session_id=cc_status.session_id)

    payload = cc_status.payload
    now = int(time.time())
    updated_at = _int_or_none(payload.get("updated_at"))
    status: Literal["available", "missing", "stale", "unknown"] = "available"
    if updated_at is None:
        status = "unknown"
    elif now - updated_at > _AGENT_PAINEL_QUOTA_STALE_AFTER_SECONDS:
        status = "stale"

    rate_limits = payload.get("rate_limits") if isinstance(payload.get("rate_limits"), dict) else {}
    return AgentPainelQuotas(
        status=status,
        source=source,
        session_id=cc_status.session_id,
        updated_at=updated_at,
        five_hour=_quota_window(rate_limits.get("five_hour"), now),
        seven_day=_quota_window(rate_limits.get("seven_day"), now),
    )


_AGENT_VIEW_ACTIVE_STATES = frozenset({"working", "needs_input", "blocked"})
_AGENT_VIEW_ITEMS_CAP = 10
_AGENT_VIEW_RECENT_WINDOW_SECONDS = 15 * 60


def _parse_iso_epoch(value: Any) -> int | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return int(dt.timestamp())


def _is_recent(updated_at_iso: Any, window_seconds: int) -> bool:
    if not isinstance(updated_at_iso, str):
        return False
    try:
        dt = datetime.fromisoformat(updated_at_iso.replace("Z", "+00:00"))
    except ValueError:
        return False
    age = (datetime.now(timezone.utc) - dt).total_seconds()
    return age <= window_seconds


_SUBAGENT_SENDER_BY_CWD: tuple[tuple[str, str], ...] = (
    ("/home/clawd/repos/ze_claude/daniel", "Daniel"),
    ("/home/clawd/repos/ze_claude/pavan", "Pavan"),
    ("/home/clawd/repos/ze_claude/lucas", "Lucas"),
    ("/home/clawd/repos/ze_claude/vinicius", "Vinicius"),
    ("/home/clawd/repos/ze_claude/felipe", "Felipe"),
    ("/home/clawd/repos/ze_claude/barsi", "Barsi"),
    ("/home/clawd/repos/ze_claude/miga_dani", "Miga"),
    ("/home/clawd/repos/grupo_borges", "Pavan"),
)


def _infer_sender_from_cwd(cwd: str | None) -> str | None:
    """Mapeia o `cwd` de um job pro slug do agente que disparou o subagent.

    Match por prefixo de path (separador `/`) — subdirs do workspace contam
    como mesmo sender. Retorna `None` quando o cwd não bate com nenhum
    workspace conhecido.
    """
    if not isinstance(cwd, str) or not cwd:
        return None
    for prefix, sender in _SUBAGENT_SENDER_BY_CWD:
        if cwd == prefix or cwd.startswith(prefix + "/"):
            return sender
    return None


def _read_cc_status_for_subagent(session_id: str | None) -> dict[str, Any] | None:
    if not session_id:
        return None
    path = Path("/tmp") / f"{_CC_STATUS_PREFIX}{session_id}.json"
    if not path.exists():
        return None
    payload = _read_json_file(path, None)
    return payload if isinstance(payload, dict) else None


def _list_agent_view_jobs(agent_workspace_path: str | None) -> list[dict[str, Any]]:
    """Percorre `~/.claude/jobs/*/state.json` e lista jobs ativos do sistema.

    Cada entry retornada inclui um campo extra `_job_id` (basename do diretório).
    """
    base = _CLAUDE_HOME / "jobs"
    if not base.exists():
        return []
    jobs: list[dict[str, Any]] = []
    for state_path in base.glob("*/state.json"):
        try:
            with state_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        state = payload.get("state")
        if not isinstance(state, str) or state.lower() not in _AGENT_VIEW_ACTIVE_STATES:
            continue
        if not _is_recent(payload.get("updatedAt"), _AGENT_VIEW_RECENT_WINDOW_SECONDS):
            continue
        payload["_job_id"] = state_path.parent.name
        jobs.append(payload)
    jobs.sort(key=lambda j: j.get("updatedAt") or j.get("createdAt") or "", reverse=True)
    return jobs


def _agent_view_entry(job: dict[str, Any], cc_status: dict[str, Any] | None) -> AgentPainelSubagentEntry:
    session_id = job.get("sessionId") if isinstance(job.get("sessionId"), str) else None
    model: str | None = None
    context_pct: float | None = None
    context_tokens: int | None = None
    context_window_size: int | None = None
    if cc_status:
        model_block = cc_status.get("model") if isinstance(cc_status.get("model"), dict) else None
        if model_block:
            raw_display = (
                model_block.get("display_name")
                if isinstance(model_block.get("display_name"), str)
                else model_block.get("id") if isinstance(model_block.get("id"), str) else None
            )
            model = re.sub(r"\s*\([^)]*context\)\s*$", "", raw_display).strip() if raw_display else None
        ctx = cc_status.get("context_window") if isinstance(cc_status.get("context_window"), dict) else None
        if ctx:
            context_pct = _num_or_none(ctx.get("used_percentage"))
            context_window_size = _int_or_none(ctx.get("context_window_size"))
            usage = ctx.get("current_usage") if isinstance(ctx.get("current_usage"), dict) else {}
            if usage:
                input_t = _int_or_none(usage.get("input_tokens")) or 0
                output_t = _int_or_none(usage.get("output_tokens")) or 0
                cache_c = _int_or_none(usage.get("cache_creation_input_tokens")) or 0
                cache_r = _int_or_none(usage.get("cache_read_input_tokens")) or 0
                context_tokens = input_t + output_t + cache_c + cache_r
    cwd_value = job.get("cwd") if isinstance(job.get("cwd"), str) else None
    return AgentPainelSubagentEntry(
        id=job.get("_job_id") if isinstance(job.get("_job_id"), str) else None,
        name=job.get("name") if isinstance(job.get("name"), str) else None,
        state=job.get("state") if isinstance(job.get("state"), str) else None,
        sessionId=session_id,
        cwd=cwd_value,
        model=model,
        context_pct=context_pct,
        context_tokens=context_tokens,
        context_window_size=context_window_size,
        started_at=_parse_iso_epoch(job.get("createdAt")),
        sender=_infer_sender_from_cwd(cwd_value),
    )


def _build_agent_subagents(agent_workspace_path: str | None) -> AgentPainelSubagents:
    jobs = _list_agent_view_jobs(agent_workspace_path)
    items = [
        _agent_view_entry(job, _read_cc_status_for_subagent(job.get("sessionId")))
        for job in jobs[:_AGENT_VIEW_ITEMS_CAP]
    ]
    return AgentPainelSubagents(count=len(jobs), active_count=len(jobs), items=items)


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


_PROVIDES_ORDER = ("skill", "mcp", "subagent", "hook", "lsp")


def _scan_plugin_provides(install_path: Path) -> list[str]:
    """Detecta o que um plugin expõe ao escanear seu install_path.

    Procura por: agents/*.md → subagent; commands/*.md → skill (slash);
    .mcp.json (mcpServers) → mcp; hooks/* → hook; skills/*/SKILL.md → skill.
    Retorna lista ordenada e deduplicada.
    """
    found: set[str] = set()
    try:
        if not install_path.is_dir():
            return []
    except OSError:
        return []

    agents_dir = install_path / "agents"
    if agents_dir.is_dir():
        try:
            if any(p.suffix == ".md" for p in agents_dir.rglob("*.md")):
                found.add("subagent")
        except OSError:
            pass

    commands_dir = install_path / "commands"
    if commands_dir.is_dir():
        try:
            if any(p.suffix == ".md" for p in commands_dir.glob("*.md")):
                found.add("skill")
        except OSError:
            pass

    skills_dir = install_path / "skills"
    if skills_dir.is_dir():
        try:
            if any((sub / "SKILL.md").is_file() for sub in skills_dir.iterdir() if sub.is_dir()):
                found.add("skill")
        except OSError:
            pass

    mcp_path = install_path / ".mcp.json"
    if mcp_path.is_file():
        defs = _mcp_server_defs(_read_json_file(mcp_path, {}))
        if defs:
            found.add("mcp")

    hooks_dir = install_path / "hooks"
    if hooks_dir.is_dir():
        try:
            if any(True for _ in hooks_dir.iterdir()):
                found.add("hook")
        except OSError:
            pass

    return [item for item in _PROVIDES_ORDER if item in found]


def _mcp_entry(
    kind: str,
    id_: str,
    name: str,
    enabled: bool,
    definition: dict[str, Any],
    provides: list[str] | None = None,
) -> dict[str, Any]:
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
    if provides:
        entry["provides"] = list(provides)
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
        # installed_plugins.json (v2) usa {name: [{installPath, scope, ...}, ...]}
        # — uma lista de instalações por plugin. Pega a primeira pra metadata.
        if isinstance(entry, list) and entry and isinstance(entry[0], dict):
            metadata = entry[0]
        elif isinstance(entry, dict):
            metadata = entry
        else:
            metadata = {}
        plugin_id = _plugin_id(str(key) if key else None, metadata)
        if not plugin_id:
            continue
        plugins.append((plugin_id, _plugin_install_path(metadata), metadata))
    return plugins


def _plugin_mcp_entry(plugin_id: str, install_path: Path | None, enabled: bool, metadata: dict[str, Any]) -> dict[str, Any] | None:
    fallback_name = metadata.get("name") or plugin_id.split("@", 1)[0]
    if install_path is None:
        return _mcp_entry("plugin", plugin_id, fallback_name, enabled, {})

    provides = _scan_plugin_provides(install_path)
    definitions = _mcp_server_defs(_read_json_file(install_path / ".mcp.json", {}))
    if definitions:
        name, definition = next(iter(definitions.items()))
        return _mcp_entry("plugin", plugin_id, name, enabled, definition, provides=provides)
    # Plugin sem .mcp.json: ainda aparece no painel pra Rica enxergar o que
    # tem instalado (skill-only, subagent-only, hook-only). transport/command
    # ficam None (não tem MCP rodando), só `provides` informa o que expõe.
    return _mcp_entry("plugin", plugin_id, fallback_name, enabled, {}, provides=provides)


@router.get("/{slug}/mcp")
async def list_agent_mcp(slug: str, request: Request) -> dict[str, Any]:
    agent = await _get_agent_or_404(request, slug)
    workspace = Path(agent["workspace_path"])

    settings = _read_json_file(_CLAUDE_HOME / "settings.json", {})
    enabled_plugins = settings.get("enabledPlugins") if isinstance(settings, dict) else {}
    if not isinstance(enabled_plugins, dict):
        enabled_plugins = {}
    local_settings = _read_json_file(workspace / ".claude" / "settings.local.json", {})
    local_ep = local_settings.get("enabledPlugins") if isinstance(local_settings, dict) else {}
    if isinstance(local_ep, dict):
        enabled_plugins = {**enabled_plugins, **local_ep}

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

    # Subagentes user-level (~/.claude/agents/*.md). Não recursivo — só .md
    # direto na pasta. Toggle não suportado (Rica move arquivo manualmente).
    user_agents_dir = _CLAUDE_HOME / "agents"
    if user_agents_dir.is_dir():
        try:
            agent_files = sorted(p for p in user_agents_dir.glob("*.md") if p.is_file())
        except OSError:
            agent_files = []
        for agent_file in agent_files:
            stem = agent_file.stem
            name = _parse_agent_name_from_md(agent_file) or stem
            servers.append(
                _mcp_entry(
                    "agent_user",
                    stem,
                    name,
                    True,
                    {},
                    provides=["subagent"],
                )
            )

    return {"servers": servers}


def _parse_agent_name_from_md(path: Path) -> str | None:
    """Extrai `name:` do frontmatter YAML de um .md (primeira ocorrência).

    Lê só até o segundo `---` ou EOF (cap 4KB). Sem dependência de yaml lib —
    split simples por linha. Retorna None se não achar `name:` ou se o
    frontmatter não existir.
    """
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            head = f.read(4096)
    except OSError:
        return None
    lines = head.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    for line in lines[1:]:
        stripped = line.strip()
        if stripped == "---":
            return None
        if stripped.startswith("name:"):
            value = stripped.split(":", 1)[1].strip().strip("'\"")
            return value or None
    return None


@router.patch("/{slug}/mcp/{kind}/{id}", response_model=McpToggleResponse)
async def patch_agent_mcp(
    slug: str,
    kind: Literal["plugin", "mcp_json", "remote", "user_scope", "agent_user"],
    id: str,
    payload: McpToggleRequest,
    request: Request,
) -> McpToggleResponse:
    agent = await _get_agent_or_404(request, slug)

    if kind == "agent_user":
        raise HTTPException(
            status_code=422,
            detail="subagentes user-level não suportam toggle (mova arquivo .md manualmente)",
        )

    if kind == "plugin":
        action = "enable" if payload.enabled else "disable"
        # cwd = workspace do agente: settings local (.claude/settings.local.json)
        # de cada Zé faz override do user-scope. Sem isso, o disable escreve no
        # CWD do uvicorn (grupo_borges/apps/api) e nada acontece pro agente alvo.
        result = await asyncio.to_thread(
            subprocess.run,
            ["claude", "plugin", action, id],
            cwd=str(agent["workspace_path"]),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            # CLI retorna erro quando já está no estado desejado — trata como
            # idempotente em vez de devolver 500 (Rica clicaria e veria erro
            # vermelho mesmo o estado já estando correto).
            stderr = result.stderr.strip()
            if "already" in stderr.lower():
                return McpToggleResponse(applied=True, requires_reload=False)
            raise HTTPException(
                status_code=500,
                detail=f"claude plugin {action} falhou: {stderr}",
            )
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

ChatModel = Literal["fable", "opus", "sonnet", "haiku"]

# DS-69 — modelos Codex selecionáveis pra Tara. Slugs canônicos (id do backend);
# a tradução pro nome cru do CLI (`gpt-5.5` etc) mora em
# `tmux_driver._CODEX_MODEL_MAP` — fonte única do de-para, não duplicar aqui.
CodexModel = Literal[
    "codex-gpt-5-6-sol",
    "codex-gpt-5-6-terra",
    "codex-gpt-5-6-luna",
    "codex-gpt-5-5",
    "codex-gpt-5-4",
    "codex-gpt-5-4-mini",
    "codex-gpt-5-3-codex",
    "codex-gpt-5-2",
]
_CODEX_MODEL_SLUGS = frozenset(get_args(CodexModel))

# Modelos Kimi (assinatura Kimi Code, endpoint api.kimi.com/coding/) pro Hiro.
# Slugs canônicos; o de-para pro id cru do motor (`k3`, `kimi-for-coding`, …)
# mora em `ze-shared/scripts/kimi-models.sh` — fonte única consumida pelos
# wrappers bash (subir-frota.sh, hiro-k3), espelho do padrão `_CODEX_MODEL_MAP`.
# Lista validada 19/07 via GET /v1/models: só esses 3 existem na assinatura.
KimiModel = Literal[
    "kimi-k3",
    "kimi-k2.7-code",
    "kimi-k2.7-code-highspeed",
]
_KIMI_MODEL_SLUGS = frozenset(get_args(KimiModel))


class PaneStreamEvent(BaseModel):
    excerpt: str
    captured_at: int
    executor_kind: str


class InputRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8192)
    idempotency_key: str = Field(min_length=1, max_length=128)
    fresh: bool = False


class InputResponse(BaseModel):
    tmux_delivered: bool
    sent_at: int


class ModelChangeRequest(BaseModel):
    model: ChatModel | CodexModel | KimiModel
    force: bool = False


class ModelChangeResponse(BaseModel):
    tmux_delivered: bool
    state_persisted: bool
    confirmed: bool
    model: str
    # DS-69 — True quando a troca vale na sessão viva (Claude Code via /model);
    # False quando só vale na PRÓXIMA execução (Codex CLI não troca em runtime).
    runtime_switch: bool = True


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
_CODEX_INPUT_LOCKS: dict[str, asyncio.Lock] = {}
_CODEX_INPUT_LOCKS_GUARD = asyncio.Lock()
_CODEX_BUSY_STATUS_LINES = ("iniciando", "processando turn", "rodando:")


async def _telecodex_new_thread() -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(_TELECODEX_CONTROL_URL, json={})
        if not res.is_success:
            log.warning("telecodex new-thread failed: HTTP %s", res.status_code)
            return None
        body = res.json()
    except Exception as exc:
        log.warning("telecodex new-thread failed: %s", exc)
        return None
    if isinstance(body, dict) and body.get("ok") is True:
        return body
    log.warning("telecodex new-thread returned unexpected body: %r", body)
    return None


async def _codex_input_lock(slug: str) -> asyncio.Lock:
    async with _CODEX_INPUT_LOCKS_GUARD:
        lock = _CODEX_INPUT_LOCKS.get(slug)
        if lock is None:
            lock = asyncio.Lock()
            _CODEX_INPUT_LOCKS[slug] = lock
        return lock


def _codex_turn_in_flight(agent: dict[str, Any]) -> bool:
    if agent.get("lifecycle_status") == "trabalhando":
        return True
    status_line = str(agent.get("status_line") or "").strip().lower()
    return any(status_line.startswith(marker) for marker in _CODEX_BUSY_STATUS_LINES)


def _tara_codex_script_path() -> str:
    return str(Path(__file__).resolve().parents[3] / "scripts" / "tara-codex")


def _spawn_tara_codex_input(
    *,
    cwd: str,
    text: str,
    thread_id: str | None,
    fresh: bool = False,
    image_path: str | None = None,
) -> None:
    # Via `bash <script>` em vez de exec direto: o bit +x pode cair em edição/
    # linter, e um PermissionError aqui viraria 500 silencioso no /input.
    cmd = [
        "bash",
        _tara_codex_script_path(),
        "--delegator",
        "cockpit",
    ]
    if thread_id and not fresh:
        cmd.extend(["--resume-thread", thread_id])
    cmd.extend(["-C", cwd])
    if image_path is not None:
        cmd.extend(["-i", image_path])
    cmd.extend(["--", text])
    subprocess.Popen(
        cmd,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )


async def _spawn_codex_agent_turn(
    slug: str,
    request: Request,
    *,
    text: str,
    fresh: bool = False,
    image_path: str | None = None,
) -> None:
    lock = await _codex_input_lock(slug)
    async with lock:
        agent = await _get_agent_or_404(request, slug)
        if _codex_turn_in_flight(agent):
            raise HTTPException(status_code=409, detail="codex_turn_in_flight")
        # "Nova conversa" armada pelo painel (codex_next_fresh) — consome aqui:
        # próximo turno começa thread fresh e o flag é zerado.
        armed_fresh = bool(agent.get("codex_next_fresh"))
        effective_fresh = fresh or armed_fresh
        cwd = agent.get("workspace_path") or codex_reader.TARA_CWD
        thread = None
        if not effective_fresh:
            thread = await asyncio.to_thread(codex_reader.find_latest_thread, cwd)
        _spawn_tara_codex_input(
            cwd=cwd,
            text=text,
            thread_id=thread.thread_id if thread is not None else None,
            fresh=effective_fresh,
            image_path=image_path,
        )
        if armed_fresh:
            db: GrupoBorgesDB = request.app.state.db
            await db.update_agent_codex_state(slug, codex_next_fresh=0)


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
    canonical = {
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
    meta = detect_synthetic_kind(canonical["message"])
    if meta is not None:
        canonical["meta"] = meta
    return canonical


def _sse_json(event: str, data: dict[str, Any]) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


def _subagent_sse(data: dict[str, Any]) -> ServerSentEvent:
    return ServerSentEvent(
        event="subagent_status",
        data=json.dumps(data, ensure_ascii=False),
    )


def _ask_user_sse(data: dict[str, Any]) -> ServerSentEvent:
    return ServerSentEvent(
        event="ask_user",
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
        last_ask_user_seq = 0
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

            # ask_user — drena fila in-memory pra novos clientes verem requests
            # ainda pendentes (e o histórico answered/timeout recente). Avança
            # cursor pra não re-emitir no loop live.
            initial_ask_user_events, last_ask_user_seq = ask_user_events_since(
                slug,
                last_ask_user_seq,
            )
            seen_request_ids: set[str] = set()
            for event_payload in initial_ask_user_events:
                seen_request_ids.add(event_payload.get("request_id", ""))
                yield _ask_user_sse(_public_ask_user(event_payload))
            for snapshot in ask_user_active_snapshot(slug):
                if snapshot.get("request_id") not in seen_request_ids:
                    yield _ask_user_sse(_public_ask_user(snapshot))

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

                ask_user_events, last_ask_user_seq = ask_user_events_since(
                    slug,
                    last_ask_user_seq,
                )
                for event_payload in ask_user_events:
                    yield _ask_user_sse(_public_ask_user(event_payload))

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
    """Envia `payload.text` ao executor ativo do agente.

    - 404 quando agente não existe
    - 422 (Pydantic) em text vazio/>8KB ou idempotency_key vazio/>128
    - Codex: dispara `scripts/tara-codex` detached, retomando thread atual
      quando existir; 409 `codex_turn_in_flight` se Tara já está em turno.
    - 409 `agent_pane_unavailable` quando send_message=False (pane fora do
      CLI esperado — guard do tmux_driver, ex: user trocou window) no Claude Code
    - 200 + `tmux_delivered=True` no caminho feliz
    """
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") == "codex":
        await _spawn_codex_agent_turn(
            slug,
            request,
            text=payload.text,
            fresh=payload.fresh,
        )
        return InputResponse(tmux_delivered=True, sent_at=int(time.time()))

    delivered = await tmux_driver.send_message(agent["tmux_session"], payload.text)
    if not delivered:
        raise HTTPException(status_code=409, detail="agent_pane_unavailable")
    return InputResponse(tmux_delivered=True, sent_at=int(time.time()))


_VOICE_ALLOWED_MIMES = {"audio/ogg", "audio/webm", "audio/mp4", "audio/mpeg"}
_VOICE_MAX_BYTES = 10 * 1024 * 1024  # 10MB
def _resolve_stt_script() -> str:
    """Resolve o script de STT nos dois ambientes sem depender de .env.

    Override explícito via GB_STT_SCRIPT (convenção GB_* do projeto); senão
    tenta os caminhos conhecidos por host (Oracle usa ~/.claude/scripts;
    tropa usa o skill em ze-shared). Um hardcode único quebraria o outro host.
    """
    override = os.environ.get("GB_STT_SCRIPT")
    if override:
        return override
    candidates = [
        Path.home() / ".claude" / "scripts" / "stt-openai.sh",  # Oracle (casa nova)
        Path("/home/clawd/repos/ze_claude/ze-shared/.claude/skills/voz/scripts/stt-openai.sh"),  # Hostinger (tropa)
    ]
    return next(
        (str(candidate) for candidate in candidates if candidate.exists()),
        str(candidates[0]),
    )


_VOICE_STT_SCRIPT = _resolve_stt_script()
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
        except (FileNotFoundError, PermissionError) as e:
            raise HTTPException(
                status_code=502,
                detail=f"stt_script_not_found: {_VOICE_STT_SCRIPT}",
            ) from e

        if result.returncode != 0:
            stderr_tail = (result.stderr or "").strip().splitlines()
            last = stderr_tail[-1] if stderr_tail else "unknown"
            raise HTTPException(status_code=502, detail=f"stt_failed: {last}")

        transcribed = (result.stdout or "").strip()
        if not transcribed:
            raise HTTPException(status_code=502, detail="stt_empty")

        if agent.get("executor_kind") == "codex":
            await _spawn_codex_agent_turn(
                slug,
                request,
                text=transcribed,
            )
            duration_ms = int((time.monotonic() - started_at) * 1000)
            return {
                "transcribed": transcribed,
                "tmux_delivered": True,
                "duration_ms": duration_ms,
            }

        delivered = await tmux_driver.send_message(
            agent["tmux_session"], f"🎙 {transcribed}"
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

    if agent.get("executor_kind") == "codex":
        prompt = caption_text or "Veja a imagem anexa."
        await _spawn_codex_agent_turn(
            slug,
            request,
            text=prompt,
            image_path=str(absolute_path),
        )
        duration_ms = int((time.monotonic() - started_at) * 1000)
        log.info("agent %s: imagem salva %s", slug, absolute_path)
        return {
            "path": str(absolute_path),
            "tmux_delivered": True,
            "duration_ms": duration_ms,
        }

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
    """Troca modelo do agente.

    Dois caminhos por `executor_kind` (DS-69):

    **Claude Code** — troca em runtime via `/model <slug>`:
    - 422 (Pydantic) quando model fora do whitelist fable/opus/sonnet/haiku
    - 422 `model_not_allowed_for_claude_code` se vier slug Codex
    - 409 `agent_busy_confirm_required` quando lifecycle=trabalhando sem force
    - caminho feliz: envia `/model`, picker idempotente, poll de confirmação,
      persiste state_model só se delivered=True, emite task_event. runtime_switch=True.

    **Codex (Tara)** — NÃO troca em sessão viva (sem `/model`):
    - 422 `model_not_allowed_for_codex` se vier slug Claude
    - persiste state_model (escolha do Rica), emite task_event, runtime_switch=False.
      O wrapper `tara-codex` injeta `-m <modelo>` na PRÓXIMA execução.

    **Kimi (Hiro)** — NÃO troca em sessão viva (motor é fixo por env var no
    boot; `/model` do CC só lista aliases Anthropic, todos mapeados pro mesmo
    id Kimi). Mesmo contrato do Codex: persiste state_model, emite task_event,
    runtime_switch=False. Quem aplica é o boot (`subir-frota.sh subir_hiro`)
    e o wrapper `hiro-k3`, lendo o estado persistido.
    """
    agent = await _get_agent_or_404(request, slug)
    is_codex = agent.get("executor_kind") == "codex"
    is_kimi = agent.get("model_family") == "kimi"
    db: GrupoBorgesDB = request.app.state.db
    target = payload.model
    from_model = agent.get("state_model") or agent.get("model_default")

    # Allowlist cruzada: nunca aceitar slug de uma família em agente de outra.
    if is_codex and target not in _CODEX_MODEL_SLUGS:
        raise HTTPException(status_code=422, detail="model_not_allowed_for_codex")
    if is_kimi and target not in _KIMI_MODEL_SLUGS:
        raise HTTPException(status_code=422, detail="model_not_allowed_for_kimi")
    if not is_codex and not is_kimi and target in (_CODEX_MODEL_SLUGS | _KIMI_MODEL_SLUGS):
        raise HTTPException(status_code=422, detail="model_not_allowed_for_claude_code")

    if is_codex or is_kimi:
        # Persiste a escolha como estado do agente; vale na próxima execução
        # (Codex) ou no próximo boot da sessão (Kimi — env var de modelo é
        # lida só na subida do processo).
        await db.upsert_agent_state(slug, model=target)
        await db.insert_task_event(
            kind="agent.model_change",
            agent_slug=slug,
            payload={
                "from": from_model,
                "to": target,
                "actor": "cockpit",
                "confirmed": False,
                "runtime_switch": False,
            },
        )
        return ModelChangeResponse(
            tmux_delivered=False,
            state_persisted=True,
            confirmed=False,
            runtime_switch=False,
            model=target,
        )

    if agent.get("lifecycle_status") == "trabalhando" and not payload.force:
        raise HTTPException(status_code=409, detail="agent_busy_confirm_required")

    session = agent["tmux_session"]

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
        runtime_switch=True,
        model=target,
    )


# ----- TK-25: leitura read-only do Codex local (Tara) ---------------------
# Card/chat da Tara não têm pane Claude Code; os dados reais vivem no
# `~/.codex/state_5.sqlite` + rollout JSONL. Endpoints abaixo são SÓ leitura:
# nunca escrevem no SQLite do Codex e nunca expõem prompt de sistema/dev,
# reasoning ou tool I/O (filtrado em `services.codex_reader`).


class CodexThreadResponse(BaseModel):
    thread: dict[str, Any] | None


class CodexMessagesResponse(BaseModel):
    source: str
    thread_id: str | None
    model: str | None
    tokens_used: int | None
    updated_at_ms: int | None
    messages: list[dict[str, Any]]
    hidden_count: int


def _codex_db_path() -> str | None:
    # Override por env facilita teste/instância alternativa; default é o real.
    return os.environ.get("CODEX_STATE_DB") or str(codex_reader.STATE_DB)


async def _require_codex_agent(request: Request, slug: str) -> dict[str, Any]:
    agent = await _get_agent_or_404(request, slug)
    is_codex = agent.get("executor_kind") == "codex" or agent.get("cli_default") == "codex"
    if not is_codex:
        raise HTTPException(status_code=400, detail="not_a_codex_agent")
    return agent


@router.get("/{slug}/codex/thread", response_model=CodexThreadResponse)
async def get_codex_thread(slug: str, request: Request) -> CodexThreadResponse:
    """Resumo da thread Codex atual do agente (modelo, tokens, última atividade)."""
    agent = await _require_codex_agent(request, slug)
    cwd = agent.get("workspace_path") or codex_reader.TARA_CWD
    thread = await asyncio.to_thread(
        codex_reader.find_latest_thread, cwd, _codex_db_path()
    )
    return CodexThreadResponse(thread=thread.to_dict() if thread else None)


@router.get("/{slug}/codex/messages", response_model=CodexMessagesResponse)
async def get_codex_messages(
    slug: str,
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    include_internal: bool = Query(default=False),
) -> CodexMessagesResponse:
    """Histórico read-only da última thread Codex.

    Por padrão devolve só bolhas visíveis (user/assistant reais); itens internos
    (developer/system/reasoning/tool) entram só na contagem `hidden_count`.
    `include_internal=true` adiciona marcadores internos SEM texto (nunca vaza).
    """
    agent = await _require_codex_agent(request, slug)
    cwd = agent.get("workspace_path") or codex_reader.TARA_CWD
    thread, all_msgs = await asyncio.to_thread(
        codex_reader.read_latest_conversation, cwd, _codex_db_path()
    )

    hidden_count = sum(1 for m in all_msgs if not m.visible)
    selected = all_msgs if include_internal else [m for m in all_msgs if m.visible]
    selected = selected[-limit:]

    return CodexMessagesResponse(
        source=codex_reader.SOURCE,
        thread_id=thread.thread_id if thread else None,
        model=thread.model if thread else None,
        tokens_used=thread.tokens_used if thread else None,
        updated_at_ms=thread.updated_at_ms if thread else None,
        messages=[m.to_dict() for m in selected],
        hidden_count=hidden_count,
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


@router.post("/{slug}/clear")
async def post_agent_clear(slug: str, request: Request) -> dict[str, Any]:
    """Dispara `/clear` no CC do agente — limpa o contexto da sessão. Destrutivo:
    histórico da sessão vai embora (auto-memory persiste). Gate de UX é long-press
    no botão do painel — backend só entrega.
    """
    agent = await _get_agent_or_404(request, slug)
    delivered = await tmux_driver.send_message(agent["tmux_session"], "/clear")
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
