"""
GET /api/agents                     — lista 6 agentes da frota com state agregado
GET /api/agents/{slug}              — detalhe + state de um agente
GET /api/agents/{slug}/instances    — lista instâncias do agente (pílulas multi-instância)
GET /api/agents/{slug}/sparkline    — eventos por hora (mini-chart de atividade)
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request

from db.store import GrupoBorgesDB, build_hour_series, hour_window

router = APIRouter()

InstanceStatus = Literal["idle", "running", "blocked", "done"]


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


@router.get("/{slug}/instances")
async def list_agent_instances(
    slug: str,
    request: Request,
    status: InstanceStatus | None = Query(default=None),
) -> list[dict[str, Any]]:
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return await db.list_agent_instances(slug, status=status)


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
    counts = await db.event_counts_per_hour(slug, since_unix=int(start_dt.timestamp()))
    return build_hour_series(counts, start_dt, hours)
