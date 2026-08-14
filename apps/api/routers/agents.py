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
POST /api/agents/{slug}/file           — upload imagem/vídeo/documento → path absoluto → send-keys
POST /api/agents/{slug}/model          — DS-2/DS-69: troca modelo (Claude /model em runtime · Codex persiste pra próxima exec)
GET  /api/agents/{slug}/codex/thread   — TK-25: resumo read-only da thread Codex atual (modelo/tokens/atividade)
GET  /api/agents/{slug}/codex/messages — TK-25: histórico read-only sanitizado da última thread Codex
POST /api/agents/{slug}/subagents/spawn — LB-9: tool MCP spawn_subsession via HTTP
GET  /api/agents/{slug}/subagents      — LB-9: snapshot de subsessões ativas (polling REST 5s)
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import logging
import os
import re
import signal
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, AsyncGenerator, Literal, NamedTuple, get_args

from fastapi import APIRouter, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from libtmux import exc as libtmux_exc
from pydantic import BaseModel, Field, StrictBool
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
from orchestrator.synthetic_message import (
    SyntheticMeta,
    detect_synthetic_kind,
    explicit_synthetic_meta,
)
from routers.ask_user import (
    ask_user_active_snapshot,
    ask_user_events_since,
    _public_event as _public_ask_user,
)
from services import codex_catalog, codex_reader, tmux_driver, workspace_reader
from services.session_reset import session_reset_events_since

router = APIRouter()
log = logging.getLogger(__name__)
voice_log = logging.getLogger("uvicorn.error")

_CLAUDE_HOME = Path.home() / ".claude"
_CLAUDE_JSON = Path.home() / ".claude.json"
_SECRET_KEY_RE = re.compile(r"token|secret|password|authorization", re.IGNORECASE)
_PLUGIN_INSTALL_PATH_KEYS = ("installPath", "install_path", "path", "dir")
_PLUGIN_ID_KEYS = ("id", "pluginId", "plugin_id")
_CLAUDE_AI_PREFIX = "claude.ai "
_PLUGIN_DISABLED_PREFIX = "plugin:"
_AGENT_PAINEL_ALLOWED_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
# Claude Code também aceita `auto`: ele restaura o default do modelo ativo
# (docs: https://code.claude.com/docs/en/commands e /en/model-config).
# Não misturar esta lista com Codex/Kimi — cada executor tem contrato próprio.
_CLAUDE_PAINEL_ALLOWED_EFFORTS = [*_AGENT_PAINEL_ALLOWED_EFFORTS, "auto"]
_AGENT_PAINEL_ALLOWED_MODELS = ["fable", "opus", "sonnet", "haiku"]
# Codex 0.146+ expõe `max` para o gpt-5.6-luna (catálogo `codex debug models`;
# Kimi já tinha max). Sem ele o PATCH rejeitava o teto que a UI oferece.
_CODEX_PAINEL_ALLOWED_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
# Kimi K3 (assinatura Kimi Code): o endpoint expõe think_efforts low/high/max
# (default high) — medium/xhigh NÃO existem no motor. Validado 19/07 via
# GET api.kimi.com/coding/v1/models.
_KIMI_PAINEL_ALLOWED_EFFORTS = ["low", "high", "max"]
# Domínio do que a statusline REPORTA, que não é o domínio do que a UI oferece.
# A doc lista `effort.level` como low/medium/high/xhigh/max e trata `auto` só
# como argumento ("reset to the model default") — a palavra nunca chega no JSON,
# como `_poll_claude_effort` já descrevia. Validar leitura pela lista do seletor
# aceitaria um `auto` que não existe e, do outro lado, descartaria o `xhigh` que
# um agente Kimi de fato roda. São listas separadas de propósito.
_STATUSLINE_REPORTED_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
_CODEX_ALLOWED_SANDBOXES = ["read-only", "workspace-write", "danger-full-access"]
_CODEX_DEFAULT_SANDBOX = "danger-full-access"
_AGENT_PAINEL_QUOTA_STALE_AFTER_SECONDS = 20
# Codex é mais generoso porque a cota dele só chega em evento (webhook por
# turno), não num arquivo de status reescrito de segundo em segundo como o CC.
# Com 20s a Tara apareceria "stale" entre um turno e o seguinte, trabalhando.
_CODEX_PAINEL_QUOTA_STALE_AFTER_SECONDS = 300
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
# `ultra` só existe em parte do catálogo Codex (gpt-5.6-sol/terra) e chegou
# depois desta lista. Quem decide o que é aceitável é a escala do modelo, lida
# em `_codex_efforts_permitidos` — este Literal é só a porta de entrada, e uma
# porta que barrasse `ultra` faria o painel oferecer um degrau que o PATCH
# recusa com 422.
AgentPainelEffortValue = Literal["low", "medium", "high", "xhigh", "max", "ultra", "auto"]
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
    #: O nome que o Rica deu com `/rename`. Ausente até alguém nomear a sessão —
    #: o nome de exibição padrão (`my-app-3f`) não preenche o campo.
    session_name: str | None = None
    #: `None` = a statusline daquele agente ainda não reporta o campo. Distinguir
    #: de `False` importa: `False` é "não cruzou", `None` é "não sei".
    exceeds_200k: bool | None = None


class AgentPainelEffort(BaseModel):
    value: str | None = None
    allowed: list[str] = Field(default_factory=lambda: list(_AGENT_PAINEL_ALLOWED_EFFORTS))
    source: str
    session_may_diverge: bool = True
    # O que o painel pediu, preenchido só quando `value` veio de fonte viva. A UI
    # compara os dois: iguais não dizem nada, diferentes significam que a troca
    # não pegou, e `requested=None` com `value` lido significa que ninguém
    # escolheu — é o default do motor, não uma decisão de alguém.
    requested: str | None = None


class AgentPainelModel(BaseModel):
    value: str | None = None
    allowed: list[str] = Field(default_factory=lambda: list(_AGENT_PAINEL_ALLOWED_MODELS))
    source: str
    session_may_diverge: bool = True
    runtime_switch: bool = True


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


class AgentPainelConta(BaseModel):
    email: str | None = None
    display_name: str | None = None


class AgentPainelQuotas(BaseModel):
    status: Literal["available", "missing", "stale", "unknown"]
    source: str | None = None
    session_id: str | None = None
    updated_at: int | None = None
    stale_after_seconds: int = _AGENT_PAINEL_QUOTA_STALE_AFTER_SECONDS
    five_hour: AgentPainelQuotaWindow | None = None
    seven_day: AgentPainelQuotaWindow | None = None
    #: Quem paga esta cota. Mora junto da cota porque é a mesma pergunta.
    #: Só no Claude: Kimi e Codex têm login próprio, fora do `.claude.json`.
    conta: AgentPainelConta | None = None


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


class AgentPainelCanalEntrega(BaseModel):
    estado: Literal["entregando", "bloqueado", "sem_dados"]
    entregando: bool | None
    motivo: str | None = None
    mensagem: str
    recusas_consecutivas: int
    bloqueado_desde: int | None = None
    bloqueado_ha_segundos: int
    ultima_tentativa_em: int | None = None
    acao_recomendada: str


class AgentPainelVida(BaseModel):
    """Se o agente está de pé — as DUAS metades, porque elas divergem.

    O `TmuxSessionInventory` já separava as duas desde sempre; o painel é que
    não expunha, e o front só tinha `offline` pra tudo. A diferença é o que
    decide qual botão o Rica vê:

    - `sessao=False` — DESLIGADO. Não há o que destravar nem o que retomar.
    - `sessao=True, processo=False` — CASCA MORTA: a sessão tmux está de pé com
      o pane em bash cru (foi o core dump que matou lucas, barsi e felipe em
      09/08). Aqui Destravar e Resume devolvem `attempted:false` em silêncio —
      o Rica clicava e não acontecia nada, sem erro na tela. Ligar é a saída.
    - `sessao=True, processo=True` — VIVO.
    """

    sessao: bool
    processo: bool


class AgentPainelResponse(BaseModel):
    slug: str
    generated_at: int
    vida: AgentPainelVida
    contexto: AgentPainelContexto
    model: AgentPainelModel | None = None
    effort: AgentPainelEffort
    permission: AgentPainelPermission
    quotas: AgentPainelQuotas
    subagents: AgentPainelSubagents
    canal_entrega: AgentPainelCanalEntrega
    sandbox: AgentPainelSandbox | None = None
    codex_native: bool | None = None
    codex_next_fresh: bool | None = None
    codex_turn_in_flight: bool | None = None


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
    # Presentes apenas no caminho Claude Code; opcionais preservam o contrato
    # enxuto dos caminhos persist-only de Codex e Kimi.
    tmux_delivered: bool | None = None
    confirmed: bool | None = None
    runtime_switch: bool | None = None


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


class _InputOrigin(NamedTuple):
    meta: SyntheticMeta


async def _send_tmux_or_409(
    session_name: str,
    text: str,
    *,
    input_origin: _InputOrigin | None = None,
    db: GrupoBorgesDB | None = None,
    agent_slug: str | None = None,
) -> bool:
    """Envia ao pane ou distingue contenção transitória de pane indisponível.

    Reduz o resultado a bool porque o contrato HTTP destes endpoints é bool. O
    motivo e o desfecho (recusado × incerto) ficam no log do canal e em
    ``get_delivery_channel_state``; enriquecer a resposta é outro commit.
    """
    origin_id: str | None = None
    if input_origin is not None:
        if db is None or agent_slug is None:
            raise RuntimeError("input_origin requer db e agent_slug")
        origin_id = await db.create_message_origin(
            agent_slug=agent_slug,
            executor_kind="tmux",
            expected_text=text,
            meta=input_origin.meta,
        )
    try:
        delivered = (await tmux_driver.send_message(session_name, text)).delivered
    except tmux_driver.TmuxSessionBusyError as exc:
        if origin_id is not None:
            await db.discard_message_origin(origin_id)
        raise HTTPException(status_code=409, detail="agent_tmux_busy") from exc
    except Exception:
        if origin_id is not None:
            await db.discard_message_origin(origin_id)
        raise
    if not delivered and origin_id is not None:
        await db.discard_message_origin(origin_id)
    return delivered


async def _build_painel_vida(agent: dict[str, Any]) -> AgentPainelVida:
    """Lê o inventário do tmux e separa sessão de processo.

    Falha de observação NÃO vira "desligado": o `list_session_inventory`
    propaga erro de propósito para não marcar a frota inteira como offline por
    um `list-panes` que não rodou, e aqui um falso desligado trocaria os botões
    do Rica pelo Ligar bem no meio de um agente vivo. Sem leitura confiável, a
    resposta é a que preserva os controles.
    """
    try:
        inventario = await tmux_driver.list_session_inventory()
    except libtmux_exc.LibTmuxException:
        log.warning("painel: inventário tmux indisponível para %s", agent.get("slug"))
        return AgentPainelVida(sessao=True, processo=True)

    sessao = agent["tmux_session"]
    return AgentPainelVida(
        sessao=sessao in inventario.sessions,
        processo=sessao in inventario.claude_process_sessions,
    )


@router.get(
    "/{slug}/painel",
    response_model=AgentPainelResponse,
)
async def get_agent_painel(slug: str, request: Request) -> AgentPainelResponse:
    db: GrupoBorgesDB = request.app.state.db
    agent = await _get_agent_or_404(request, slug)
    vida = await _build_painel_vida(agent)
    if agent.get("executor_kind") == "codex":
        thread = await asyncio.to_thread(_resolve_codex_thread, agent)
        contexto = _build_codex_painel_contexto(agent, thread)
        return AgentPainelResponse(
            slug=slug,
            generated_at=int(time.time()),
            vida=vida,
            contexto=contexto,
            model=_build_painel_model(agent, contexto),
            effort=_build_codex_painel_effort(agent, thread),
            permission=_read_agent_permission(),
            quotas=_build_codex_painel_quotas(agent, thread),
            subagents=AgentPainelSubagents(count=0, active_count=0, items=[]),
            canal_entrega=tmux_driver.get_delivery_channel_state(agent["tmux_session"]),
            sandbox=_build_codex_painel_sandbox(agent),
            codex_native=True,
            codex_next_fresh=bool(agent.get("codex_next_fresh")),
            codex_turn_in_flight=_codex_turn_in_flight(agent),
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
        # Kimi: o pedido mora em agent_state (vira env var no próximo boot), mas
        # o nível em vigor é o que a statusline da sessão reporta — o settings.json
        # global mostraria o effort dos agentes Anthropic e os 5 níveis que o
        # motor não tem.
        asyncio.to_thread(_build_kimi_painel_effort, agent, cc_status)
        if is_kimi
        else asyncio.to_thread(_build_claude_painel_effort, agent, cc_status),
        asyncio.to_thread(_read_agent_permission),
        asyncio.to_thread(_build_kimi_painel_quotas, kimi_usages)
        if kimi_usages is not None
        else asyncio.to_thread(_build_painel_quotas, cc_status),
        asyncio.to_thread(_build_agent_subagents, agent.get("workspace_path")),
    )
    return AgentPainelResponse(
        slug=slug,
        generated_at=int(time.time()),
        vida=vida,
        contexto=contexto,
        model=_build_painel_model(agent, contexto),
        effort=effort,
        permission=permission,
        quotas=quotas,
        subagents=subagents,
        canal_entrega=tmux_driver.get_delivery_channel_state(agent["tmux_session"]),
    )


