"""
GET /api/stream — SSE com tail do task_events.

MVP: polling no DB a cada `settings.stream.poll_interval_ms`. Suficiente pra
poucos clientes simultâneos (cockpit é uso interno). Trocar por push (queue
alimentada pelo escritor) só quando UI travar.

Disconnect detection: poll explícito via `request.is_disconnected()`.
Keepalive: ping do sse-starlette a cada `keepalive_seconds`.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from sse_starlette import EventSourceResponse

router = APIRouter()


async def _event_generator(request: Request) -> AsyncGenerator[dict, None]:
    db = request.app.state.db
    settings = request.app.state.settings
    poll_seconds = settings.poll_interval_ms / 1000.0

    last_id = await db.max_event_id()

    while True:
        if await request.is_disconnected():
            break

        events = await db.list_events_after(last_id, limit=200)
        for ev in events:
            yield {
                "id": str(ev["id"]),
                "event": ev["kind"],
                "data": json.dumps(ev, ensure_ascii=False, default=str),
            }
            last_id = ev["id"]

        await asyncio.sleep(poll_seconds)


@router.get("")
async def stream(request: Request):
    settings = request.app.state.settings
    return EventSourceResponse(
        _event_generator(request),
        ping=settings.keepalive_seconds,
    )
