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

from db.store import GrupoBorgesDB

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


async def _ensure_agent_exists(db: GrupoBorgesDB, slug: str) -> None:
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=400, detail=f"assignee {slug!r} não existe em agents")


@router.get("")
async def list_tasks(
    request: Request,
    assignee: str | None = Query(default=None),
    status: TaskStatus | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
) -> list[dict[str, Any]]:
    db: GrupoBorgesDB = request.app.state.db
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


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, request: Request) -> None:
    db: GrupoBorgesDB = request.app.state.db
    if not await db.delete_task(task_id):
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")
