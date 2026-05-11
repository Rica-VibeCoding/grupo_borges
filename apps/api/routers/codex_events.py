"""
POST /api/codex-events — recebe eventos do wrapper `tara-codex`.

Wrapper local (`scripts/tara-codex`) executa `codex exec --json` e relaya
cada linha JSONL pra este endpoint. Também emite eventos custom de
lifecycle: `tara.exec.started`, `tara.exec.completed`, `tara.exec.failed`.

Eventos do JSONL nativo do Codex viram `codex.<event_type>` em `task_events`.

Tailscale-only via middleware existente (`main.py`); dev local usa
`GB_DEV_BYPASS_AUTH=1`.
"""
from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field

from db.store import GrupoBorgesDB
from util import redact_payload

router = APIRouter()
log = logging.getLogger(__name__)


CodexEventKind = Literal[
    # Lifecycle custom emitido pelo wrapper:
    "tara.exec.started",
    "tara.exec.completed",
    "tara.exec.failed",
    # JSONL nativo do `codex exec --json`:
    "codex.thread.started",
    "codex.turn.started",
    "codex.item.started",
    "codex.item.updated",
    "codex.item.completed",
    "codex.turn.completed",
    "codex.turn.failed",
    "codex.error",
]


class CodexEventCreate(BaseModel):
    kind: CodexEventKind
    delegator_agent_slug: str = Field(min_length=1, max_length=64)
    target_agent_slug: str = Field(default="tara", min_length=1, max_length=64)
    thread_id: str | None = Field(default=None, max_length=128)
    payload: dict[str, Any] | None = None
    raw_jsonl: str | None = Field(default=None, max_length=64_000)


@router.post("", status_code=status.HTTP_201_CREATED)
async def receive_codex_event(payload: CodexEventCreate, request: Request) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db

    safe_payload = redact_payload(payload.payload) if payload.payload else None
    safe_raw = redact_payload(payload.raw_jsonl) if payload.raw_jsonl else None

    enriched_payload: dict[str, Any] = {
        "delegator_agent_slug": payload.delegator_agent_slug,
        "target_agent_slug": payload.target_agent_slug,
    }
    if payload.thread_id:
        enriched_payload["thread_id"] = payload.thread_id
    if safe_payload:
        enriched_payload["body"] = safe_payload

    event_id = await db.insert_task_event(
        kind=payload.kind,
        agent_slug=payload.target_agent_slug,
        payload=enriched_payload,
        raw_jsonl=safe_raw,
    )

    if payload.kind in {
        "tara.exec.started",
        "tara.exec.completed",
        "tara.exec.failed",
        "codex.turn.completed",
        "codex.item.completed",
    }:
        await db.upsert_agent_state(payload.target_agent_slug)

    return {"received": True, "event_id": event_id}
