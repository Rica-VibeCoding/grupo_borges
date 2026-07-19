"""
GET /api/fleet — snapshot agregado da frota para a UI montar o dashboard em 1 request.

Combina o que `/api/agents` + N× `/instances` + N× `/sparkline` + agregados de
tasks devolveriam, num único payload. Resposta inclui status derivado (`offline`
quando `last_seen` excede o threshold), pra UI não precisar replicar regra.
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from db.store import GrupoBorgesDB, RUN_STALE_THRESHOLD_SECONDS
from services import codex_reader, tmux_driver

router = APIRouter()
_CC_STATUS_PREFIX = "cc-status-"

AgentStatus = Literal["ocioso", "trabalhando", "aguardando", "offline"]


class SparklineBucket(BaseModel):
    bucket: str  # ISO UTC "%Y-%m-%dT%H:00:00Z"
    count: int
    tokens: int = 0  # DS-58: SUM(input+output) da hora; altura da sparkline.


class FleetAgent(BaseModel):
    # campos da tabela agents
    slug: str
    name: str
    role: str | None
    emoji: str | None
    tmux_session: str
    workspace_path: str
    cli_default: str
    model_default: str
    # Família de modelos do agente (agents.yaml). "kimi" no Hiro — drive o
    # seletor de modelo/effort do front; None = família Anthropic padrão.
    model_family: str | None = None
    capabilities: list[str]
    created_at: int
    updated_at: int
    # state agregado (LEFT JOIN agent_state)
    state_cli: str | None
    state_model: str | None
    current_task_id: str | None
    current_task_last_heartbeat: int | None = None
    last_seen: int | None
    pane_excerpt: str | None
    executor_kind: str | None = None
    status_line: str | None = None
    active_task_label: str | None = None
    context_pct: float | None = None
    session_started_at: int | None = None
    last_assistant_message: str | None = None
    token_usage_json: str | None = None
    codex_tokens_used: int | None = None
    codex_next_fresh: bool | None = None
    lifecycle_status: str | None = None
    lifecycle_detail: str | None = None
    lifecycle_event: str | None = None
    lifecycle_updated_at: int | None = None
    pane_session_started_at: int | None = None
    # campos derivados/hidratados pelo snapshot
    status: AgentStatus
    sparkline: list[SparklineBucket]


class FleetKpis(BaseModel):
    total: int
    trabalhando: int
    aguardando: int
    ocioso: int
    offline: int
    tasks_active: int
    tasks_running: int
    tasks_blocked: int
    tasks_done: int


class FleetHealth(BaseModel):
    last_sync: int | None = Field(
        default=None, description="max(agents.last_seen). NULL se nenhum heartbeat ainda.",
    )
    server_now: int = Field(description="unix ts do servidor — UI calcula 'há Xs' contra isso")
    offline_threshold_seconds: int
    stale_threshold_seconds: int


class FleetSnapshot(BaseModel):
    agents: list[FleetAgent]
    kpis: FleetKpis
    health: FleetHealth


async def _hydrate_pane_excerpts(agents: list[dict]) -> None:
    async def capture(agent: dict) -> tuple[str, str | None]:
        session_name = agent.get("tmux_session")
        if not session_name:
            return agent["slug"], None
        return agent["slug"], await tmux_driver.capture_pane_excerpt(session_name)

    results = await asyncio.gather(*(capture(agent) for agent in agents))
    by_slug = dict(results)
    now = int(time.time())
    for agent in agents:
        excerpt = by_slug.get(agent["slug"])
        agent["pane_excerpt"] = excerpt
        elapsed = tmux_driver.parse_session_elapsed_from_pane(excerpt)
        # statusline do CLI é mais fresco que agent_instances quando o usuário
        # fez /clear ou reiniciou o claude dentro da mesma tmux session.
        agent["pane_session_started_at"] = now - elapsed if elapsed is not None else None


def _num_or_none(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _read_cc_context_pct(session_id: str) -> float | None:
    path = Path("/tmp") / f"{_CC_STATUS_PREFIX}{session_id}.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    context_window = payload.get("context_window")
    if not isinstance(context_window, dict):
        return None
    return _num_or_none(context_window.get("used_percentage"))


async def _hydrate_cc_context_pct(db: GrupoBorgesDB, agents: list[dict]) -> None:
    async def hydrate(agent: dict) -> None:
        if agent.get("executor_kind") == "codex":
            agent["context_pct"] = None
            return
        if agent.get("context_pct") is not None:
            return
        session_id = await db.latest_jsonl_session_id(agent["slug"])
        if not session_id:
            return
        agent["context_pct"] = await asyncio.to_thread(_read_cc_context_pct, session_id)

    await asyncio.gather(*(hydrate(agent) for agent in agents))


async def _hydrate_codex_tokens_used(agents: list[dict]) -> None:
    async def hydrate(agent: dict) -> None:
        if agent.get("executor_kind") != "codex":
            agent["codex_tokens_used"] = None
            return
        cwd = agent.get("workspace_path") or codex_reader.TARA_CWD
        thread = await asyncio.to_thread(codex_reader.find_latest_thread, cwd)
        agent["codex_tokens_used"] = thread.tokens_used if thread is not None else None
        agent["context_pct"] = None

    await asyncio.gather(*(hydrate(agent) for agent in agents))


@router.get("", response_model=FleetSnapshot)
async def get_fleet(
    request: Request,
    sparkline_hours: int = Query(default=24, ge=1, le=168),
):
    db: GrupoBorgesDB = request.app.state.db
    await db.mark_stale_runs()
    snapshot = await db.fleet_snapshot(sparkline_hours=sparkline_hours)
    snapshot["health"]["stale_threshold_seconds"] = RUN_STALE_THRESHOLD_SECONDS
    await _hydrate_pane_excerpts(snapshot["agents"])
    await _hydrate_codex_tokens_used(snapshot["agents"])
    await _hydrate_cc_context_pct(db, snapshot["agents"])
    return snapshot
