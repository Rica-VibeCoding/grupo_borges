"""
GET /api/events — feed paginado de task_events (mais recentes primeiro).

Usado pra hidratar `<ActivityFeed />` na UI. Updates ao vivo continuam via
`/api/stream` SSE — este endpoint é só o snapshot inicial / paginação
retroativa.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request

from db.store import GrupoBorgesDB

router = APIRouter()


@router.get("")
async def list_events(
    request: Request,
    limit: int = Query(default=50, ge=1, le=500),
    before_id: int | None = Query(
        default=None,
        description="Paginação retroativa — devolve eventos com id menor que este",
    ),
) -> list[dict[str, Any]]:
    db: GrupoBorgesDB = request.app.state.db
    return await db.list_events_latest(limit=limit, before_id=before_id)
