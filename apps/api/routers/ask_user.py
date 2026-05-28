"""Long-poll backend para o MCP ask-user."""
from __future__ import annotations

import asyncio
import sqlite3
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from db.store import GrupoBorgesDB

router = APIRouter()

pending_events: dict[str, asyncio.Event] = {}
pending_answers: dict[str, list[str]] = {}

# Fila in-memory por agent_slug pro SSE — mesmo padrão de
# jsonl_watcher.subagent_status_events_since. stream_agent_messages drena via
# ask_user_events_since() no loop e emite com `event="ask_user"`. Reverse map
# request_id → slug pra rotear `answered`/`timeout` (payload do POST /answer
# não carrega slug).
_ask_user_events: dict[str, list[dict[str, Any]]] = {}
_ask_user_seq: int = 0
_ask_user_request_owner: dict[str, str] = {}
# Ring buffer por slug — evita memory leak. 200 é folga: cobre histórico
# de horas de uso ativo, e Last-Event-ID do SSE permite reconnect curto
# sem perder eventos. Mesmo padrão de _subagent_status_events em
# jsonl_watcher.py (mantém só os últimos N por slug).
_ASK_USER_BUFFER_MAX = 200


def _now_ms() -> int:
    return int(time.time() * 1000)


def _push_ask_user_event(slug: str, payload: dict[str, Any]) -> None:
    global _ask_user_seq
    _ask_user_seq += 1
    event = {"seq": _ask_user_seq, **payload}
    bucket = _ask_user_events.setdefault(slug, [])
    bucket.append(event)
    if len(bucket) > _ASK_USER_BUFFER_MAX:
        del bucket[: len(bucket) - _ASK_USER_BUFFER_MAX]


def ask_user_events_since(
    slug: str,
    after_seq: int,
) -> tuple[list[dict[str, Any]], int]:
    events = [
        event
        for event in _ask_user_events.get(slug, [])
        if int(event.get("seq", 0)) > after_seq
    ]
    latest_seq = after_seq
    if events:
        latest_seq = max(int(event["seq"]) for event in events)
    return events, latest_seq


def ask_user_active_snapshot(slug: str) -> list[dict[str, Any]]:
    """Devolve último estado conhecido por request_id pra novos clientes SSE.

    Cada request_id pode ter pending + answered/timeout na fila — interessa
    o mais recente (maior seq).
    """
    by_request: dict[str, dict[str, Any]] = {}
    for event in _ask_user_events.get(slug, []):
        request_id = event.get("request_id")
        if not isinstance(request_id, str):
            continue
        existing = by_request.get(request_id)
        if existing is None or int(event["seq"]) > int(existing["seq"]):
            by_request[request_id] = event
    return list(by_request.values())


def _public_event(event: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in event.items() if key != "seq"}


class AskUserOption(BaseModel):
    label: str
    description: str


class AskUserQuestion(BaseModel):
    question: str
    header: str
    options: list[AskUserOption] = Field(default_factory=list)
    multiSelect: bool = False


class AskUserWaitRequest(BaseModel):
    request_id: str
    agent_slug: str
    questions: list[AskUserQuestion]


class AskUserAnswerRequest(BaseModel):
    answers: list[str]


@router.get("/pending")
async def list_pending_slugs() -> dict[str, list[str]]:
    """Slugs com ask_user pendente — pro card da frota piscar laranja."""
    slugs = sorted({
        slug for request_id, slug in _ask_user_request_owner.items()
        if request_id in pending_events
    })
    return {"slugs": slugs}


@router.post("/wait")
async def wait_for_user(payload: AskUserWaitRequest, request: Request) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    request_id = payload.request_id
    agent_slug = payload.agent_slug
    questions = [question.model_dump() for question in payload.questions]

    if request_id in pending_events:
        raise HTTPException(status_code=409, detail="ask_user request_id já está pendente")
    if await db.get_agent(agent_slug) is None:
        raise HTTPException(status_code=400, detail=f"agent_slug {agent_slug!r} não existe em agents")

    event = asyncio.Event()
    pending_events[request_id] = event
    _ask_user_request_owner[request_id] = agent_slug

    try:
        try:
            await db.insert_ask_user_pending(
                request_id=request_id,
                agent_slug=agent_slug,
                questions=questions,
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="ask_user request_id já existe") from exc
        await db.insert_task_event(
            kind="ask_user:pending",
            agent_slug=agent_slug,
            payload={"request_id": request_id, "questions": questions},
        )
        _push_ask_user_event(agent_slug, {
            "kind": "pending",
            "request_id": request_id,
            "questions": questions,
            "created_at_ms": _now_ms(),
        })
        await asyncio.wait_for(event.wait(), timeout=1500)
        answers = pending_answers.pop(request_id, None)
        if answers is None:
            raise HTTPException(status_code=500, detail="Resposta ask_user ausente")
        return {"answers": answers}
    except TimeoutError as exc:
        await db.mark_ask_user_timeout(request_id)
        _push_ask_user_event(agent_slug, {
            "kind": "timeout",
            "request_id": request_id,
        })
        raise HTTPException(status_code=408, detail="Timeout aguardando resposta ask_user") from exc
    finally:
        pending_events.pop(request_id, None)
        pending_answers.pop(request_id, None)


@router.post("/answer/{request_id}")
async def answer_user(
    request_id: str,
    payload: AskUserAnswerRequest,
    request: Request,
) -> dict[str, bool]:
    db: GrupoBorgesDB = request.app.state.db
    updated = await db.answer_ask_user_request(request_id=request_id, answers=payload.answers)
    if not updated:
        raise HTTPException(status_code=404, detail="ask_user request pendente não encontrado")

    event = pending_events.get(request_id)
    if event is not None:
        pending_answers[request_id] = payload.answers
        event.set()

    await db.insert_task_event(
        kind="ask_user:answered",
        payload={"request_id": request_id, "answers": payload.answers},
    )
    slug = _ask_user_request_owner.get(request_id)
    if slug is not None:
        _push_ask_user_event(slug, {
            "kind": "answered",
            "request_id": request_id,
            "answers": payload.answers,
            "answered_at_ms": _now_ms(),
        })
    return {"ok": True}