@router.patch(
    "/{slug}/effort",
    response_model=AgentPainelEffortPatchResponse,
    response_model_exclude_none=True,
)
async def patch_agent_effort(
    slug: str,
    patch: AgentPainelEffortPatchRequest,
    request: Request,
) -> AgentPainelEffortPatchResponse:
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") == "codex":
        # A escala é a do modelo corrente, a mesma que o painel ofereceu — uma
        # constante aqui recusaria o `ultra` do gpt-5.6-sol e aceitaria o `max`
        # que o gpt-5.5 não tem.
        thread = await asyncio.to_thread(_resolve_codex_thread, agent)
        if patch.effort not in _codex_efforts_permitidos(agent, thread):
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

    # `ultra` entrou no Literal por causa do catálogo Codex; o Claude Code não
    # tem esse degrau, e sem esta porta um `/effort ultra` chegaria à sessão viva.
    if patch.effort not in _CLAUDE_PAINEL_ALLOWED_EFFORTS:
        raise HTTPException(status_code=422, detail="claude_effort_not_allowed")

    # Claude Code aplica esforço vivo pelo slash command. O próprio comando
    # persiste o default para novas sessões; escrever ~/.claude/settings.json
    # aqui seria redundante e vazaria a escolha para os outros agentes.
    before = await _load_cc_status(request.app.state.db, slug)
    session = agent["tmux_session"]
    delivered = await _send_tmux_or_409(session, f"/effort {patch.effort}")
    confirmed = False
    confirmed_status: _CCStatus | None = None
    if delivered:
        # Igual ao endpoint /model: Enter separado cobre o picker/slider sem
        # depender de o comando já ter sido submetido pelo driver.
        await asyncio.sleep(0.3)
        await tmux_driver.press_enter(session)
        confirmed, confirmed_status = await _poll_claude_effort(
            request.app.state.db,
            slug,
            patch.effort,
            before,
        )

    source = (
        str(confirmed_status.path)
        if confirmed_status is not None and confirmed_status.path is not None
        else str(before.path)
        if before.path is not None
        else "claude_code.runtime"
    )
    return AgentPainelEffortPatchResponse(
        slug=slug,
        effort=patch.effort,
        source=source,
        session_may_diverge=not confirmed,
        written=True,
        tmux_delivered=delivered,
        confirmed=confirmed,
        runtime_switch=True,
    )


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
    """Arma a próxima conversa da Tara como thread NOVA (opção A, 10/08).

    Antes pedia thread nova ao daemon telecodex (a sessão interativa do tmux);
    com o cockpit headless, "Nova conversa" é um flag consumido no próximo
    `/input` (`codex_next_fresh`), que o spawn usa pra nascer sem
    `--resume-thread`. O telecodex tem canal próprio — o cockpit não compete.
    """
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") != "codex":
        raise HTTPException(status_code=400, detail="not_a_codex_agent")
    db: GrupoBorgesDB = request.app.state.db
    if patch.armed:
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


