"""
GET /api/fleet — snapshot agregado da frota para a UI montar o dashboard em 1 request.

Combina o que `/api/agents` + N× `/instances` + N× `/sparkline` + agregados de
tasks devolveriam, num único payload. Resposta inclui status derivado (`offline`
quando `last_seen` excede o threshold), pra UI não precisar replicar regra.
"""
from __future__ import annotations

import asyncio
import time
from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from db.store import GrupoBorgesDB, RUN_STALE_THRESHOLD_SECONDS
from services import tmux_driver

router = APIRouter()

AgentStatus = Literal["running", "idle", "blocked", "done", "offline"]


class SparklineBucket(BaseModel):
    bucket: str  # ISO UTC "%Y-%m-%dT%H:00:00Z"
    count: int


class FleetInstance(BaseModel):
    id: str
    agent_slug: str
    instance_num: int
    tmux_session: str | None
    cli: str
    model: str
    is_subagent: bool
    parent_session_id: str | None
    status: Literal["idle", "running", "blocked", "done"]
    started_at: int
    ended_at: int | None


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
    pane_session_started_at: int | None = None
    instance_count: int
    # campos derivados/hidratados pelo snapshot
    status: AgentStatus
    instances: list[FleetInstance]
    sparkline: list[SparklineBucket]


class FleetKpis(BaseModel):
    total: int
    running: int
    blocked: int
    idle: int
    done: int
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
    return snapshot
