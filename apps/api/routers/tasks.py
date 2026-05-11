"""
CRUD de `tasks` — missões plantadas no kanban do cockpit.

Idempotência: passa `idempotency_key` no POST. Colisão devolve 409 com a task
existente, sem reinserir.
"""
from __future__ import annotations

import logging
import sqlite3
import uuid
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from db.store import GrupoBorgesDB, _parse_csv_statuses
from services import tmux_driver

router = APIRouter()
log = logging.getLogger(__name__)

TaskStatus = Literal["backlog", "ready", "running", "review", "blocked", "done"]


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    assignee: str = Field(min_length=1)
    body: str | None = None
    instance_id: str | None = None
    origin_agent: str | None = None
    skill_hint: str | None = None
    status: TaskStatus = "backlog"
    priority: int = 0
    idempotency_key: str | None = None


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    body: str | None = None
    assignee: str | None = None
    instance_id: str | None = None
    skill_hint: str | None = None
    status: TaskStatus | None = None
    priority: int | None = None


class TaskHandoff(BaseModel):
    to_agent: str = Field(min_length=1)
    note: str | None = Field(default=None, max_length=1000)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)


async def _ensure_agent_exists(db: GrupoBorgesDB, slug: str) -> None:
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=400, detail=f"assignee {slug!r} não existe em agents")


async def _ensure_agent_has_tmux(db: GrupoBorgesDB, slug: str) -> dict[str, Any]:
    agent = await db.get_agent(slug)
    if agent is None:
        raise HTTPException(status_code=400, detail=f"to_agent {slug!r} não existe em agents")
    if not agent.get("tmux_session"):
        raise HTTPException(status_code=400, detail=f"to_agent {slug!r} não tem tmux_session")
    return agent


@router.get("")
async def list_tasks(
    request: Request,
    assignee: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
) -> list[dict[str, Any]]:
    db: GrupoBorgesDB = request.app.state.db
    if status:
        invalid = [
            s for s in _parse_csv_statuses(status)
            if s not in GrupoBorgesDB.TASK_STATUSES
        ]
        if invalid:
            raise HTTPException(status_code=400, detail=f"status inválido: {', '.join(invalid)}")
    return await db.list_tasks(assignee=assignee, status=status, limit=limit)


@router.get("/{task_id}")
async def get_task(task_id: str, request: Request) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    task = await db.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")
    return task


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_task(payload: TaskCreate, request: Request) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    await _ensure_agent_exists(db, payload.assignee)
    if payload.origin_agent:
        await _ensure_agent_exists(db, payload.origin_agent)

    if payload.idempotency_key:
        existing = await db.get_task_by_idempotency_key(payload.idempotency_key)
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail={"error": "idempotency_key collision", "existing": existing},
            )

    task_id = str(uuid.uuid4())
    try:
        return await db.create_task(
            id=task_id,
            title=payload.title,
            assignee=payload.assignee,
            body=payload.body,
            instance_id=payload.instance_id,
            origin_agent=payload.origin_agent,
            skill_hint=payload.skill_hint,
            status=payload.status,
            priority=payload.priority,
            idempotency_key=payload.idempotency_key,
        )
    except sqlite3.IntegrityError as e:
        # Race com outro POST mesma idempotency_key, ou FK em instance_id que não validamos
        # antes (tabela `agent_instances` não tem ainda checagem dedicada). Loga server-side
        # e devolve mensagem genérica pra não vazar schema.
        log.warning("IntegrityError ao criar task: %s", e)
        raise HTTPException(
            status_code=400,
            detail="violação de integridade — verifique assignee/origin_agent/instance_id/idempotency_key",
        )


@router.patch("/{task_id}")
async def patch_task(task_id: str, payload: TaskPatch, request: Request) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    fields = payload.model_dump(exclude_unset=True)
    if "assignee" in fields:
        await _ensure_agent_exists(db, fields["assignee"])

    try:
        updated = await db.update_task(task_id, fields)
    except sqlite3.IntegrityError as e:
        log.warning("IntegrityError ao atualizar task %s: %s", task_id, e)
        raise HTTPException(
            status_code=400,
            detail="violação de integridade — verifique assignee/instance_id",
        )
    if updated is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")
    return updated


@router.post("/{task_id}/handoff", status_code=status.HTTP_201_CREATED)
async def handoff_task(
    task_id: str, payload: TaskHandoff, request: Request
) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    to_agent_row = await _ensure_agent_has_tmux(db, payload.to_agent)

    child_id = str(uuid.uuid4())
    try:
        result = await db.create_task_handoff(
            parent_id=task_id,
            child_id=child_id,
            to_agent=payload.to_agent,
            note=payload.note,
            idempotency_key=payload.idempotency_key,
        )
    except sqlite3.IntegrityError as e:
        log.warning("IntegrityError ao criar handoff da task %s: %s", task_id, e)
        if payload.idempotency_key:
            existing = await db.get_task_by_idempotency_key(payload.idempotency_key)
            if existing is not None:
                raise HTTPException(
                    status_code=409,
                    detail={"error": "idempotency_key collision", "existing": existing},
                ) from e
        raise HTTPException(
            status_code=400,
            detail="violação de integridade — verifique task/to_agent/idempotency_key",
        ) from e

    if result is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")
    if result.get("idempotency_collision"):
        raise HTTPException(
            status_code=409,
            detail={
                "error": "idempotency_key collision",
                "existing": result["existing"],
            },
        )

    handoff_text = _format_handoff_message(
        parent=result["parent"],
        child=result["child"],
        note=payload.note,
    )
    tmux_delivered = False
    try:
        tmux_delivered = await tmux_driver.send_message(
            to_agent_row["tmux_session"], handoff_text
        )
    except Exception as e:
        log.warning(
            "Falha ao entregar handoff %s -> %s via tmux session %s: %s",
            task_id,
            result["child"]["id"],
            to_agent_row["tmux_session"],
            e,
        )

    return {
        "parent_id": task_id,
        "child_id": result["child"]["id"],
        "tmux_delivered": tmux_delivered,
    }


def _format_handoff_message(
    *, parent: dict[str, Any], child: dict[str, Any], note: str | None
) -> str:
    note_text = (note or "").strip()
    lines = [
        "Nova missão via cockpit handoff",
        f"Parent: {parent.get('human_id') or parent['id']} ({parent['id']})",
        f"Child: {child.get('human_id') or child['id']} ({child['id']})",
        f"Origem: {parent['assignee']}",
    ]
    if note_text:
        lines.append(f"Nota: {note_text}")
    return "\n".join(lines)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, request: Request) -> None:
    db: GrupoBorgesDB = request.app.state.db
    if not await db.delete_task(task_id):
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")
