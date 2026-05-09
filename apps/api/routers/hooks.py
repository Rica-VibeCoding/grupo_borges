"""
POST /hooks/{event_kind} — receptor de hooks do Claude Code.

Cada agente configura `.claude/settings.json` apontando hooks para
http://<vps>:8000/hooks/<EventName>. CC posta JSON com payload do evento.

MVP: registra TODOS os 27 eventos crus em task_events. Lógica especial
fica reservada para 5 críticos (UserPromptSubmit, PostToolUse,
SubagentStart, SubagentStop, Stop) — por enquanto só sinalizamos via flag
no response.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request

router = APIRouter()

CRITICAL_EVENTS = {
    "UserPromptSubmit",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "Stop",
}


def _slug_from_cwd(cwd: str | None, agents_config: list[dict]) -> str | None:
    if not cwd:
        return None
    cwd_norm = cwd.rstrip("/").rstrip("\\")
    for a in agents_config:
        wp = a["workspace_path"].rstrip("/").rstrip("\\")
        if cwd_norm == wp or cwd_norm.startswith(wp + "/"):
            return a["slug"]
    return None


@router.post("/{event_kind}")
async def receive_hook(event_kind: str, request: Request) -> dict[str, Any]:
    db = request.app.state.db
    agents_config = request.app.state.agents_config["agents"]

    raw_body = await request.body()
    payload: dict | None
    try:
        parsed = json.loads(raw_body) if raw_body else None
        payload = parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        payload = None

    cwd = (payload or {}).get("cwd")
    slug = _slug_from_cwd(cwd, agents_config)

    event_id = await db.insert_task_event(
        kind=f"hook:{event_kind}",
        agent_slug=slug,
        payload=payload,
        raw_jsonl=raw_body.decode("utf-8", errors="replace") if raw_body else None,
    )

    if slug is not None:
        await db.upsert_agent_state(slug)

    return {
        "received": True,
        "event_id": event_id,
        "agent_slug": slug,
        "is_critical": event_kind in CRITICAL_EVENTS,
    }