def _string_or_none(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _num_or_none(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _resolve_codex_thread(agent: dict[str, Any]) -> codex_reader.CodexThread | None:
    """A thread que o painel descreve é a do delegator COCKPIT — só ela.

    Lê o store por delegator (`~/.tara/threads/cockpit.txt`), como o resto do
    painel já faz, em vez do `codex_thread_id` do agent_state: aquele campo é
    único, e bastava um caminho novo escrevê-lo pra gaveta voltar a descrever o
    run de outro delegator (era o que acontecia até 4cc2bc7).

    Só a FONTE do id muda. Sem thread do cockpit, `resolve_thread` segue caindo
    na busca por cwd — decisão de desenho deste painel, que prefere número
    velho carimbado de `stale` a gaveta vazia (o `/codex/messages` escolhe o
    contrário porque bolha errada não tem como se carimbar).
    """
    return codex_reader.resolve_thread(
        thread_id=codex_reader.read_cockpit_thread_id(),
        cwd=agent.get("workspace_path") or codex_reader.TARA_CWD,
        db_path=_codex_db_path() or codex_reader.STATE_DB,
    )


def _codex_contexto_stale(agent: dict[str, Any], observed_at: int | None) -> bool:
    """Duas maneiras de o número estar velho — e nenhuma pode sair como `False`.

    A idade em segundos é a régua óbvia. A outra é a que pegou este defeito:
    medida ANTERIOR ao início da sessão é de outro run, mesmo que o relógio
    ainda não tenha estourado o limite. Sem carimbo não há como afirmar frescor,
    e afirmar é justamente o defeito grave — velho passa por atual.
    """
    if observed_at is None:
        return True
    session_started_at = _int_or_none(agent.get("session_started_at"))
    if session_started_at is not None and observed_at < session_started_at:
        return True
    return int(time.time()) - observed_at > _AGENT_PAINEL_CONTEXTO_STALE_AFTER_SECONDS


def _build_codex_painel_contexto(
    agent: dict[str, Any],
    thread: codex_reader.CodexThread | None,
) -> AgentPainelContexto:
    usage_payload, source = _codex_token_usage_payload(agent, thread)
    model = (
        thread.model
        if thread is not None and thread.model
        else agent.get("state_model") or agent.get("model_default")
    )
    if usage_payload is not None:
        tokens_used = _int_or_none(usage_payload.get("context_tokens")) or 0
        context_window = _int_or_none(usage_payload.get("model_context_window"))
        pct = _num_or_none(usage_payload.get("context_pct"))
        available = True
        # O carimbo é o da MEDIDA (`observed_at`), não o da thread: a thread
        # anda a cada item do turno e diria "de agora" sobre um número parado.
        observed_at = _int_or_none(usage_payload.get("observed_at"))
    else:
        tokens_used = thread.tokens_used if thread is not None else 0
        context_window = None
        pct = None
        available = thread is not None
        observed_at = None
    return AgentPainelContexto(
        model=model,
        model_family=_model_family(model),
        context_window=context_window,
        tokens=AgentPainelTokens(total=tokens_used),
        pct=pct,
        source=source,
        updated_at=observed_at,
        available=available,
        stale=available and _codex_contexto_stale(agent, observed_at),
    )


def _codex_token_usage_payload(
    agent: dict[str, Any],
    thread: codex_reader.CodexThread | None = None,
) -> tuple[dict[str, Any] | None, str]:
    """Devolve o número E de onde ele veio.

    O painel carimbava `agent_state.token_usage_json` nos dois caminhos. Só que
    o `token_usage_json` escrito por `codex.turn.completed` é recusado logo
    abaixo, e o valor sai do rollout — declarar a fonte errada mandou a
    investigação deste defeito pro arquivo errado.
    """
    raw = agent.get("token_usage_json")
    if not isinstance(raw, str) or not raw.strip():
        payload = None
    else:
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            payload = None
    if isinstance(payload, dict) and payload.get("source") == "codex.event_msg.token_count":
        return payload, "agent_state.token_usage_json"
    if thread is None:
        return None, "agent_state.token_usage_json"
    return codex_reader.read_latest_token_count(thread.rollout_path), thread.rollout_path


def _build_codex_painel_effort(
    agent: dict[str, Any], thread: codex_reader.CodexThread | None
) -> AgentPainelEffort:
    """O nível que o run está usando, com o pedido ao lado quando divergem.

    `threads.reasoning_effort` é a configuração do run em execução; o
    `agent_state` guarda o que alguém clicou, que só vale no run seguinte. Servir
    o pedido como se fosse o estado esconde justamente o caso em que a troca não
    pegou. O valor lido não passa por allowlist — quem o escreveu foi o próprio
    Codex, e filtrá-lo pela lista do seletor repetiria o erro de `auto`.

    A escala OFERECIDA, porém, é a do modelo que está rodando, não uma constante:
    `gpt-5.6-sol` vai até `ultra`, `gpt-5.5` para em `xhigh`. A lista fixa
    oferecia `max` num modelo que não tem `max`.
    """
    allowed = _codex_efforts_permitidos(agent, thread)
    # O PEDIDO não passa pela escala do modelo CORRENTE, só pela lista do que é
    # nível de esforço em algum lugar. O Rica escolheu `ultra` com a Tara no
    # Sol e depois trocou pro Luna, que não tem esse degrau: filtrar aqui pela
    # escala do Luna zerava o `requested` e a tela dizia "padrão" — isto é,
    # "ninguém escolheu" — sobre uma escolha que ele fez. A escala estreita
    # governa o que se OFERECE e o que o PATCH aceita, não o que foi gravado.
    requested = agent.get("codex_reasoning_effort")
    if requested not in _codex_efforts_conhecidos():
        requested = None

    effective = _string_or_none(thread.reasoning_effort) if thread is not None else None
    if effective is None:
        # Sem thread legível não há o que reportar: cai no pedido, avisando que
        # a sessão pode estar em outro lugar.
        return AgentPainelEffort(
            value=requested,
            allowed=list(allowed),
            source="agent_state.codex_reasoning_effort",
            session_may_diverge=True,
        )

    return AgentPainelEffort(
        value=effective,
        allowed=list(allowed),
        source="codex.threads.reasoning_effort",
        session_may_diverge=False,
        requested=requested,
    )


def _codex_slug_canonico(valor: str | None) -> str | None:
    """Normaliza pro `codex-*` do cockpit, venha cru ou já canônico.

    As duas grafias existem de verdade: o rollout guarda o nome cru
    (`gpt-5.6-luna`) e o `state_model` guarda o canônico
    (`codex-gpt-5-6-luna`). Sem normalizar, o menu não marcaria como
    selecionado o modelo que está rodando.
    """
    if valor is None:
        return None
    return valor if valor.startswith("codex-") else codex_catalog.canonical_slug(valor)


def _codex_modelo_corrente(
    agent: dict[str, Any], thread: codex_reader.CodexThread | None
) -> str | None:
    """Slug canônico do modelo que a Tara está rodando agora.

    A thread ganha do estado persistido pelo mesmo motivo do esforço: o
    persistido é o pedido, a thread é o fato.
    """
    da_thread = _codex_slug_canonico(_string_or_none(thread.model) if thread is not None else None)
    if da_thread is not None:
        return da_thread
    return _codex_slug_canonico(_string_or_none(agent.get("state_model"))) or _codex_slug_canonico(
        _string_or_none(agent.get("model_default"))
    )


def _codex_efforts_conhecidos() -> frozenset[str]:
    """Tudo que é degrau de esforço em ALGUM modelo do catálogo.

    Serve só para separar um nível real de lixo no banco. Não é o que se
    oferece — isso é por modelo, em `_codex_efforts_permitidos`.
    """
    do_catalogo = {e for m in codex_catalog.listar_modelos() for e in m.efforts}
    return frozenset(do_catalogo | set(_CODEX_PAINEL_ALLOWED_EFFORTS))


def _codex_efforts_permitidos(
    agent: dict[str, Any], thread: codex_reader.CodexThread | None
) -> tuple[str, ...]:
    """Escala do modelo corrente, com a lista histórica como rede.

    Só cai na constante quando o catálogo não pôde ser lido ou o modelo não está
    nele — sem rede, uma falha do CLI deixaria o Rica sem seletor de esforço
    nenhum, o que é pior que oferecer um degrau a mais.
    """
    do_modelo = codex_catalog.efforts_do_modelo(_codex_modelo_corrente(agent, thread))
    return do_modelo or tuple(_CODEX_PAINEL_ALLOWED_EFFORTS)


def _build_kimi_painel_effort(
    agent: dict[str, Any], cc_status: _CCStatus
) -> AgentPainelEffort:
    """O nível em vigor na sessão, com o pedido ao lado quando divergem.

    O Kimi roda dentro do Claude Code, então a statusline dele reporta o esforço
    vivo igual à de qualquer agente Anthropic. O `agent_state` guarda o pedido,
    que o `subir-frota.sh` transforma em `CLAUDE_CODE_EFFORT_LEVEL` no boot
    seguinte — e quando essa leitura falha na janela de boot, o `unset` deixa a
    sessão no default do CC sem ninguém saber. Servir o pedido esconderia
    exatamente esse caso.

    O valor lido NÃO é filtrado pela trinca do motor: `xhigh` é um nível que o
    seletor não oferece e que a sessão do Hiro de fato roda. Mostrar o estado
    verdadeiro não obriga a poder pedi-lo — `allowed` segue sendo low/high/max.
    """
    requested = agent.get("kimi_reasoning_effort")
    if requested not in _KIMI_PAINEL_ALLOWED_EFFORTS:
        requested = None

    effective = _cc_effort_level(cc_status.payload)
    if effective is None or cc_status.path is None:
        return AgentPainelEffort(
            value=requested,
            allowed=list(_KIMI_PAINEL_ALLOWED_EFFORTS),
            source="agent_state.kimi_reasoning_effort",
            session_may_diverge=True,
        )

    return AgentPainelEffort(
        value=effective,
        allowed=list(_KIMI_PAINEL_ALLOWED_EFFORTS),
        source=str(cc_status.path),
        session_may_diverge=cc_status.fell_back,
        requested=requested,
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


def _cc_effort_level(payload: dict[str, Any] | None) -> str | None:
    effort = payload.get("effort") if isinstance(payload, dict) else None
    level = effort.get("level") if isinstance(effort, dict) else None
    return level if level in _STATUSLINE_REPORTED_EFFORTS else None


async def _poll_claude_effort(
    db: GrupoBorgesDB,
    slug: str,
    target: AgentPainelEffortValue,
    before: _CCStatus,
) -> tuple[bool, _CCStatus | None]:
    """Confirma `/effort` no JSON da statusline da sessão alvo.

    Schema documentado em https://code.claude.com/docs/en/statusline.

    A statusline pode rodar em sessões simultâneas, então um arquivo de uma
    sessão anterior nunca confirma a troca. `auto` é especial: o CC expõe no
    JSON o nível efetivo do modelo, não a palavra `auto`; nesse caso exigimos
    uma atualização do arquivo ou uma mudança do nível observado.
    """
    before_level = _cc_effort_level(before.payload)
    before_updated_at = _int_or_none(before.payload.get("updated_at")) if before.payload else None
    before_session_id = before.session_id if not before.fell_back else None
    latest: _CCStatus | None = None

    for _ in range(3):
        await asyncio.sleep(0.5)
        candidate = await _load_cc_status(db, slug)
        latest = candidate
        if candidate.fell_back or candidate.payload is None:
            continue
        if before_session_id is not None and candidate.session_id != before_session_id:
            continue
        level = _cc_effort_level(candidate.payload)
        if level is None:
            continue
        if target != "auto" and level == target:
            return True, candidate
        if target == "auto":
            updated_at = _int_or_none(candidate.payload.get("updated_at"))
            if before_level is None or level != before_level or (
                updated_at is not None
                and (before_updated_at is None or updated_at > before_updated_at)
            ):
                return True, candidate

    return False, latest


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
    session_name = payload.get("session_name")
    session_name = session_name if isinstance(session_name, str) and session_name else None
    exceeds = payload.get("exceeds_200k_tokens")
    exceeds = exceeds if isinstance(exceeds, bool) else None
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
            session_name=session_name,
            exceeds_200k=exceeds,
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
        session_name=session_name,
        exceeds_200k=exceeds,
    )


def _claude_model_slug(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    lowered = value.lower()
    return next((model for model in _AGENT_PAINEL_ALLOWED_MODELS if model in lowered), None)


def _build_codex_painel_model(
    agent: dict[str, Any], contexto: AgentPainelContexto
) -> AgentPainelModel | None:
    """O que a Tara está rodando, ao lado do que o harness dela oferece.

    Este bloco devolvia `None`, e por isso o seletor dela nunca teve menu: sem
    `allowed`, a pele cai no rótulo estático da statusline e o Rica via um
    modelo só. O catálogo é lido do CLI (`services.codex_catalog`) porque a
    allowlist escrita à mão já tinha divergido do binário.

    `value` prefere o modelo da THREAD (`contexto.model`, nome cru que o próprio
    Codex gravou no rollout) sobre o `state_model` persistido: o persistido é o
    que alguém clicou, e ele só vale no run seguinte. Servir o clique como se
    fosse o estado esconderia justamente o caso em que a troca não pegou —
    mesma régua já aplicada ao esforço em `_build_codex_painel_effort`.

    `runtime_switch=False` porque o Codex CLI não troca de modelo em sessão
    viva: quem aplica é o `-m` que o wrapper `tara-codex` injeta na próxima
    execução.
    """
    permitidos = codex_catalog.listar_modelos()
    if not permitidos:
        # Catálogo ilegível: sem lista, o menu não pode ser oferecido. Ainda
        # assim devolvemos o valor, para o painel dizer o que está rodando.
        return AgentPainelModel(
            value=_codex_slug_canonico(_string_or_none(agent.get("state_model"))),
            allowed=[],
            source="agent.state_model",
            runtime_switch=False,
        )

    allowed = [modelo.slug for modelo in permitidos]

    da_thread = (
        _codex_slug_canonico(contexto.model) if contexto.available and contexto.model else None
    )
    if da_thread is not None:
        return AgentPainelModel(
            value=da_thread,
            allowed=allowed,
            source=contexto.source,
            session_may_diverge=False,
            runtime_switch=False,
        )

    return AgentPainelModel(
        value=_codex_slug_canonico(_string_or_none(agent.get("state_model")))
        or _codex_slug_canonico(_string_or_none(agent.get("model_default"))),
        allowed=allowed,
        source="agent.state_model",
        runtime_switch=False,
    )


def _build_painel_model(
    agent: dict[str, Any], contexto: AgentPainelContexto
) -> AgentPainelModel | None:
    if agent.get("executor_kind") == "codex":
        return _build_codex_painel_model(agent, contexto)
    if agent.get("model_family") == "kimi":
        return None

    status_model = _claude_model_slug(contexto.model)
    if status_model is not None and contexto.available and not contexto.stale:
        return AgentPainelModel(
            value=status_model,
            source=contexto.source,
            session_may_diverge=False,
        )

    state_model = _claude_model_slug(agent.get("state_model"))
    if state_model is not None:
        return AgentPainelModel(
            value=state_model,
            source="agent.state_model",
        )

    return AgentPainelModel(
        value=_claude_model_slug(agent.get("model_default")),
        source="agent.model_default",
    )


def _build_claude_painel_effort(
    agent: dict[str, Any], cc_status: _CCStatus
) -> AgentPainelEffort:
    value = _cc_effort_level(cc_status.payload)
    if value is not None and cc_status.path is not None:
        updated_at = _int_or_none(cc_status.payload.get("updated_at")) if cc_status.payload else None
        stale = cc_status.fell_back or (
            updated_at is not None
            and int(time.time()) - updated_at > _AGENT_PAINEL_CONTEXTO_STALE_AFTER_SECONDS
        )
        return AgentPainelEffort(
            value=value,
            allowed=list(_CLAUDE_PAINEL_ALLOWED_EFFORTS),
            source=str(cc_status.path),
            session_may_diverge=stale,
        )

    # Compatibilidade para sessões que ainda não produziram statusline: isto
    # só lê o default global, nunca o escreve no caminho runtime acima.
    settings = _read_agent_effort()
    return AgentPainelEffort(
        value=settings.value,
        allowed=list(_CLAUDE_PAINEL_ALLOWED_EFFORTS),
        source=settings.source,
        session_may_diverge=True,
    )


def _read_agent_effort() -> AgentPainelEffort:
    settings_path = _agent_painel_settings_path()
    settings = _read_json_file(settings_path, {})
    value = settings.get("effortLevel") if isinstance(settings, dict) else None
    if value is not None:
        value = str(value)
    return AgentPainelEffort(
        value=value,
        allowed=list(_CLAUDE_PAINEL_ALLOWED_EFFORTS),
        source=str(settings_path),
    )


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


def _quota_window_expired(window: AgentPainelQuotaWindow | None, now: int) -> bool:
    """`resets_at` no passado prova que o `used_percentage` veio de uma consulta
    velha: o CC não reconsulta rate_limits sozinho durante a sessão, só quando
    ela nasce de novo (ver shared_rate_limits_congela_ate_clear.md). Sinal
    lógico, não heurístico — vale mesmo com o arquivo sendo reescrito agora."""
    return (
        window is not None
        and window.resets_at is not None
        and window.resets_at <= now
        and window.used_percentage is not None
    )


#: `~/.claude.json` tem ~100KB e parsear custa 4ms no caso bom, 36ms no ruim —
#: caro demais pra repetir a cada `/painel`. O arquivo só muda no `/login`, que
#: é raro, então a chave do cache é `(mtime_ns, size)`: um `stat` custa
#: microssegundos e pega qualquer reescrita.
_CLAUDE_CONFIG_PATH = Path.home() / ".claude.json"
_conta_cache: tuple[tuple[int, int], AgentPainelConta | None] | None = None


def _ler_conta_claude() -> AgentPainelConta | None:
    """A conta Claude ativa da máquina — uma só, global.

    Não é por sessão: o CC segue o `.credentials.json` do disco em tempo real,
    e um `/login` troca a conta de todos os agentes vivos sem reiniciar
    ninguém (medido em 14/08 — duas sessões de horas antes migraram sozinhas).
    """
    global _conta_cache
    try:
        stat = _CLAUDE_CONFIG_PATH.stat()
    except OSError:
        return None

    chave = (stat.st_mtime_ns, stat.st_size)
    if _conta_cache is not None and _conta_cache[0] == chave:
        return _conta_cache[1]

    conta: AgentPainelConta | None = None
    try:
        with _CLAUDE_CONFIG_PATH.open(encoding="utf-8") as handle:
            oauth = json.load(handle).get("oauthAccount")
    except (OSError, ValueError):
        oauth = None
    if isinstance(oauth, dict):
        email = oauth.get("emailAddress")
        display = oauth.get("displayName")
        if isinstance(email, str) or isinstance(display, str):
            conta = AgentPainelConta(
                email=email if isinstance(email, str) else None,
                display_name=display if isinstance(display, str) else None,
            )

    _conta_cache = (chave, conta)
    return conta


def _build_painel_quotas(cc_status: _CCStatus) -> AgentPainelQuotas:
    # A conta entra mesmo sem leitura de cota: quem paga não depende de o agente
    # ter reportado a linha de status.
    conta = _ler_conta_claude()
    if cc_status.session_id is None:
        return AgentPainelQuotas(status="missing", conta=conta)
    source = str(cc_status.path) if cc_status.path else None
    if cc_status.payload is None:
        return AgentPainelQuotas(
            status="missing", source=source, session_id=cc_status.session_id, conta=conta
        )

    payload = cc_status.payload
    now = int(time.time())
    updated_at = _int_or_none(payload.get("updated_at"))
    status: Literal["available", "missing", "stale", "unknown"] = "available"
    if updated_at is None:
        status = "unknown"
    elif now - updated_at > _AGENT_PAINEL_QUOTA_STALE_AFTER_SECONDS:
        status = "stale"

    rate_limits = payload.get("rate_limits") if isinstance(payload.get("rate_limits"), dict) else {}
    five_hour = _quota_window(rate_limits.get("five_hour"), now)
    seven_day = _quota_window(rate_limits.get("seven_day"), now)
    if status == "available" and (
        _quota_window_expired(five_hour, now) or _quota_window_expired(seven_day, now)
    ):
        status = "stale"

    return AgentPainelQuotas(
        status=status,
        source=source,
        session_id=cc_status.session_id,
        updated_at=updated_at,
        five_hour=five_hour,
        seven_day=seven_day,
        conta=conta,
    )


def _codex_quota_window(raw: Any, now: int) -> AgentPainelQuotaWindow | None:
    if not isinstance(raw, dict):
        return None
    used_percentage = _num_or_none(raw.get("used_percent"))
    if used_percentage is None:
        used_percentage = _num_or_none(raw.get("used_percentage"))
    resets_at = _int_or_none(raw.get("resets_at"))
    return AgentPainelQuotaWindow(
        used_percentage=used_percentage,
        resets_at=resets_at,
        remaining_seconds=max(0, resets_at - now) if resets_at is not None else None,
    )


def _build_codex_painel_quotas(
    agent: dict[str, Any],
    thread: codex_reader.CodexThread | None = None,
) -> AgentPainelQuotas:
    usage_payload, source = _codex_token_usage_payload(agent, thread)
    if usage_payload is None:
        return AgentPainelQuotas(
            status="missing",
            source=source,
            stale_after_seconds=_CODEX_PAINEL_QUOTA_STALE_AFTER_SECONDS,
        )
    rate_limits = usage_payload.get("rate_limits")
    if not isinstance(rate_limits, dict):
        return AgentPainelQuotas(
            status="missing",
            source=source,
            stale_after_seconds=_CODEX_PAINEL_QUOTA_STALE_AFTER_SECONDS,
        )

    now = int(time.time())
    five_hour = None
    seven_day = None
    for key in ("primary", "secondary"):
        window_raw = rate_limits.get(key)
        if not isinstance(window_raw, dict):
            continue
        window_minutes = _int_or_none(window_raw.get("window_minutes"))
        if window_minutes == 300:
            five_hour = _codex_quota_window(window_raw, now)
        elif window_minutes == 10080:
            seven_day = _codex_quota_window(window_raw, now)

    # `observed_at` é o instante em que a origem mediu a cota. Carimbar `now`
    # aqui fazia a cota nunca envelhecer: Tara parada há horas mostrava dado
    # "de agora". Payload gravado antes deste campo existir vira `unknown` —
    # é honesto, a idade dele é desconhecida.
    observed_at = _int_or_none(usage_payload.get("observed_at"))
    if five_hour is None and seven_day is None:
        status: Literal["available", "missing", "stale", "unknown"] = "missing"
    elif observed_at is None:
        status = "unknown"
    elif now - observed_at > _CODEX_PAINEL_QUOTA_STALE_AFTER_SECONDS:
        status = "stale"
    else:
        status = "available"
    return AgentPainelQuotas(
        status=status,
        source=source,
        updated_at=observed_at,
        stale_after_seconds=_CODEX_PAINEL_QUOTA_STALE_AFTER_SECONDS,
        five_hour=five_hour,
        seven_day=seven_day,
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


def _parse_iso_epoch_ms(value: Any) -> int | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


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
    session = agent["tmux_session"]
    # `--force` não é zelo: sem ele o Claude Code RECUSA a recarga justamente
    # quando ela mexe em servidor MCP — "This reload changes MCP tools (2 MCP
    # servers) ... Run /reload-plugins --force to apply" — que é o único caso
    # em que esta rota é chamada. O preço é o próximo turno reler a conversa
    # em vez de usar o cache; sem o `--force` o botão não aplicaria nada.
    delivered = await _send_tmux_or_409(session, "/reload-plugins --force")
    if delivered:
        # Enter separado, igual ao /effort e ao /model: o driver COLA o texto e
        # não submete. Sem esta linha o `/reload-plugins` fica parado no input
        # do agente enquanto a resposta diz `tmux_delivered=true` — o Rica
        # clicou "Recarregar" duas vezes em 09/08 e viu os dois comandos
        # empilhados no terminal, sem nada ter recarregado.
        await asyncio.sleep(0.3)
        await tmux_driver.press_enter(session)
    return McpReloadResponse(tmux_delivered=delivered)


# ----- Chat / Pane endpoints (DS-2) ---------------------------------------
# Stubs. Tipos + roteamento + gates determinísticos prontos; lógica real entra
# em passo 2 (send_message, capture_pane loop, upsert_agent_state, task_event).

ChatModel = Literal["fable", "opus", "sonnet", "haiku"]
_CHAT_MODEL_SLUGS = frozenset(get_args(ChatModel))

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


def _codex_model_slugs_permitidos() -> frozenset[str]:
    """O que a Tara aceita hoje: o catálogo do CLI, com a lista fixa como rede.

    A lista fixa acima é HISTÓRICA — em 0.146.0 ela ainda tinha `codex-gpt-5-2`
    e `codex-gpt-5-3-codex`, que o binário não conhece mais, e não tinha o
    `codex-gpt-5-3-codex-spark`, que ele passou a oferecer. Ela fica só para o
    caso de o catálogo não poder ser lido: recusar toda troca porque o `codex
    debug models` falhou seria pior que aceitar um slug antigo.
    """
    return codex_catalog.slugs_permitidos() or _CODEX_MODEL_SLUGS

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
    # 65536 é medido, não escolhido. Os 8192 anteriores nasceram no stub das
    # rotas (ffae5d7, 15/05) sem motivo técnico, e recusavam colar um log
    # inteiro. O teto DURO do caminho é o `MAX_ARG_STRLEN` do kernel
    # (`PAGE_SIZE * 32` = 128 KiB), porque o caminho da Tara passa o texto como
    # UM elemento de argv. O caminho do tmux não limita: 65.012 caracteres
    # colados num leitor em modo raw (o modo que a TUI do agente usa) voltaram
    # byte a byte idênticos. 64 KiB de caracteres deixa ~2x de folga em bytes.
    #
    # Espelhado em `apps/cockpit/components/shell/porta-de-envio.ts`, que barra
    # ANTES de limpar o campo — os dois números têm que andar juntos.
    text: str = Field(min_length=1, max_length=65536)
    idempotency_key: str = Field(min_length=1, max_length=128)
    fresh: bool = False


class InputResponse(BaseModel):
    tmux_delivered: bool
    sent_at: int
    event_boundary_id: int


class RelaunchRequest(BaseModel):
    confirm: StrictBool
    # O campo `resume` saiu em 10/08 junto com o Restart (ordem do Rica:
    # *"Restart sai, destravar fica"*). Relançar preserva a conversa, ponto —
    # e um cliente velho mandando `resume:false` cai no mesmo caminho, que
    # preserva em vez de apagar. Falha para o lado seguro.


class ModelChangeRequest(BaseModel):
    # `str` e não a união de Literals porque o catálogo Codex é lido do CLI em
    # tempo de execução: o `gpt-5.3-codex-spark` que o binário 0.146 oferece não
    # está no `CodexModel`, e um Literal congelado recusaria com 422 o modelo que
    # o painel acabou de oferecer. A validação real mora no endpoint, por família
    # — nenhum slug passa sem estar na allowlist da sua.
    model: str = Field(min_length=1, max_length=128)
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
# Teto do REPLAY, separado do teto do lote de polling acima. Os dois eram o mesmo
# número e isso não era escolha, era coincidência: o polling quer lote pequeno
# (latência por ciclo), o replay quer profundidade (quanto histórico o cliente
# consegue pedir). Só morde junto com `recentes=1` — sem ele o `limit` continua
# capado em `_MESSAGES_STREAM_LIMIT_MAX` e nada muda para quem já está no ar.
_MESSAGES_STREAM_REPLAY_LIMIT_MAX = 5_000
# Teto por RESULTADO DE FERRAMENTA, em caracteres. Medido em 09/08 no replay do
# `daniel`: 1005 mensagens somam 4,67 MB, mas a mediana é 1,4 KB e SEIS
# `tool_result` (0,8% do total) carregam metade do peso — o maior tem 360 mil
# caracteres. No cliente isso vira 3,6s de JS bloqueado em 49 long tasks contra
# 50ms de um agente leve, e o Rica abre o feed pelo túnel, no celular.
#
# Cortar é invisível: TODOS os renderers do feed já param em
# `LINHAS_DE_PRIMEIRA = 120` (shell-output, file-content, fetch-result,
# agent-result, linha-execucao). 32 mil caracteres continuam sendo várias
# vezes o que o "ver tudo" chega a mostrar.
#
# Default 0 = NÃO corta. O v1 (`apps/web`) consome este mesmo endpoint e é a
# tela que o Rica usa todo dia — quem pede o corte é quem passa o parâmetro.
_MESSAGES_STREAM_MAX_RESULT_CHARS_DEFAULT = 0
_MESSAGES_STREAM_POLL_S = 0.25
_MESSAGES_STREAM_HEARTBEAT_S = 15.0
_MESSAGES_STREAM_SUBAGENT_STALL_SCAN_S = 10.0
# De quanto em quanto tempo perguntar se o CC trocou de sessão debaixo do
# stream. Relógio próprio, e não o poll de 0,25 s: a pergunta só importa quando
# a sessão que este gerador segue parou de dar sinal.
_MESSAGES_STREAM_SESSION_SCAN_S = 2.0
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

# Os `Popen` dos turnos Codex em voo, por slug — a alça que a rota
# `POST /{slug}/codex-stop` usa para derrubar um turno preso. O wrapper
# (`scripts/tara-codex`) é disparado com `start_new_session=True`, então matar o
# grupo inteiro leva junto o `codex exec` filho (opção A, 10/08 — a Tara é
# headless por turno, não tem sessão tmux própria pra operar).
_CODEX_RUN_PROCS: dict[str, subprocess.Popen] = {}
_CODEX_RUN_PROCS_GUARD = asyncio.Lock()
_CODEX_SCOPE_STOP_TIMEOUT_S = 20.0


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


async def _clear_codex_busy_status_line(
    db: GrupoBorgesDB, agent: dict[str, Any]
) -> None:
    """Zera o `status_line` quando ele ainda marca ocupado.

    Ele é a SEGUNDA régua de `_codex_turn_in_flight`, e no fluxo normal quem o
    limpa é a mensagem final do agente, que o sobrescreve com o próprio texto.
    Turno interrompido não tem mensagem final: sem esta limpeza o campo fica
    congelado em `rodando: <comando>` e todo `/input` seguinte leva 409 — o
    botão "Parar turno" passa a trancar justamente o que veio destravar
    (Tara, 11/08). Status que não marca ocupado é preservado: é a última fala
    dela na vitrine do painel.
    """
    status_line = str(agent.get("status_line") or "").strip().lower()
    if any(status_line.startswith(marker) for marker in _CODEX_BUSY_STATUS_LINES):
        await db.update_agent_codex_state(agent["slug"], status_line=None)


def _tara_codex_script_path() -> str:
    return str(Path(__file__).resolve().parents[3] / "scripts" / "tara-codex")


def _codex_turn_scope_unit(slug: str) -> str:
    """Nome da unit do scope que carrega o turno — determinístico por slug.

    Determinístico porque ele é a SEGUNDA alça do `codex-stop`: o
    `_CODEX_RUN_PROCS` é memória do processo, e o turno agora sobrevive ao
    restart que zera esse dicionário. Um turno em voo por slug já é garantido
    pelo 409 de `_codex_turn_in_flight`, então o nome não colide — e scope de
    turno encerrado é coletado pelo systemd, o que libera o nome pro próximo.
    """
    return f"cockpit-codex-turn-{slug}.scope"


def _stop_codex_turn_scope(slug: str) -> bool:
    """Derruba o turno pela unit do scope; False quando não havia nada ativo.

    Caminho de quem perdeu o handle do `Popen` — o restart da API. O `is-active`
    antes do `stop` é o que separa "turno vivo sem handle" de "turno que já
    terminou": sem ele o botão relataria `stopped` em cima de nada.
    """
    unit = _codex_turn_scope_unit(slug)
    try:
        ativo = subprocess.run(
            ["systemctl", "--user", "is-active", unit],
            capture_output=True,
            text=True,
            timeout=_CODEX_SCOPE_STOP_TIMEOUT_S,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False
    if ativo.stdout.strip() != "active":
        return False
    try:
        parado = subprocess.run(
            ["systemctl", "--user", "stop", unit],
            capture_output=True,
            text=True,
            timeout=_CODEX_SCOPE_STOP_TIMEOUT_S,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False
    return parado.returncode == 0


def _spawn_tara_codex_input(
    *,
    slug: str,
    cwd: str,
    text: str,
    thread_id: str | None,
    fresh: bool = False,
    image_path: str | None = None,
) -> None:
    # O turno vive num scope transiente PRÓPRIO, não no cgroup do
    # `cockpit-api.service`. A unit roda com `KillMode=control-group`, e o
    # `man systemd.kill` é literal: no stop, "all remaining processes in the
    # control group of this unit will be killed" — todo restart da API que
    # pegasse turno em voo o matava (três em 11/08, o das 16:49 no meio de uma
    # resposta ao Rica). O `start_new_session=True` abaixo NÃO cobria isso: ele
    # só chama `setsid()` (CPython, `Modules/_posixsubprocess.c`), que troca a
    # sessão POSIX e não mexe em cgroup. Mesmo padrão do
    # `ze-shared/scripts/subir-frota.sh`, que já protege as sessões da frota
    # assim. Sem `--slice`: o scope cai em `app.slice`, onde a API já roda. A
    # `borges-frota.slice` existe pra cercar SESSÃO DE AGENTE, que é o que trava
    # a VPS; turno, build e dev server ficam fora dela (decisão do Pavan, 11/08,
    # com o teto de 5 GiB mantido — a máquina toda tem 7 GB).
    # `systemd-run --scope` faz `exec()` no lugar do próprio processo (medido:
    # o PID do `Popen` é o do `bash` do wrapper), então `poll()`, `wait()` e o
    # `killpg` do `codex-stop` seguem valendo sobre o mesmo handle.
    cmd = [
        "systemd-run",
        "--user",
        "--scope",
        "--quiet",
        f"--unit={_codex_turn_scope_unit(slug)}",
        # Via `bash <script>` em vez de exec direto: o bit +x pode cair em
        # edição/linter, e um PermissionError aqui viraria 500 silencioso no
        # /input.
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
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    # A alça do `codex-stop`. Uma entrada por slug — um turno em voo não pode
    # nascer outro (`codex_turn_in_flight` já barra no /input).
    _CODEX_RUN_PROCS[slug] = proc


async def _spawn_codex_agent_turn(
    slug: str,
    request: Request,
    *,
    text: str,
    fresh: bool = False,
    image_path: str | None = None,
    input_origin: _InputOrigin | None = None,
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
        # Opção A (10/08): a thread a retomar é a do DELEGATOR COCKPIT, lida do
        # store por delegator que o wrapper grava (`~/.tara/threads/cockpit.txt`).
        # O `codex_thread_id` do agent_state é único e qualquer delegator o
        # sobrescreve — e `find_latest_thread` puxava a thread do telecodex
        # (sessão interativa do tmux), que o lock por thread do codex recusa
        # retomar (`~/.codex/thread-writer-locks/`): o `codex exec resume`
        # morria em 2s com exit 1 e a mensagem do Rica nunca chegava (medido
        # 10/08, thread 019fe514). O `resolve_thread` valida que a thread ainda
        # existe no SQLite — sumiu (apagada/arquivada), nasce fresh.
        thread_id = None
        if not effective_fresh:
            tid = await asyncio.to_thread(codex_reader.read_cockpit_thread_id)
            if tid:
                thread = await asyncio.to_thread(
                    codex_reader.resolve_thread,
                    thread_id=tid,
                    cwd=cwd,
                    db_path=_codex_db_path(),
                )
                if thread is not None and thread.thread_id == tid:
                    thread_id = tid
        origin_id: str | None = None
        if input_origin is not None:
            origin_id = await request.app.state.db.create_message_origin(
                agent_slug=slug,
                executor_kind="codex",
                expected_text=text,
                meta=input_origin.meta,
            )
        try:
            _spawn_tara_codex_input(
                slug=slug,
                cwd=cwd,
                text=text,
                thread_id=thread_id,
                fresh=effective_fresh,
                image_path=image_path,
            )
        except Exception:
            if origin_id is not None:
                await request.app.state.db.discard_message_origin(origin_id)
            raise
        # O flag `codex_next_fresh` NÃO zera aqui: a "nova conversa" só consumiu
        # de verdade quando a thread nova nascer (evento `codex.thread.started`,
        # que grava a thread no agent_state e zera o flag). Zerar no spawn faria
        # o `/codex/messages` devolver a thread VELHA no gap entre o consumo e o
        # nascimento da nova — o piscar que o Rica reportou em 10/08.


@router.post("/{slug}/codex-stop")
async def stop_codex_turn(slug: str, request: Request) -> dict[str, Any]:
    """Derruba o turno Codex em voo (botão "Parar turno" do painel, opção A).

    O turno nasce como `bash scripts/tara-codex --delegator cockpit` com
    `start_new_session=True` (grupo de processos próprio). Matar o grupo leva o
    `codex exec` filho junto; sem isto, um `kill` no pai deixaria o run
    escrevendo no rollout sem dono.

    Duas alças, nesta ordem: o `Popen` guardado em memória e, quando ele não
    existe mais, a unit do scope (`_stop_codex_turn_scope`). A segunda passou a
    ser necessária quando o turno saiu do cgroup da API — ele sobrevive ao
    restart, o dicionário não.

    Idempotente: sem turno em voo, só reconcilia o estado — um `trabalhando`
    órfão (wrapper que morreu sem `tara.exec.completed`) volta a `ocioso`, e o
    `status_line` de ocupado é zerado. Repetir o botão numa Tara já trancada
    por um stop anterior é o caminho que a destrava.
    """
    agent = await _get_agent_or_404(request, slug)
    db: GrupoBorgesDB = request.app.state.db

    proc = await _codex_running_proc(slug)
    if proc is not None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        await _codex_clear_running_proc(slug)
        parado = True
    else:
        # Sem handle em memória o turno ainda pode estar VIVO: ele mora num
        # scope próprio e sobrevive ao restart que zerou o `_CODEX_RUN_PROCS`.
        # A unit é a alça que resta.
        parado = await asyncio.to_thread(_stop_codex_turn_scope, slug)

    if not parado:
        # Turno morto ou nunca existiu: reconcilia lifecycle órfão e sai.
        if agent.get("lifecycle_status") == "trabalhando":
            await db.update_agent_lifecycle(
                slug,
                status="ocioso",
                detail="turno interrompido",
                event="codex.turn.stopped",
            )
        await _clear_codex_busy_status_line(db, agent)
        return {"stopped": False, "reason": "no_turn_in_flight"}

    await db.update_agent_lifecycle(
        slug,
        status="ocioso",
        detail="turno interrompido",
        event="codex.turn.stopped",
    )
    await _clear_codex_busy_status_line(db, agent)
    return {"stopped": True}


async def _codex_running_proc(slug: str) -> subprocess.Popen | None:
    async with _CODEX_RUN_PROCS_GUARD:
        proc = _CODEX_RUN_PROCS.get(slug)
        if proc is None:
            return None
        if proc.poll() is not None:
            _CODEX_RUN_PROCS.pop(slug, None)
            return None
        return proc


async def _codex_clear_running_proc(slug: str) -> None:
    async with _CODEX_RUN_PROCS_GUARD:
        _CODEX_RUN_PROCS.pop(slug, None)


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


def _corta_texto(texto: str, max_chars: int) -> str:
    """Corta preservando o COMEÇO após deixar o marcador de omissão no topo."""
    omitidos = len(texto) - max_chars
    return f"[… {omitidos} caracteres omitidos pelo cockpit]\n\n{texto[:max_chars]}"


def _corta_resultados_grandes(canonical: dict[str, Any], max_chars: int) -> None:
    """Encolhe resultado de ferramenta NO LUGAR, antes de virar bytes na rede.

    Duas coisas engordam o replay, e a maior delas eu tinha chutado errado:

    1. **Imagem em base64.** Medido em 09/08 no `daniel`: cinco imagens somam
       1,15 MB — 27% de um replay de 4,28 MB. E o feed **não desenha nenhuma**:
       `renderers/file-content.ts` marca o resultado como `binario` e devolve
       `conteudo: ''`, mostrando só o aviso de arquivo binário; o `.tsx` não tem
       `<img>` nem `src`. Ou seja, esse megabyte atravessa o túnel para o
       navegador jogar fora. Some o `data` e a tela fica idêntica.

    2. **Texto muito longo.** Todos os renderers param em
       `LINHAS_DE_PRIMEIRA = 120`, então o que passa de `max_chars` (32 mil, com
       folga de sobra sobre o "ver tudo") nunca chega à tela.

    Fala do Rica, resposta do assistente e `thinking` passam inteiros por mais
    longos que sejam: o peso do feed nunca esteve na conversa.

    A varredura é recursiva porque a mesma imagem aparece em dois lugares com
    formatos diferentes — `message.content[].content[]` e o espelho
    `tool_use_result` (que é dict, não string, ao contrário do que o nome
    sugere).
    """
    if max_chars <= 0:
        return

    def varre(no: Any) -> None:
        if isinstance(no, dict):
            fonte = no.get("source")
            if (
                no.get("type") == "image"
                and isinstance(fonte, dict)
                and isinstance(fonte.get("data"), str)
            ):
                # Mantém `type`/`media_type`: quem classifica olha a forma, não
                # os bytes. O que sai é só a carga que ninguém desenha.
                fonte["data"] = ""
                return
            for chave, valor in list(no.items()):
                # Texto passando de `max_chars` aqui dentro só pode ser conteúdo:
                # campo estrutural (`type`, `filePath`, `media_type`) é curto por
                # natureza. Sem isto, o espelho em forma de DICT escapava do
                # corte — a auditoria do Canário apontou e o replay confirmou:
                # quatro espelhos com texto acima do teto, o maior com 199 mil
                # caracteres atravessando inteiro (09/08).
                if isinstance(valor, str) and len(valor) > max_chars:
                    no[chave] = _corta_texto(valor, max_chars)
                else:
                    varre(valor)
        elif isinstance(no, list):
            for item in no:
                varre(item)

    # `varre` sozinho cobre as três formas em que o conteúdo chega (string crua,
    # lista de blocos, dict aninhado): tratar cada uma à parte, como estava
    # antes, cortava o mesmo texto duas vezes.
    message = canonical.get("message")
    if isinstance(message, dict):
        partes = message.get("content")
        if isinstance(partes, list):
            for parte in partes:
                if isinstance(parte, dict) and parte.get("type") == "tool_result":
                    varre(parte)

    resultado = canonical.get("tool_use_result")
    if isinstance(resultado, str) and len(resultado) > max_chars:
        canonical["tool_use_result"] = _corta_texto(resultado, max_chars)
    else:
        varre(resultado)


def _canonical_jsonl_message_event(event: dict[str, Any]) -> dict[str, Any] | None:
    payload = event.get("payload")
    if not isinstance(payload, dict):
        return None
    if payload.get("type") == "queue-operation":
        if payload.get("operation") != "enqueue":
            return None
        return {
            "id": event["id"],
            "kind": "queued",
            "uuid": None,
            "parent_uuid": None,
            "session_id": payload.get("sessionId"),
            "is_sidechain": False,
            "user_type": None,
            "timestamp": payload.get("timestamp"),
            "created_at": event["created_at"],
            "message": None,
            "agent_id": None,
            "tool_use_result": None,
            "content": payload.get("content"),
        }
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
    # Voz chega marcada pelo POST e pelo watcher; nunca pela forma do texto.
    # Wakeups continuam sendo sentinelas do próprio runtime e podem ser
    # reconhecidos pelo conteúdo, porque não são fala humana.
    meta = explicit_synthetic_meta(payload.get("meta")) or detect_synthetic_kind(
        canonical["message"]
    )
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
    recentes: bool = Query(default=False),
    # `Annotated` e não `Query(default=…)`: o default fica sendo um int de
    # verdade, então a suíte — que chama esta função direto, sem o FastAPI
    # resolver os parâmetros — recebe 0 em vez de um objeto `Query`.
    max_result_chars: Annotated[
        int, Query(ge=0, alias="maxResultChars")
    ] = _MESSAGES_STREAM_MAX_RESULT_CHARS_DEFAULT,
) -> EventSourceResponse:
    """SSE canônico dos eventos JSONL de conversa de um agente.

    Protocolo: `replay-start` → N `message` → `replay-end` → live polling
    com `heartbeat` a cada 15s. O cursor público é `task_events.id`.

    `recentes=1` troca QUAL ponta do histórico o replay entrega: sem ele, o
    replay manda os `limit` eventos MAIS ANTIGOS e o loop live puxa todo o resto
    do banco em ciclos de `_MESSAGES_STREAM_LIMIT_MAX` — então `limit` dimensiona
    o primeiro lote, não o histórico que o cliente acumula. Com ele, o replay
    manda os `limit` mais RECENTES e o cursor já sai no topo, então `limit` vira
    teto de verdade.

    Fica opcional e desligado por padrão de propósito: o painel em produção
    depende do comportamento atual, e esta rodada é de medição — não é hora de
    mudar o que o Rica vê. Só vale na primeira conexão: em reconexão o cliente
    manda `since_id` e aí ele quer tudo o que perdeu, em ordem, não a cauda.
    """
    db: GrupoBorgesDB = request.app.state.db
    await _get_agent_or_404(request, slug)

    replay_newest_first = recentes and since_id == 0
    capped_limit = min(
        limit,
        _MESSAGES_STREAM_REPLAY_LIMIT_MAX
        if replay_newest_first
        else _MESSAGES_STREAM_LIMIT_MAX,
    )
    resolved_session_id = session_id or await db.latest_jsonl_session_id(slug)

    async def _message_stream() -> AsyncGenerator[dict[str, str] | ServerSentEvent, None]:
        nonlocal resolved_session_id
        started_at = time.perf_counter()
        last_id = since_id
        last_heartbeat = time.monotonic()
        last_subagent_seq = 0
        last_ask_user_seq = 0
        _, last_session_reset_seq = session_reset_events_since(slug, 0)
        last_stall_scan = time.monotonic()
        last_session_scan = time.monotonic()

        try:
            try:
                replay_events = await db.list_jsonl_message_events(
                    slug,
                    session_id=resolved_session_id,
                    since_id=since_id,
                    limit=capped_limit,
                    newest_first=replay_newest_first,
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
                    _corta_resultados_grandes(canonical, max_result_chars)
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
                        _corta_resultados_grandes(canonical, max_result_chars)
                        yield _sse_json("message", canonical)

                now = time.monotonic()

                # O `/clear` — e o boot limpo do Ligar — abrem OUTRA sessão no
                # CC. Este gerador seguia a sessão de quando o cliente conectou,
                # então a tela ficava na conversa morta até um F5. Trocar de
                # fonte na MESMA conexão é o que a doc do sse-starlette
                # recomenda para fonte que muda, e é o que salva o v1: ele não
                # escuta `session-reset` e só descongela porque as mensagens
                # novas passam a vir por aqui. O v2 usa o evento para zerar a
                # lista e reabrir limpo.
                #
                # Só quando o poll não trouxe nada: enquanto a sessão atual fala,
                # ela é a sessão certa, e o scan não custa nada a stream ativo.
                # Quem pediu `sessionId` na mão está lendo histórico — aquela
                # sessão não pode mudar debaixo dele.
                if (
                    session_id is None
                    and not live_events
                    and resolved_session_id is not None
                    and now - last_session_scan >= _MESSAGES_STREAM_SESSION_SCAN_S
                ):
                    last_session_scan = now
                    sessao_no_disco = await db.latest_jsonl_session_id(slug)
                    if sessao_no_disco is not None and sessao_no_disco != resolved_session_id:
                        resolved_session_id = sessao_no_disco
                        last_id = 0
                        yield _sse_json(
                            "session-reset",
                            {
                                "slug": slug,
                                "session_id": sessao_no_disco,
                                "reason": "sessao-nova",
                                "at": int(time.time()),
                            },
                        )

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

                session_reset_events, last_session_reset_seq = session_reset_events_since(
                    slug,
                    last_session_reset_seq,
                )
                for event_payload in session_reset_events:
                    yield _sse_json(
                        "session-reset",
                        {key: value for key, value in event_payload.items() if key != "seq"},
                    )

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
    - 200 + `tmux_delivered=True` no caminho feliz. Esse campo indica apenas
      que a colagem no tmux foi despachada; NÃO prova submissão nem entrega ao
      agente. A prova de submissão é o eco do item `user` no stream, acima do
      `event_boundary_id` (contrato: §3.1 de docs/cockpit-v2-data-contract.md).
    - `event_boundary_id` é o maior task_events.id observado imediatamente antes
      da primeira operação que pode entregar o texto. Essa ordem causal impede
      que um evento gerado pelo próprio envio fique abaixo da fronteira.
    """
    agent = await _get_agent_or_404(request, slug)
    db: GrupoBorgesDB = request.app.state.db
    event_boundary_id = await db.max_event_id()
    if agent.get("executor_kind") == "codex":
        await _spawn_codex_agent_turn(
            slug,
            request,
            text=payload.text,
            fresh=payload.fresh,
        )
    else:
        delivered = await _send_tmux_or_409(agent["tmux_session"], payload.text)
        if not delivered:
            raise HTTPException(status_code=409, detail="agent_pane_unavailable")

    return InputResponse(
        tmux_delivered=True,
        sent_at=int(time.time()),
        event_boundary_id=event_boundary_id,
    )


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
_VOICE_AUDIO_PROBE_TIMEOUT_S = 5
_VOICE_LOG_TAIL_CHARS = 8 * 1024
_IMAGE_ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp"}
# HEIC/HEIF entram SÓ pela `/file`, que converte na gravação. Fora de
# `_IMAGE_ALLOWED_MIMES` de propósito: a `/image` do v1 não converte e gravaria
# um arquivo que o leitor de imagem do agente não abre.
_IMAGE_HEIF_MIMES = {
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
}
# Tag 274 do EXIF. Número cru e não `ExifTags.Base.Orientation` para não pagar o
# import do Pillow no boot — ele só entra quando uma imagem realmente chega.
_EXIF_ORIENTATION = 274
_IMAGE_MAX_BYTES = 10 * 1024 * 1024  # 10MB
_IMAGE_MIME_SUFFIX = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
# 50MB e nao 100. O teto nao e sobre o que o disco aguenta: o Next BUFFERIZA o
# corpo inteiro em memoria para fazer o proxy do `/api/*`, com limite POR
# REQUISICAO. Esta VPS tem 7GB, ja travou por consumo, e dois uploads
# simultaneos de 100MB seriam 200MB so de buffer do proxy. O par deste numero
# mora em `apps/cockpit/next.config.ts` (`proxyClientMaxBodySize: '60mb'`), e a
# folga de 10MB cobre as bordas e a legenda do multipart.
#
# Os tres numeros — backend, proxy e validacao do cliente em `lib/anexo.ts` —
# andam juntos. Desalinhar e o bug de 04/08 com outra roupa: a tela prometendo
# um tamanho que o transporte nao entrega.
_VIDEO_MAX_BYTES = 50 * 1024 * 1024  # 50MB
_VIDEO_MIME_SUFFIX = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
}
_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024  # 25MB
_DOCUMENT_MIME_SUFFIX = {
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}
# Espelho de leitura das três tabelas de escrita: o que a `POST /file` sabe
# GRAVAR é exatamente o que a `GET /file/{nome}` sabe SERVIR, sem lista paralela
# para desandar. Fechada de propósito — o `guess_type` que o Starlette usa
# quando `media_type` é None ADIVINHA, e adivinhar `text/html` num arquivo
# servido sob o domínio do cockpit é script rodando com a origem dele.
_UPLOAD_MIME_BY_SUFFIX = {
    ext: mime
    for tabela in (_IMAGE_MIME_SUFFIX, _VIDEO_MIME_SUFFIX, _DOCUMENT_MIME_SUFFIX)
    for mime, ext in tabela.items()
}
# Teto de leitura por chunk: corta upload gigante antes de materializar na RAM.
_UPLOAD_READ_CHUNK_BYTES = 1024 * 1024
# Quantas normalizações de imagem podem ocupar o pool de threads ao mesmo tempo.
# Dois porque a VPS tem 2 vCPU; o raciocínio completo está no uso, em `post_agent_file`.
_SEMAFORO_IMAGEM = asyncio.Semaphore(2)
_AGENT_UPLOADS_BASE = Path(__file__).resolve().parents[1] / "uploads" / "agents"


def _voice_log_tail(value: str | bytes | None) -> str:
    """Bound subprocess diagnostics while retaining the most recent cause."""
    if isinstance(value, bytes):
        text = value.decode(errors="replace")
    else:
        text = value or ""
    text = text.strip()
    if len(text) <= _VOICE_LOG_TAIL_CHARS:
        return text
    return f"<truncated>...{text[-_VOICE_LOG_TAIL_CHARS:]}"


def _probe_audio_duration_ms(path: str) -> int | None:
    """Return media duration from ffprobe without making STT depend on it.

    MediaRecorder WebM may not finalize ``format.duration``. Keep that cheap
    header lookup as the fast path, then decode frames only when it is absent.
    Both probes share one deadline so instrumentation cannot extend its budget.
    """
    deadline = time.monotonic() + _VOICE_AUDIO_PROBE_TIMEOUT_S

    def run_ffprobe(*args: str) -> subprocess.CompletedProcess[str]:
        remaining_s = deadline - time.monotonic()
        if remaining_s <= 0:
            raise subprocess.TimeoutExpired(cmd=["ffprobe", *args, path], timeout=0)
        return subprocess.run(
            ["ffprobe", "-v", "error", *args, path],
            capture_output=True,
            timeout=remaining_s,
            text=True,
            errors="replace",
        )

    try:
        result = run_ffprobe(
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        voice_log.warning("voice_audio_probe_failed error=%r", exc)
        return None

    if result.returncode != 0:
        voice_log.warning(
            "voice_audio_probe_failed exit_code=%d stderr=%r",
            result.returncode,
            _voice_log_tail(result.stderr),
        )
        return None

    raw_duration = (result.stdout or "").strip()
    try:
        duration_seconds = float(raw_duration)
        if not 0 <= duration_seconds < float("inf"):
            raise ValueError("duration must be finite and non-negative")
        return round(duration_seconds * 1000)
    except (OverflowError, ValueError):
        if raw_duration not in {"", "N/A"}:
            voice_log.warning(
                "voice_audio_probe_failed invalid_duration=%r",
                raw_duration,
            )
            return None

    try:
        result = run_ffprobe(
            "-select_streams",
            "a:0",
            "-show_frames",
            "-show_entries",
            "frame=pts_time,duration_time",
            "-of",
            "csv=p=0",
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        voice_log.warning("voice_audio_probe_failed error=%r", exc)
        return None

    if result.returncode != 0:
        voice_log.warning(
            "voice_audio_probe_failed exit_code=%d stderr=%r",
            result.returncode,
            _voice_log_tail(result.stderr),
        )
        return None

    first_pts: float | None = None
    last_end: float | None = None
    for line in (result.stdout or "").splitlines():
        values = line.split(",")
        try:
            pts = float(values[0])
            frame_duration = float(values[1]) if len(values) > 1 else 0.0
            if (
                not 0 <= frame_duration < float("inf")
                or not abs(pts) < float("inf")
            ):
                continue
        except (IndexError, OverflowError, ValueError):
            continue
        first_pts = pts if first_pts is None else min(first_pts, pts)
        frame_end = pts + frame_duration
        last_end = frame_end if last_end is None else max(last_end, frame_end)

    if first_pts is not None and last_end is not None and last_end >= first_pts:
        return round((last_end - first_pts) * 1000)

    voice_log.warning(
        "voice_audio_probe_failed invalid_duration=%r",
        raw_duration,
    )
    return None


# Brands ISO-BMFF de imagem HEIF, lidas de `pillow_heif.misc.get_file_mimetype`
# (que é quem o `is_supported` da lib consulta) — não de tabela de blog.
#
# A brand é o que separa HEIC de MP4: os dois abrem com `ftyp` no offset 4, e
# sniffar só o `ftyp` mandaria todo vídeo pela porta da imagem. `avif` fica de
# fora de propósito: o Pillow já o lê sozinho, mas ele não está nos formatos
# aceitos e entrar aqui seria feature que ninguém pediu.
_IMAGE_HEIF_BRANDS = {
    b"heic", b"heix", b"heim", b"heis",  # imagem parada
    b"hevc", b"hevx", b"hevm", b"hevs",  # sequência (Live Photo) — vale o 1º quadro
    b"mif1", b"msf1",  # HEIF genérico
}


def _sniff_agent_image_type(data: bytes) -> str | None:
    """Extensão canônica do que os BYTES são — nunca do que o cliente declarou."""
    if len(data) < 12:
        return None
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[4:8] == b"ftyp" and data[8:12] in _IMAGE_HEIF_BRANDS:
        return ".heic"
    return None


# Boxes ISO-BMFF que abrem um mp4/mov legítimo. `ftyp` cobre o caso moderno;
# os demais aparecem em .mov antigo gravado por câmera/QuickTime.
_MOVIE_LEADING_BOXES = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"}


def _agent_file_content_matches(kind: str, base_mime: str, data: bytes) -> bool:
    """Confere magic bytes onde o formato dá essa garantia de graça.

    Texto puro (txt/csv/md/json) não tem assinatura — aí mime + extensão bastam;
    inventar heurística de conteúdo ali só rejeitaria arquivo legítimo.
    """
    if kind == "image":
        # O CONTEÚDO manda, não o `content_type`. HEIC de verdade chega batizado
        # de `.jpg` pelo caminho iCloud/Arquivos com frequência, e recusá-lo por
        # divergir do mime declarado é recusar foto legítima com um motivo que
        # não diz nada a quem está do outro lado. A extensão gravada sai do
        # sniff, então o arquivo salvo nunca mente sobre os próprios bytes.
        return _sniff_agent_image_type(data) is not None
    if kind == "video":
        if base_mime == "video/webm":
            return data.startswith(b"\x1a\x45\xdf\xa3")
        return len(data) >= 8 and data[4:8] in _MOVIE_LEADING_BOXES
    if base_mime == "application/pdf":
        return data.startswith(b"%PDF")
    if base_mime in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }:
        return data.startswith(b"PK\x03\x04")
    return True


def _normaliza_imagem(content: bytes) -> tuple[bytes, str]:
    """`(bytes a gravar, extensão)`. Aplica o EXIF Orientation nos PIXELS e
    converte HEIC em JPEG. Só imagem, só `/file`.

    HEIC SEMPRE é convertido. O leitor de imagem do agente não abre `.heic`, e
    depender do Safari para converter no upload deixou de ser opção: as notas do
    Safari 27 beta registram a REMOÇÃO dessa conversão como correção, e o
    caminho "Arquivos"/iCloud nunca passou por ela. Convertendo aqui, o resto do
    sistema nunca fica sabendo que HEIC existiu.

    Por que na gravação e não na tela: o leitor de imagem do agente redimensiona
    o que passa de 2000px no lado maior, e a orientação se perde nesse caminho.
    Medido em 04/08 com par de controle — 1900px de lado maior chega orientado,
    2100px chega cru, mesma imagem e mesma tag. Foto de celular tem 3000px e
    mais, então cai sempre do lado errado. Corrigir no preview não resolveria: o
    agente lê o arquivo do disco, não a tela.

    Quem não tem tag, ou tem `1`, sai por aqui sem decodificar nada — `Image.open`
    é preguiçoso e só o cabeçalho é lido. É o caminho da esmagadora maioria
    (screenshot não carrega Orientation), e é o que mantém o custo de RAM honesto
    numa VPS de 7GB: só foto torta paga a decodificação.

    `in_place=True` para não pagar a cópia do bitmap. `quality=95` porque a doc
    do Pillow documenta `keep` como preset de `qtables`, NÃO como valor de
    `quality`, e não diz nada sobre imagem transposta — na dúvida, o número alto
    e explícito. O ICC vai junto: foto de iPhone é Display P3 e sem o perfil a
    cor desbota, que é defeito visível.

    Falha aqui não derruba o upload de JPEG/PNG/WebP: devolve os bytes originais
    e registra o porquê. Anexo torto que chega vale mais que anexo que não chega
    — mas em silêncio isso viraria bug descoberto por acidente daqui a um mês.

    **HEIC é a exceção, e virou 422.** Ali o original não serve de nada: gravado
    como `.heic`, o agente recebe um caminho que o leitor de imagem dele não
    abre, e a `GET /file/{nome}` devolve 404 porque `.heic` não está na tabela —
    tudo isso depois de um 200 que diz ao composer que deu certo. Anexo que não
    converte não é "anexo torto que chega": é anexo que ninguém consegue ler, e
    falhar alto é o único jeito honesto. Isso também mantém verdadeira a
    premissa que `main.py` documenta — a extensão gravada sai sempre da tabela.
    """
    from PIL import Image, ImageOps

    extensao = _sniff_agent_image_type(content) or ".jpg"
    heif = extensao == ".heic"
    if heif:
        import pillow_heif

        pillow_heif.register_heif_opener()

    try:
        with Image.open(io.BytesIO(content)) as imagem:
            if not heif and imagem.getexif().get(_EXIF_ORIENTATION) in (None, 1):
                return content, extensao
            formato = "JPEG" if heif else imagem.format
            ImageOps.exif_transpose(imagem, in_place=True)
            if heif and imagem.mode not in ("RGB", "L"):
                # JPEG não tem canal alfa: sem isto o `save` levanta e a foto
                # cairia no fallback, gravada como `.heic` que ninguém abre.
                imagem = imagem.convert("RGB")
            destino = io.BytesIO()
            opcoes: dict[str, object] = {}
            # `exif_transpose` já removeu a Orientation de `info["exif"]`; o
            # resto (data, câmera, lente) é do Rica e continua no arquivo.
            if imagem.info.get("exif"):
                opcoes["exif"] = imagem.info["exif"]
            if imagem.info.get("icc_profile"):
                opcoes["icc_profile"] = imagem.info["icc_profile"]
            if formato == "JPEG":
                opcoes["quality"] = 95
            imagem.save(destino, format=formato, **opcoes)
            return destino.getvalue(), ".jpg" if heif else extensao
    except Exception as exc:  # noqa: BLE001 — qualquer falha grava o original
        if heif:
            log.warning(
                "HEIC não convertido, recusando o upload: %s: %s",
                type(exc).__name__,
                exc,
            )
            raise HTTPException(
                status_code=422,
                detail="não consegui converter esta foto (HEIC) — mande como JPEG",
            ) from exc
        log.warning(
            "imagem %s não normalizada, gravando original: %s: %s",
            extensao,
            type(exc).__name__,
            exc,
        )
        return content, extensao


def _resolve_agent_file_kind(base_mime: str) -> tuple[str, str, int] | None:
    """`(kind, extensão do arquivo salvo, teto em bytes)` — None se mime não serve.

    Para imagem a extensão daqui é PROVISÓRIA: quem decide é `_normaliza_imagem`,
    lendo os bytes. O `content_type` de foto de iPhone mente com frequência.
    """
    if base_mime in _IMAGE_ALLOWED_MIMES or base_mime in _IMAGE_HEIF_MIMES:
        return "image", _IMAGE_MIME_SUFFIX.get(base_mime, ".jpg"), _IMAGE_MAX_BYTES
    if base_mime in _VIDEO_MIME_SUFFIX:
        return "video", _VIDEO_MIME_SUFFIX[base_mime], _VIDEO_MAX_BYTES
    if base_mime in _DOCUMENT_MIME_SUFFIX:
        return "document", _DOCUMENT_MIME_SUFFIX[base_mime], _DOCUMENT_MAX_BYTES
    return None


async def _read_upload_within(file: UploadFile, max_bytes: int) -> bytes | None:
    """Lê o upload inteiro, ou None se ele passar do teto.

    Em chunks porque o teto de vídeo é 50MB: `read()` cego materializaria
    qualquer tamanho na RAM antes de a validação ter chance de recusar.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_UPLOAD_READ_CHUNK_BYTES)
        if not chunk:
            return b"".join(chunks)
        total += len(chunk)
        if total > max_bytes:
            return None
        chunks.append(chunk)


_UNSAFE_FILENAME_CHARS = re.compile(r"[^\w.\- ]", re.UNICODE)


def _sanitize_upload_filename(raw: str | None, *, fallback: str) -> str:
    """Nome original só pra exibir/relatar — nunca vira caminho em disco.

    Descarta diretório do cliente (Windows manda o path inteiro) e tudo que não
    seja letra/dígito/`.`/`-`/espaço, o que de quebra elimina quebra de linha —
    senão um nome forjado injetaria linha própria no prompt do agente.
    """
    base = re.split(r"[\\/]", raw or "")[-1].strip()
    return _UNSAFE_FILENAME_CHARS.sub("_", base).strip("._ ")[:120] or fallback


def _agent_file_message(
    kind: str, absolute_path: Path, original_name: str, caption_text: str
) -> str:
    if kind == "image":
        # Path SEMPRE em nova linha — ver comentário em post_agent_image.
        text = f"Imagem enviada via cockpit:\n{absolute_path}"
    elif kind == "video":
        text = (
            f"Vídeo enviado via cockpit:\n{absolute_path}\n"
            f"Nome original: {original_name}\n"
            "Não há visão de vídeo nativa: pra ver o conteúdo, extraia frames "
            "com ffmpeg (já instalado na VPS)."
        )
    else:
        text = (
            f"Arquivo enviado via cockpit:\n{absolute_path}\n"
            f"Nome original: {original_name}"
        )
    if caption_text:
        text = f"{text}\nCaption: {caption_text}"
    return text


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
    - 200 + {transcribed, tmux_delivered, duration_ms, event_boundary_id} no
      caminho feliz. `tmux_delivered` indica apenas que a colagem no tmux foi
      despachada; NÃO prova submissão nem entrega ao agente. A prova de
      submissão é o eco do item `user` no stream, acima do
      `event_boundary_id` (contrato: §3.1 de
      docs/cockpit-v2-data-contract.md).
    - `event_boundary_id` é o maior task_events.id observado imediatamente antes
      do STT, impedindo que eventos chegados durante a transcrição caiam abaixo
      da fronteira de confirmação do áudio.

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

    db: GrupoBorgesDB = request.app.state.db
    event_boundary_id = await db.max_event_id()
    started_at = time.monotonic()
    # stt-openai.sh só converte via ffmpeg extensões não reconhecidas (.oga, .opus…).
    # .webm vai direto pra OpenAI mas alguns encodings de browser falham. Salvar sempre
    # como .oga força a conversão mp3 e resolve webm/mp4/ogg de uma vez.
    suffix = ".oga"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    audio_duration_ms: int | None = None
    try:
        tmp.write(content)
        tmp.close()

        audio_duration_ms = await asyncio.to_thread(_probe_audio_duration_ms, tmp_path)
        voice_log.info(
            "voice_stt_started slug=%s filename=%r mime=%s size_bytes=%d "
            "audio_duration_ms=%s script=%s",
            slug,
            audio.filename,
            base_mime,
            len(content),
            audio_duration_ms,
            _VOICE_STT_SCRIPT,
        )

        stt_started_at = time.monotonic()
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                [_VOICE_STT_SCRIPT, tmp_path],
                capture_output=True,
                timeout=_VOICE_STT_TIMEOUT_S,
                text=True,
                errors="replace",
            )
        except subprocess.TimeoutExpired as e:
            now = time.monotonic()
            elapsed_ms = int((now - started_at) * 1000)
            stt_duration_ms = int((now - stt_started_at) * 1000)
            voice_log.error(
                "voice_stt_timeout slug=%s filename=%r mime=%s size_bytes=%d "
                "audio_duration_ms=%s elapsed_ms=%d stt_duration_ms=%d "
                "timeout_s=%d stderr=%r",
                slug,
                audio.filename,
                base_mime,
                len(content),
                audio_duration_ms,
                elapsed_ms,
                stt_duration_ms,
                _VOICE_STT_TIMEOUT_S,
                _voice_log_tail(e.stderr),
            )
            raise HTTPException(status_code=504, detail="stt_timeout") from e
        except OSError as e:
            now = time.monotonic()
            elapsed_ms = int((now - started_at) * 1000)
            stt_duration_ms = int((now - stt_started_at) * 1000)
            voice_log.exception(
                "voice_stt_exec_failed slug=%s filename=%r mime=%s size_bytes=%d "
                "audio_duration_ms=%s elapsed_ms=%d stt_duration_ms=%d script=%s",
                slug,
                audio.filename,
                base_mime,
                len(content),
                audio_duration_ms,
                elapsed_ms,
                stt_duration_ms,
                _VOICE_STT_SCRIPT,
            )
            raise HTTPException(
                status_code=502,
                detail=f"stt_script_not_found: {_VOICE_STT_SCRIPT}",
            ) from e

        if result.returncode != 0:
            now = time.monotonic()
            elapsed_ms = int((now - started_at) * 1000)
            stt_duration_ms = int((now - stt_started_at) * 1000)
            voice_log.error(
                "voice_stt_failed slug=%s filename=%r mime=%s size_bytes=%d "
                "audio_duration_ms=%s elapsed_ms=%d stt_duration_ms=%d "
                "exit_code=%d stderr=%r",
                slug,
                audio.filename,
                base_mime,
                len(content),
                audio_duration_ms,
                elapsed_ms,
                stt_duration_ms,
                result.returncode,
                _voice_log_tail(result.stderr),
            )
            stderr_tail = (result.stderr or "").strip().splitlines()
            last = stderr_tail[-1] if stderr_tail else "unknown"
            raise HTTPException(status_code=502, detail=f"stt_failed: {last}")

        transcribed = (result.stdout or "").strip()
        if not transcribed:
            now = time.monotonic()
            elapsed_ms = int((now - started_at) * 1000)
            stt_duration_ms = int((now - stt_started_at) * 1000)
            voice_log.error(
                "voice_stt_empty slug=%s filename=%r mime=%s size_bytes=%d "
                "audio_duration_ms=%s elapsed_ms=%d stt_duration_ms=%d "
                "exit_code=%d stderr=%r",
                slug,
                audio.filename,
                base_mime,
                len(content),
                audio_duration_ms,
                elapsed_ms,
                stt_duration_ms,
                result.returncode,
                _voice_log_tail(result.stderr),
            )
            raise HTTPException(status_code=502, detail="stt_empty")

        voice_log.info(
            "voice_stt_succeeded slug=%s filename=%r mime=%s size_bytes=%d "
            "audio_duration_ms=%s elapsed_ms=%d stt_duration_ms=%d",
            slug,
            audio.filename,
            base_mime,
            len(content),
            audio_duration_ms,
            int((time.monotonic() - started_at) * 1000),
            int((time.monotonic() - stt_started_at) * 1000),
        )

        # A MARCA DE ÁUDIO VALE PROS DOIS EXECUTORES. O ramo do Claude Code
        # sempre entregou `🎙 {transcribed}`; o do Codex entregava a transcrição
        # CRUA, indistinguível de texto digitado. Medido em 14/08: o áudio de
        # 11,2 s virou turno (scope `cockpit-codex-turn-tara` no journal) e a
        # transcrição entrou na thread — e ainda assim, perguntada se o áudio
        # tinha chegado, a Tara respondeu *"aqui chegou apenas esta mensagem
        # escrita"*. Ela não tinha como saber. O caminho do telecodex já
        # marcava o dele (`_AUDIO_SKILL_PREFIX`, services/codex_reader.py); só
        # o cockpit não marcava.
        #
        # `expected_text` do `message_origin` acompanha porque é casado contra o
        # texto do rollout já saneado (`claim_message_origin`): marcar um lado
        # só quebraria a origem `stt` da bolha.
        falado = f"🎙 {transcribed}"
        input_origin = _InputOrigin(meta={"kind": "stt", "raw_text": falado})
        if agent.get("executor_kind") == "codex":
            await _spawn_codex_agent_turn(
                slug,
                request,
                text=falado,
                input_origin=input_origin,
            )
            duration_ms = int((time.monotonic() - started_at) * 1000)
            return {
                "transcribed": transcribed,
                "tmux_delivered": True,
                "duration_ms": duration_ms,
                "event_boundary_id": event_boundary_id,
            }

        delivered = await _send_tmux_or_409(
            agent["tmux_session"],
            falado,
            input_origin=input_origin,
            db=db,
            agent_slug=slug,
        )
        duration_ms = int((time.monotonic() - started_at) * 1000)
        return {
            "transcribed": transcribed,
            "tmux_delivered": delivered,
            "duration_ms": duration_ms,
            "event_boundary_id": event_boundary_id,
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
    # Path SEMPRE em nova linha, por legibilidade. Multi-linha NÃO impede o
    # auto-detect: o CC anexa a imagem e troca o path por `[Image #N]` no input
    # de qualquer jeito (medido 08/08 no pane do Felipe). Quem confirma a
    # colagem tem que contar com o path sumindo — ver `_snapshot_contains_payload`.
    # Nome no cabeçalho NÃO resolve o feed: medido 08/08 22:22, o CC come a
    # linha inteira que cita a imagem, e com o nome ali sobrou só
    # `[Image #4]Caption: …`. Quem acha o arquivo é a linha `[Image: source:]`
    # que ele grava depois — o front lê de lá (anexo-imagem.ts).
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

    delivered = await _send_tmux_or_409(agent["tmux_session"], text)
    duration_ms = int((time.monotonic() - started_at) * 1000)
    log.info("agent %s: imagem salva %s", slug, absolute_path)
    return {
        "path": str(absolute_path),
        "tmux_delivered": delivered,
        "duration_ms": duration_ms,
    }


@router.post("/{slug}/file")
async def post_agent_file(
    slug: str,
    file: UploadFile,
    request: Request,
    caption: str | None = Form(default=None),
) -> dict[str, Any]:
    """Upload imagem/vídeo/documento → salva permanente → path via send-keys.

    Irmã da `/image`, que segue existindo intacta porque o cockpit v1 depende
    dela. O composer do v2 chama só esta — inclusive para imagem.

    - 404 quando agente não existe
    - 409 quando a sessão tmux está indisponível (`_send_tmux_or_409`)
    - 422 quando mime não suportado, tamanho acima do teto do tipo, ou bytes
      que não correspondem ao mime declarado
    - 200 + {path, kind, filename, size, tmux_delivered, duration_ms}

    Tetos por tipo: imagem 10MB, documento 25MB, vídeo 50MB. O arquivo é salvo
    com nome gerado (`timestamp-uuid.ext`); o nome original vai só na resposta e
    no texto entregue ao agente.
    """
    started_at = time.monotonic()
    agent = await _get_agent_or_404(request, slug)

    base_mime = (file.content_type or "").split(";")[0].strip()
    resolved = _resolve_agent_file_kind(base_mime)
    if resolved is None:
        raise HTTPException(
            status_code=422, detail=f"mime não suportado: {file.content_type}"
        )
    kind, ext, max_bytes = resolved

    content = await _read_upload_within(file, max_bytes)
    if content is None:
        raise HTTPException(
            status_code=422,
            detail=f"{kind} maior que {max_bytes // (1024 * 1024)}MB",
        )
    if not _agent_file_content_matches(kind, base_mime, content):
        raise HTTPException(
            status_code=422, detail=f"conteúdo não corresponde ao mime {base_mime}"
        )

    if kind == "image":
        # Em thread: decodificar e reencodar é CPU, e o event loop não pode
        # parar por causa disso. A `/image` continua intacta — é do v1.
        # A extensão sai daqui e não do mime declarado: HEIC entra e sai `.jpg`.
        #
        # O semáforo é o que impede a thread de CPU de estrangular todo o resto.
        # `asyncio.to_thread` usa o executor DEFAULT do loop, que nesta VPS tem
        # `min(32, 2+4) = 6` workers — e `db/store.py` faz TODA query de SQLite
        # pelo mesmo pool. Medido aqui com HEIC de 12MP (foto de iPhone típica):
        # até 5 conversões simultâneas a latência de um `to_thread` trivial fica
        # abaixo de 4ms; na 6ª ela vai a ~4s, ou seja, a API inteira congela,
        # incluindo os streams e o `_get_agent_or_404` desta própria rota. Não é
        # degradação gradual, é precipício — e o pool ainda é dividido com o
        # sweep de worktrees e a leitura do Codex, então o teto real é menor que
        # 6. Dois de cada vez são os 2 vCPU da máquina.
        async with _SEMAFORO_IMAGEM:
            content, ext = await asyncio.to_thread(_normaliza_imagem, content)

    stored_name = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:12]}{ext}"
    original_name = _sanitize_upload_filename(file.filename, fallback=stored_name)
    dest_dir = _AGENT_UPLOADS_BASE / slug
    absolute_path = dest_dir / stored_name

    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(absolute_path.write_bytes, content)
    except OSError as exc:
        log.error(
            "Erro ao salvar %s do agente %s em %s: %s", kind, slug, absolute_path, exc
        )
        raise HTTPException(
            status_code=500, detail="erro interno ao salvar arquivo"
        ) from exc

    caption_text = (caption or "").strip()
    text = _agent_file_message(kind, absolute_path, original_name, caption_text)

    if agent.get("executor_kind") == "codex":
        if kind == "image":
            await _spawn_codex_agent_turn(
                slug,
                request,
                text=caption_text or "Veja a imagem anexa.",
                image_path=str(absolute_path),
            )
        else:
            # O wrapper só anexa imagem em `image_path`; vídeo e documento vão
            # com o path dentro do próprio prompt.
            await _spawn_codex_agent_turn(slug, request, text=text)
        delivered = True
    else:
        delivered = await _send_tmux_or_409(agent["tmux_session"], text)

    log.info("agent %s: %s salvo %s", slug, kind, absolute_path)
    return {
        "path": str(absolute_path),
        "kind": kind,
        "filename": original_name,
        "size": len(content),
        "tmux_delivered": delivered,
        "canal_entrega": tmux_driver.get_delivery_channel_state(agent["tmux_session"]),
        "duration_ms": int((time.monotonic() - started_at) * 1000),
    }


@router.get("/{slug}/file/{filename}")
async def get_agent_file(slug: str, filename: str, request: Request) -> FileResponse:
    """Serve de volta um upload já gravado em `uploads/agents/<slug>/`.

    Existe porque o feed precisa MOSTRAR a imagem, e até aqui o upload era via de
    mão única: o arquivo era escrito em disco e o único vestígio na tela era o
    caminho absoluto em texto cru — o "código feio" que o Rica reclamou.

    - 404 quando o agente não existe, o arquivo não existe, ou a extensão não é
      uma das que a `POST /file` sabe gravar
    - 400 quando o nome resolve para fora do diretório do agente

    A guarda de travessia é própria e não confia na sanitização da ESCRITA: são
    duas portas diferentes, e a de leitura tem que se defender sozinha mesmo que
    um dia alguém grave um nome por outro caminho. `resolve()` antes de comparar
    é o que também mata symlink apontando para fora.
    """
    await _get_agent_or_404(request, slug)

    base = (_AGENT_UPLOADS_BASE / slug).resolve(strict=False)
    try:
        # O `resolve()` fica DENTRO do try junto com o `relative_to`: ele levanta
        # antes de qualquer guarda quando o nome tem byte nulo (`%00.png` dava
        # 500 com stack trace onde devia dar 400). `get_channel_attachment`, que
        # esta rota espelha, já cobria os dois — o espelho copiou a comparação e
        # deixou a resolução de fora.
        alvo = (base / filename).resolve(strict=False)
        alvo.relative_to(base)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="nome de arquivo inválido") from exc

    media_type = _UPLOAD_MIME_BY_SUFFIX.get(alvo.suffix.lower())
    if media_type is None or not alvo.is_file():
        raise HTTPException(status_code=404, detail="arquivo não existe")

    return FileResponse(
        path=str(alvo),
        media_type=media_type,
        filename=alvo.name,
        # `inline` porque o destino é um `<img>` no feed, não um download. O
        # default do Starlette é `attachment`.
        content_disposition_type="inline",
        headers={
            # O nome gravado é `timestamp-uuid.ext` e nunca é reescrito, então o
            # conteúdo é imutável de verdade. Sem isto o feed virtualizado
            # revalida a mesma foto a cada vez que o item volta à tela.
            "Cache-Control": "private, max-age=31536000, immutable",
            # Cinto e suspensório do `media_type` fechado: proíbe o navegador de
            # farejar o conteúdo e decidir por conta que aquilo é outra coisa.
            "X-Content-Type-Options": "nosniff",
        },
    )


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

    # Allowlist por família: nunca aceitar slug de uma família em agente de
    # outra, e nunca aceitar slug que a família nenhuma reconhece.
    if is_codex and target not in _codex_model_slugs_permitidos():
        raise HTTPException(status_code=422, detail="model_not_allowed_for_codex")
    if is_kimi and target not in _KIMI_MODEL_SLUGS:
        raise HTTPException(status_code=422, detail="model_not_allowed_for_kimi")
    if not is_codex and not is_kimi and target not in _CHAT_MODEL_SLUGS:
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

    delivered = await _send_tmux_or_409(session, f"/model {target}")

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


class CodexMessageMeta(BaseModel):
    kind: Literal["wakeup-dynamic", "wakeup-cron", "stt"]
    raw_text: str


class CodexMessageResponse(BaseModel):
    id: str
    role: Literal["user", "assistant", "internal"]
    text: str
    timestamp: str
    item_type: str
    visible: bool
    # O campo precisa ficar AUSENTE quando a origem não existe. O decorator da
    # rota usa `response_model_exclude_unset=True`; por isso o chamador só o
    # passa abaixo quando há meta explícito, em vez de passar `None`.
    meta: CodexMessageMeta | None = None


class CodexMessagesResponse(BaseModel):
    source: str
    thread_id: str | None
    model: str | None
    tokens_used: int | None
    updated_at_ms: int | None
    messages: list[CodexMessageResponse]
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
    """Resumo da thread Codex atual do agente (modelo, tokens, última atividade).

    Opção A (10/08): a thread do cockpit é a do `codex_thread_id` gravado pelo
    wrapper — nunca o fallback do telecodex (sessão interativa do tmux).
    """
    agent = await _require_codex_agent(request, slug)
    cwd = agent.get("workspace_path") or codex_reader.TARA_CWD
    thread_id = await asyncio.to_thread(codex_reader.read_cockpit_thread_id)
    thread = None
    if thread_id:
        thread = await asyncio.to_thread(
            codex_reader.resolve_thread, thread_id=thread_id, cwd=cwd, db_path=_codex_db_path()
        )
    return CodexThreadResponse(thread=thread.to_dict() if thread else None)


@router.get(
    "/{slug}/codex/messages",
    response_model=CodexMessagesResponse,
    response_model_exclude_unset=True,
)
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

    Opção A (10/08): a thread do cockpit é a do `codex_thread_id` — sem o
    fallback do telecodex, que mostraria a conversa da sessão interativa do tmux
    como se fosse a do cockpit.
    """
    agent = await _require_codex_agent(request, slug)
    # "Nova conversa" armada (`codex_next_fresh`): a conversa atual está
    # descartada até a próxima thread nascer — mesmo efeito do /clear no CC
    # (72e67bd/732f685). O feed limpa agora; o flag é consumido no próximo
    # /input, que nasce thread nova.
    if agent.get("codex_next_fresh"):
        return CodexMessagesResponse(
            source=codex_reader.SOURCE,
            thread_id=None,
            model=None,
            tokens_used=None,
            updated_at_ms=None,
            messages=[],
            hidden_count=0,
        )
    cwd = agent.get("workspace_path") or codex_reader.TARA_CWD
    thread_id = await asyncio.to_thread(codex_reader.read_cockpit_thread_id)
    thread, all_msgs = await asyncio.to_thread(
        codex_reader.read_latest_conversation,
        cwd,
        _codex_db_path(),
        thread_id=thread_id,
    )

    hidden_count = sum(1 for m in all_msgs if not m.visible)
    selected = all_msgs if include_internal else [m for m in all_msgs if m.visible]
    selected = selected[-limit:]

    db: GrupoBorgesDB = request.app.state.db
    messages: list[CodexMessageResponse] = []
    for message in selected:
        payload = message.to_dict()
        observed_at_ms = _parse_iso_epoch_ms(message.timestamp)
        if message.role == "user" and observed_at_ms is not None:
            meta = await db.claim_message_origin(
                agent_slug=slug,
                executor_kind="codex",
                expected_text=message.text,
                message_key=message.id,
                observed_at_ms=observed_at_ms,
            )
            explicit_meta = explicit_synthetic_meta(meta)
            if explicit_meta is not None:
                payload["meta"] = explicit_meta
        messages.append(CodexMessageResponse(**payload))

    return CodexMessagesResponse(
        source=codex_reader.SOURCE,
        thread_id=thread.thread_id if thread else None,
        model=thread.model if thread else None,
        tokens_used=thread.tokens_used if thread else None,
        updated_at_ms=thread.updated_at_ms if thread else None,
        messages=messages,
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
    """Executa escada determinística para recuperar modal ou texto armado.

    - 404 quando agente não existe
    - Escape fecha modal; input vazio confirma que o destravamento funcionou
    - input armado recebe Enter e, se necessário, é recapturado/recolado igual
    - 200 sempre informa ``degrau``, ``acao`` e ``tmux_delivered`` observados
    - um desfecho confirmado também limpa o bloqueio do canal no painel; falhas
      preservam o estado bloqueado para não liberar um input ainda inseguro

    O front atual lê apenas ``tmux_delivered``; por isso o degrau 2 retorna
    ``true`` quando Escape cumpriu o papel e não havia texto armado a submeter.
    """
    agent = await _get_agent_or_404(request, slug)
    result = await tmux_driver.recover_input(agent["tmux_session"])
    return {**result, "sent_at": int(time.time())}


@router.post("/{slug}/relaunch")
async def post_agent_relaunch(
    slug: str,
    payload: RelaunchRequest,
    request: Request,
) -> dict[str, Any]:
    """Relança o pane do Claude Code retomando a conversa (``--resume``).

    Esta operação mata o processo atual do pane. Por ser destrutiva, o payload
    exige o campo booleano obrigatório ``confirm`` e só aceita ``true``.

    O ID da conversa vem do último JSONL principal persistido; sem ele o
    endpoint falha em vez de iniciar uma conversa nova e perder silenciosamente
    o contexto. O boot limpo saiu com o Restart em 10/08 — quem precisa recomeçar
    do zero usa ``/clear`` dentro do agente.
    """
    agent = await _get_agent_or_404(request, slug)
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="confirmacao_explicita_obrigatoria")
    if agent.get("executor_kind") == "codex" or agent.get("cli_default") == "codex":
        raise HTTPException(status_code=409, detail="relaunch_somente_claude_code")
    if agent.get("model_family") not in {None, "anthropic", "kimi"}:
        raise HTTPException(status_code=409, detail="relaunch_requer_backend_anthropic_nativo")

    db: GrupoBorgesDB = request.app.state.db
    session_id = await db.latest_jsonl_session_id(slug)
    if session_id is None:
        raise HTTPException(status_code=409, detail="resume_session_not_found")

    # Preserva o modelo trocado em runtime (`/model`, persistido em state_model);
    # sem isso o relaunch sempre revertia pro model_default fixo do agents.yaml
    # (bug confirmado 03/08: Pavan em Opus 5 voltava pra claude-opus-4-8 a cada restart).
    relaunch_model = agent.get("state_model") or agent["model_default"]

    try:
        result = await tmux_driver.restart_claude_with_resume(
            agent["tmux_session"],
            agent["workspace_path"],
            relaunch_model,
            session_id,
        )
    except (
        ValueError,
        libtmux_exc.LibTmuxException,
        tmux_driver.TmuxSessionBusyError,
    ) as exc:
        raise HTTPException(status_code=409, detail=f"relaunch_failed: {exc}") from exc

    return {
        "tmux_delivered": result["confirmed"],
        "attempted": result["attempted"],
        "session_id": session_id,
        "sent_at": int(time.time()),
    }


def _recusa_ciclo_de_vida(agent: dict[str, Any]) -> None:
    """Desligar/Ligar só existem pra quem tem sessão tmux própria.

    Mesma fronteira do relaunch, e pelo mesmo motivo: a Tara não mora numa
    sessão de pé — ela nasce e morre a cada `codex exec` disparado pela própria
    API. Oferecer um botão que o back recusaria com 409 é o botão morto da §9
    com outra roupa; o front já esconde os dois, isto é o cinto.
    """
    if agent.get("executor_kind") == "codex" or agent.get("cli_default") == "codex":
        raise HTTPException(status_code=409, detail="ciclo_de_vida_somente_claude_code")


@router.post("/{slug}/desligar")
async def post_agent_desligar(
    slug: str,
    payload: RelaunchRequest,
    request: Request,
) -> dict[str, Any]:
    """Desliga o agente e TUDO que ele consome — ordem literal do Rica.

    ``tmux kill-session`` não basta: em 09/08 dois ``bun server.ts`` do plugin
    telegram, órfãos de sessões já mortas, queimavam 34% de CPU cada há nove
    horas. Quem os segurava era o scope de ``borges-frota.slice``, que sobrevive
    à sessão. O driver para o scope ANTES de encerrar a sessão — na ordem
    inversa o ``pane_pid`` some e leva junto a única trilha até ele.

    Funciona também na casca morta (sessão de pé, CLI já morto): não há processo
    a matar, mas há sessão tmux e pode haver scope de pé.
    """
    agent = await _get_agent_or_404(request, slug)
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="confirmacao_explicita_obrigatoria")
    _recusa_ciclo_de_vida(agent)

    try:
        result = await tmux_driver.shutdown_agent(agent["tmux_session"])
    except (ValueError, libtmux_exc.LibTmuxException) as exc:
        raise HTTPException(status_code=409, detail=f"desligar_failed: {exc}") from exc

    resistiram = result.get("scopes_resistiram") or []
    return {
        # Já desligado é sucesso, não falha: o botão é idempotente e o estado
        # final é o pedido. `attempted=False` só diz que não havia o que fazer.
        "tmux_delivered": not resistiram,
        "attempted": result["attempted"],
        "sessao_encerrada": result["sessao_encerrada"],
        "scopes_parados": result["scopes_parados"],
        "scopes_resistiram": resistiram,
        # O boot da frota espera o canal por até 90s. Desligar dentro dessa
        # janela cancela o script junto — sem isso ele trancava o Ligar seguinte.
        "boot_cancelado": result.get("boot_cancelado", False),
        "sent_at": int(time.time()),
    }


@router.post("/{slug}/ligar")
async def post_agent_ligar(slug: str, request: Request) -> dict[str, Any]:
    """Liga o agente pelo boot canônico da frota, retomando a conversa.

    Sem ``confirm``: ligar não destrói nada, então é toque simples como o
    destrava. Sobe com ``--continue`` — desligar não pode custar conversa; quem
    quer recomeçar limpo usa ``/clear`` dentro do agente.

    Quem monta o comando é ``ze-shared/scripts/subir-frota.sh``, não este
    endpoint: ele é a única fonte que sabe o ``TELEGRAM_STATE_DIR`` de cada
    agente e o env dos motores não-Anthropic. Duplicar a tabela aqui garantiria
    divergência no dia em que o Rica trocasse o canal de alguém.
    """
    agent = await _get_agent_or_404(request, slug)
    _recusa_ciclo_de_vida(agent)

    try:
        result = await tmux_driver.boot_agent(agent["tmux_session"])
    except tmux_driver.TmuxSessionBusyError as exc:
        raise HTTPException(status_code=409, detail=f"ligar_em_curso: {exc}") from exc
    except (ValueError, libtmux_exc.LibTmuxException) as exc:
        raise HTTPException(status_code=409, detail=f"ligar_failed: {exc}") from exc

    return {
        "tmux_delivered": result["confirmed"],
        "attempted": result["attempted"],
        "sent_at": int(time.time()),
    }


@router.post("/{slug}/clear")
async def post_agent_clear(slug: str, request: Request) -> dict[str, Any]:
    """Dispara `/clear` no CC do agente — limpa o contexto da sessão. Destrutivo:
    histórico da sessão vai embora (auto-memory persiste). Gate de UX é long-press
    no botão do painel — backend só entrega.
    """
    agent = await _get_agent_or_404(request, slug)
    delivered = await _send_tmux_or_409(agent["tmux_session"], "/clear")
    return {"tmux_delivered": delivered, "sent_at": int(time.time())}


# Marcador tolerante a locale: a tela abre em PT-BR no ambiente da frota
# ("Limites de uso do plano..."), com o texto em inglês da doc oficial como
# fallback caso o locale mude.
_USAGE_SCREEN_MARKER = re.compile(r"Limites de uso|Usage limits", re.IGNORECASE)
_USAGE_SCREEN_OPEN_ATTEMPTS = 8
_USAGE_SCREEN_OPEN_INTERVAL_S = 0.5
_USAGE_REFRESH_SETTLE_S = 1.5


class QuotaRefreshResponse(BaseModel):
    refreshed: bool
    reason: str | None = None


async def _pane_shows_usage_screen(session: str) -> bool:
    excerpt = await tmux_driver.capture_pane_excerpt(session, line_limit=30, max_chars=3000)
    return bool(excerpt and _USAGE_SCREEN_MARKER.search(excerpt))


@router.post("/{slug}/quotas/refresh", response_model=QuotaRefreshResponse)
async def refresh_agent_quota(slug: str, request: Request) -> QuotaRefreshResponse:
    """Força o CC a reconsultar `rate_limits`: `/usage` + `r` — o retry
    documentado em code.claude.com/docs/en/costs.md — e fecha com `Escape`.

    O CC não reconsulta `rate_limits` sozinho durante a sessão (ver
    shared_rate_limits_congela_ate_clear.md); esta é a única forma conhecida de
    trazer o número real sem esperar a sessão nascer de novo.

    Só roda com o agente ocioso: `/usage` no meio de um turno interrompe o que
    ele está fazendo — mesmo guard do `/model` (linha ~3824). Uma vez que o
    `/usage` foi confirmado entregue, o Escape final SEMPRE dispara, aberto ou
    não: ele é no-op num prompt vazio, e um modal esquecido aberto é a próxima
    falsa "trava" que a frota vai reportar.
    """
    agent = await _get_agent_or_404(request, slug)
    if agent.get("lifecycle_status") == "trabalhando":
        raise HTTPException(status_code=409, detail="agent_busy")

    session = agent["tmux_session"]
    delivered = await _send_tmux_or_409(session, "/usage")
    if not delivered:
        return QuotaRefreshResponse(refreshed=False, reason="tmux_indisponivel")

    try:
        opened = False
        for _ in range(_USAGE_SCREEN_OPEN_ATTEMPTS):
            await asyncio.sleep(_USAGE_SCREEN_OPEN_INTERVAL_S)
            if await _pane_shows_usage_screen(session):
                opened = True
                break
        if not opened:
            return QuotaRefreshResponse(refreshed=False, reason="tela_nao_abriu")

        await tmux_driver.send_named_key(session, "r")
        # Sem sinal textual confiável de "retry terminou" — a barra troca de
        # valor no lugar, não aparece marcador novo. Espera fixa e curta.
        await asyncio.sleep(_USAGE_REFRESH_SETTLE_S)
        return QuotaRefreshResponse(refreshed=True)
    finally:
        # Dois Escape: o primeiro fecha a tela de uso, um possível segundo
        # fecha um estado de erro dela por baixo (retry falhou, "press r").
        await tmux_driver.send_named_key(session, "Escape")
        await asyncio.sleep(0.3)
        await tmux_driver.send_named_key(session, "Escape")


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
