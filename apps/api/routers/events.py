"""
GET /api/events — feed paginado de task_events (mais recentes primeiro).

Usado pra hidratar `<ActivityFeed />` na UI. Updates ao vivo continuam via
`/api/stream` SSE — este endpoint é só o snapshot inicial / paginação
retroativa.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query, Request

from db.store import GrupoBorgesDB

router = APIRouter()


@router.get("")
async def list_events(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    before_id: Annotated[
        int | None,
        Query(
            description="Paginação retroativa — devolve eventos com id menor que este",
        ),
    ] = None,
) -> list[dict[str, Any]]:
    db: GrupoBorgesDB = request.app.state.db
    return await db.list_events_latest(limit=limit, before_id=before_id)
