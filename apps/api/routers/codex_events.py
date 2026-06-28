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

import json
import logging
import time
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


def _short_text(value: Any, *, limit: int = 80) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    if not text:
        return None
    return text if len(text) <= limit else f"{text[: limit - 3]}..."


def _snippet(value: Any, *, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    if not text:
        return None
    return text[:limit]


def _body(payload: CodexEventCreate) -> dict[str, Any]:
    return payload.payload if isinstance(payload.payload, dict) else {}


def _item(body: dict[str, Any]) -> dict[str, Any]:
    item = body.get("item")
    if isinstance(item, dict):
        return item
    return body


def _thread_id(body: dict[str, Any]) -> str | None:
    for key in ("thread_id", "id"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _active_task_label(body: dict[str, Any]) -> str | None:
    for key in ("active_task_label", "task_label", "label", "prompt"):
        value = _snippet(body.get(key), limit=280)
        if value is not None:
            return value
    argv = body.get("argv")
    if isinstance(argv, list):
        parts = [part for part in argv if isinstance(part, str) and part.strip()]
        if parts:
            return " ".join(parts)[:280]
    return None


def _int_timestamp(value: Any, *, fallback: int) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return fallback


def _codex_state_update(payload: CodexEventCreate) -> dict[str, Any]:
    body = _body(payload)
    item = _item(body)
    now = int(time.time())

    if payload.kind == "tara.exec.started":
        update: dict[str, Any] = {
            "executor_kind": "codex",
            "status_line": "iniciando",
            "session_started_at": _int_timestamp(body.get("started_at"), fallback=now),
        }
        label = _active_task_label(body)
        if label is not None:
            update["active_task_label"] = label
        return update

    if payload.kind == "codex.thread.started":
        return {
            "executor_kind": "codex",
            "session_started_at": _int_timestamp(body.get("started_at"), fallback=now),
        }

    if payload.kind == "codex.turn.started":
        update = {
            "executor_kind": "codex",
            "status_line": "processando turn",
        }
        label = _active_task_label(body)
        if label is not None:
            update["active_task_label"] = label
        return update

    if payload.kind == "codex.item.completed" and item.get("type") == "agent_message":
        text = item.get("text")
        message = _snippet(text, limit=280)
        status_line = _snippet(text, limit=80)
        if message is None and status_line is None:
            return {"executor_kind": "codex"}
        update = {
            "executor_kind": "codex",
        }
        if message is not None:
            update["last_assistant_message"] = message
        if status_line is not None:
            update["status_line"] = status_line
        return update

    if payload.kind == "codex.item.started" and item.get("type") == "command_execution":
        command = _snippet(item.get("command"), limit=80)
        if command is None:
            return {"executor_kind": "codex"}
        return {
            "executor_kind": "codex",
            "status_line": f"rodando: {command}",
        }

    if payload.kind == "codex.turn.completed":
        usage = body.get("usage")
        update = {"executor_kind": "codex"}
        if usage is not None:
            update["token_usage_json"] = json.dumps(usage, ensure_ascii=False)
        return update

    if payload.kind == "tara.exec.completed":
        return {
            "executor_kind": "codex",
            "status_line": "ocioso",
        }

    if payload.kind == "tara.exec.failed":
        error = _snippet(body.get("error"), limit=80) or _snippet(body.get("stderr"), limit=80)
        return {
            "executor_kind": "codex",
            "status_line": f"falhou: {error}" if error else "falhou",
        }

    return {}


def _codex_lifecycle(payload: CodexEventCreate) -> tuple[str, str | None]:
    body = payload.payload or {}
    label = _short_text(body.get("label"), limit=80)
    name = _short_text(body.get("name"), limit=80)
    detail = label or name

    if payload.kind == "tara.exec.started":
        return "trabalhando", "tara-codex iniciado"
    if payload.kind == "tara.exec.completed":
        return "ocioso", "tara-codex concluído"
    if payload.kind == "tara.exec.failed":
        return "offline", "tara-codex falhou"
    if payload.kind == "codex.turn.started":
        return "trabalhando", "turno iniciado"
    if payload.kind in {"codex.item.started", "codex.item.updated"}:
        return "trabalhando", detail or "item em execução"
    if payload.kind == "codex.item.completed":
        return "trabalhando", "item concluído"
    if payload.kind == "codex.turn.completed":
        return "ocioso", "turno concluído"
    if payload.kind in {"codex.turn.failed", "codex.error"}:
        return "aguardando", "erro codex"
    return "trabalhando", payload.kind


@router.post("", status_code=status.HTTP_201_CREATED)
async def receive_codex_event(payload: CodexEventCreate, request: Request) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db

    safe_payload = redact_payload(payload.payload) if payload.payload else None
    safe_raw = redact_payload(payload.raw_jsonl) if payload.raw_jsonl else None

    enriched_payload: dict[str, Any] = {
        "delegator_agent_slug": payload.delegator_agent_slug,
        "target_agent_slug": payload.target_agent_slug,
    }
    body_thread_id = _thread_id(payload.payload or {})
    if payload.thread_id or body_thread_id:
        enriched_payload["thread_id"] = payload.thread_id or body_thread_id
    if safe_payload:
        enriched_payload["body"] = safe_payload

    event_id = await db.insert_task_event(
        kind=payload.kind,
        agent_slug=payload.target_agent_slug,
        payload=enriched_payload,
        raw_jsonl=safe_raw,
    )

    await db.upsert_agent_state(payload.target_agent_slug)
    codex_state = _codex_state_update(payload)
    if codex_state:
        await db.update_agent_codex_state(payload.target_agent_slug, **codex_state)
    lifecycle_status, lifecycle_detail = _codex_lifecycle(payload)
    await db.update_agent_lifecycle(
        payload.target_agent_slug,
        status=lifecycle_status,
        detail=lifecycle_detail,
        event=payload.kind,
    )
    await db.touch_agent_run_heartbeat(
        payload.target_agent_slug,
        source_kind=payload.kind,
    )
    await db.advance_task_from_lifecycle(
        payload.target_agent_slug,
        lifecycle_status=lifecycle_status,
        source_event=payload.kind,
    )

    return {"received": True, "event_id": event_id}
