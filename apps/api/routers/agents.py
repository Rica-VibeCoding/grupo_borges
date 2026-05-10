"""
GET /api/agents                    — lista 6 agentes da frota com state agregado
GET /api/agents/{slug}             — detalhe + state de um agente
GET /api/agents/{slug}/instances   — lista instâncias do agente (pílulas multi-instância)
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request

from db.store import GrupoBorgesDB

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
