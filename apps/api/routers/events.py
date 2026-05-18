"""
GET /api/events          — feed paginado de task_events (mais recentes primeiro).
GET /api/events/stream   — SSE global multiplexado por slugs (LB-9 Bloco 2).
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Annotated, Any, AsyncGenerator

from fastapi import APIRouter, Query, Request
from sse_starlette import EventSourceResponse, ServerSentEvent

from db.store import GrupoBorgesDB
from orchestrator.jsonl_watcher import (
    mark_stalled_subagents,
    subagent_active_snapshot,
    subagent_status_events_since,
)

router = APIRouter()

_STREAM_POLL_S = 0.25
_STREAM_STALL_SCAN_S = 10.0


def _public_subagent_status(event: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in event.items() if k != "seq"}


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


@router.get("/stream")
async def stream_global_events(
    request: Request,
    slugs: str = Query(default=""),
) -> EventSourceResponse:
    """SSE global multiplexado — 1 conexão por cliente, server-side filter por slugs.

    Protocolo:
    - Ao conectar: emite snapshot de subagents ativos pra cada slug subscrito.
    - Loop 250ms: emite novos subagent_status events + heartbeat a cada 15s.
    - Stall scan a cada 10s.

    Cada evento SSE tem `event: subagent_status` e `data: {slug, ...SubagentStatusEntry}`.
    """
    slug_set = {s.strip() for s in slugs.split(",") if s.strip()}

    async def _stream() -> AsyncGenerator[ServerSentEvent, None]:
        # Captura cursor ANTES do snapshot: janela entre os dois é coberta
        # pelo poll. Possíveis duplicatas de 'active' são idempotentes no cliente.
        last_seqs: dict[str, int] = {}
        for slug in slug_set:
            _, seq = subagent_status_events_since(slug, 0)
            last_seqs[slug] = seq

        for slug in slug_set:
            for entry in subagent_active_snapshot(slug):
                yield ServerSentEvent(
                    event="subagent_status",
                    data=json.dumps({**entry, "slug": slug}, ensure_ascii=False),
                )
        last_stall = time.monotonic()
        last_heartbeat = time.monotonic()

        while True:
            if await request.is_disconnected():
                return

            for slug in slug_set:
                events, new_seq = subagent_status_events_since(slug, last_seqs[slug])
                last_seqs[slug] = new_seq
                for event in events:
                    yield ServerSentEvent(
                        event="subagent_status",
                        data=json.dumps(
                            {**_public_subagent_status(event), "slug": slug},
                            ensure_ascii=False,
                        ),
                    )

            now = time.monotonic()
            if now - last_stall >= _STREAM_STALL_SCAN_S:
                for slug in slug_set:
                    for event in mark_stalled_subagents(slug):
                        yield ServerSentEvent(
                            event="subagent_status",
                            data=json.dumps(
                                {**_public_subagent_status(event), "slug": slug},
                                ensure_ascii=False,
                            ),
                        )
                last_stall = now

            if now - last_heartbeat >= 15.0:
                yield ServerSentEvent(
                    event="heartbeat",
                    data=json.dumps({"ts": int(time.time())}),
                )
                last_heartbeat = now

            await asyncio.sleep(_STREAM_POLL_S)

    return EventSourceResponse(
        _stream(),
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
