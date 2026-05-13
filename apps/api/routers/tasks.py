"""
CRUD de `tasks` — missões plantadas no kanban do cockpit.

Idempotência: passa `idempotency_key` no POST. Colisão devolve 409 com a task
existente, sem reinserir.
"""
from __future__ import annotations

import asyncio
import logging
import re
import sqlite3
import uuid
from typing import Annotated, Any, Literal, Union

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

REVIEWER_SLUG_RE = re.compile(r"^[a-z0-9_-]{1,64}$")

from db.store import GrupoBorgesDB, _parse_csv_statuses
from orchestrator.checkpoint_parser import checkpoint_hash
from services.criteria_executor import (
    parse_success_criteria,
    run_success_criteria,
)
from services.evidence_refs import validate_evidence_refs
from services.review_policy import assert_can_review, is_autonomous_allowed
from services import tmux_driver

router = APIRouter()
reviews_router = APIRouter()
log = logging.getLogger(__name__)

TaskStatus = Literal["backlog", "ready", "running", "review", "blocked", "done"]
ReviewMode = Literal["human", "agent_advisory", "agent_autonomous"]
ReviewAction = Literal["accept", "reject", "requeue"]


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
    review_mode: ReviewMode | None = None
    reviewer_assignee: str | None = None
    tags: list[str] | None = None


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    body: str | None = None
    assignee: str | None = None
    instance_id: str | None = None
    skill_hint: str | None = None
    status: TaskStatus | None = None
    priority: int | None = None
    review_mode: ReviewMode | None = None
    reviewer_assignee: str | None = None
    tags: list[str] | None = None


class _TaskReviewBase(BaseModel):
    note: str | None = Field(default=None, max_length=2000)
    criteria_results: dict[str, Any] | None = None
    evidence_refs: list[str] | None = None
    content_hash: str | None = Field(default=None, min_length=1, max_length=128)


class TaskReviewAccept(_TaskReviewBase):
    action: Literal["accept"]


class TaskReviewReject(_TaskReviewBase):
    action: Literal["reject"]


class TaskReviewRequeue(_TaskReviewBase):
    action: Literal["requeue"]


TaskReviewBody = Annotated[
    Union[TaskReviewAccept, TaskReviewReject, TaskReviewRequeue],
    Field(discriminator="action"),
]


class TaskHandoff(BaseModel):
    to_agent: str = Field(min_length=1)
    note: str | None = Field(default=None, max_length=1000)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)


class TaskDispatch(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


CheckpointState = Literal["DONE", "BLOCKED", "NEEDS_INPUT", "HANDOFF", "IN_PROGRESS"]


class TaskCheckpoint(BaseModel):
    state: CheckpointState
    summary: str | None = Field(default=None, max_length=500)
    files_changed: str | None = Field(default=None, max_length=1000)
    next_step: str | None = Field(default=None, max_length=500)
    handoff_to: str | None = Field(default=None, max_length=100)
    content_hash: str | None = Field(default=None, min_length=1, max_length=64)


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


async def _ensure_optional_agent_exists(db: GrupoBorgesDB, slug: str | None) -> None:
    if slug:
        await _ensure_agent_exists(db, slug)


async def _apply_review_fields(
    db: GrupoBorgesDB,
    task_id: str,
    fields: dict[str, Any],
) -> dict[str, Any] | None:
    review_fields = {
        key: fields.pop(key)
        for key in ("review_mode", "reviewer_assignee", "tags")
        if key in fields
    }
    if not review_fields:
        return None
    try:
        return await db.update_task_review_fields(task_id, **review_fields)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.get("")
async def list_tasks(
    request: Request,
    assignee: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
) -> list[dict[str, Any]]:
    db: GrupoBorgesDB = request.app.state.db
    await db.mark_stale_runs()
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
    await db.mark_stale_runs()
    task = await db.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")
    return task


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_task(payload: TaskCreate, request: Request) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    await _ensure_agent_exists(db, payload.assignee)
    await _ensure_optional_agent_exists(db, payload.reviewer_assignee)
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
        created = await db.create_task(
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
        review_fields = payload.model_dump(
            include={"review_mode", "reviewer_assignee", "tags"},
            exclude_unset=True,
        )
        updated = await _apply_review_fields(db, task_id, review_fields)
        return updated or created
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
    if "reviewer_assignee" in fields:
        await _ensure_optional_agent_exists(db, fields["reviewer_assignee"])

    try:
        review_updated = await _apply_review_fields(db, task_id, fields)
        updated = await db.update_task(task_id, fields)
    except sqlite3.IntegrityError as e:
        log.warning("IntegrityError ao atualizar task %s: %s", task_id, e)
        raise HTTPException(
            status_code=400,
            detail="violação de integridade — verifique assignee/instance_id",
        )
    if updated is None:
        if review_updated is None:
            raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")
        return review_updated
    return updated


async def _derive_reviewer(
    request: Request,
    db: GrupoBorgesDB,
    fallback_header_slug: str | None,
) -> str:
    """Identifica o reviewer da request.

    Prioridade:
    1. `Tailscale-User-Login` (humano autenticado pelo tailscaled) → lookup em
       `app.state.humans`. Slug humano só passa se estiver mapeado.
    2. Fallback `X-Reviewer-Slug` para server-to-server (agentes em loopback,
       dev local com `GB_DEV_BYPASS_AUTH=1`). Só aceita slug existente em
       `agents.yaml` — fecha o vetor de humano arbitrário via header.

    Retorna o slug do reviewer (lowercase). Levanta HTTPException 401/403/400.
    """
    humans: dict[str, str] = getattr(request.app.state, "humans", {}) or {}
    ts_user = getattr(request.state, "tailscale_user", None)
    if ts_user:
        mapped = humans.get(ts_user.strip().lower())
        if not mapped:
            raise HTTPException(
                status_code=403,
                detail=f"Tailscale login {ts_user!r} não autorizado para review",
            )
        return mapped

    # Loopback / dev_bypass — sem Tailscale-User-Login.
    # Permite GB_DEV_DEFAULT_REVIEWER pra simular reviewer humano em dev.
    settings = getattr(request.app.state, "settings", None)
    if settings and getattr(settings, "dev_default_reviewer", ""):
        return settings.dev_default_reviewer.strip().lower()
    if not fallback_header_slug:
        raise HTTPException(
            status_code=401,
            detail="missing reviewer: forneça Tailscale-User-Login ou X-Reviewer-Slug",
        )
    candidate = fallback_header_slug.strip().lower()
    if not REVIEWER_SLUG_RE.match(candidate):
        raise HTTPException(
            status_code=400,
            detail="X-Reviewer-Slug inválido (use [a-z0-9_-]{1,64})",
        )
    # Slug por header só pode ser agente existente.
    agents = await db.list_agents()
    if not any(a["slug"] == candidate for a in agents):
        raise HTTPException(
            status_code=403,
            detail=f"X-Reviewer-Slug {candidate!r} não está em agents.yaml "
            "(use Tailscale-User-Login para reviewer humano)",
        )
    return candidate


@router.post("/{task_id}/review")
async def review_task(
    task_id: str,
    payload: TaskReviewBody,
    request: Request,
    reviewer_slug: Annotated[str | None, Header(alias="X-Reviewer-Slug")] = None,
) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    task = await db.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")

    reviewer = await _derive_reviewer(request, db, reviewer_slug)
    evidence_refs = payload.evidence_refs or []
    autonomous_accept = (
        payload.action == "accept" and task.get("review_mode") == "agent_autonomous"
    )
    criteria: list = []
    assignee_workspace: str | None = None
    if autonomous_accept:
        allowed, reason = is_autonomous_allowed(task)
        if not allowed:
            raise HTTPException(status_code=422, detail=reason or "review autonomous vetado")

        agents = await db.list_agents()
        agents_db = {agent["slug"]: agent for agent in agents}
        assignee_agent = agents_db.get(task["assignee"])
        if assignee_agent is None:
            raise HTTPException(
                status_code=422,
                detail=f"assignee {task['assignee']!r} não está em agents.yaml",
            )
        # Humanos (slug não está em agents.yaml — vem do map `humans` via
        # Tailscale-User-Login) pulam `assert_can_review`: já são autorizados
        # via identidade. Whitelist `can_review` é orientada a agent-to-agent.
        humans_map: dict[str, str] = getattr(request.app.state, "humans", {}) or {}
        is_human_reviewer = reviewer in set(humans_map.values())
        if not is_human_reviewer:
            try:
                assert_can_review(reviewer, task["assignee"], agents_db)
            except (KeyError, ValueError) as e:
                raise HTTPException(status_code=403, detail=str(e)) from e

        if not evidence_refs:
            raise HTTPException(status_code=422, detail="evidence_refs obrigatório para accept autonomous")

        workspace = assignee_agent["workspace_path"]
        repo_aliases = {agent["slug"]: agent["workspace_path"] for agent in agents}
        try:
            evidence_results = validate_evidence_refs(evidence_refs, workspace, repo_aliases)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        invalid = [item for item in evidence_results if not item.get("valid")]
        if invalid:
            raise HTTPException(status_code=422, detail={"invalid_evidence_refs": invalid})

        try:
            criteria = parse_success_criteria(task.get("body"))
        except ValueError as e:
            raise HTTPException(status_code=422, detail=f"Success Criteria malformado: {e}") from e
        if not criteria:
            raise HTTPException(
                status_code=422,
                detail="autonomous accept exige bloco '## Success Criteria' no body com pelo menos 1 cmd",
            )
        assignee_workspace = workspace

    review_payload = payload.model_dump(exclude_none=True, exclude={"content_hash"})
    result = await db.record_review_action(
        task_id,
        payload.action,
        reviewer,
        review_payload,
        payload.content_hash,
    )
    if result is None:
        raise HTTPException(status_code=409, detail="review duplicado ou não gravado")
    task_result = result.get("task") or {}

    # Autonomous accept: dispara executor em background. Task fica em status=review
    # (criteria_pending) até os comandos terminarem. Promoção pra done acontece
    # dentro do `run_success_criteria` se todos passarem; falha volta pra running.
    if autonomous_accept and criteria and assignee_workspace:
        await db.update_task(task_id, {"status": "review"})
        asyncio.create_task(
            run_success_criteria(
                task_id=task_id,
                assignee_slug=task["assignee"],
                criteria=criteria,
                workspace=assignee_workspace,
                db=db,
                reviewer=reviewer,
                event_id_origin=result["event_id"],
            )
        )
        return {
            "event_id": result["event_id"],
            "new_status": "review",
            "criteria_pending": True,
            "criteria_count": len(criteria),
            "content_hash": payload.content_hash,
        }

    return {
        "event_id": result["event_id"],
        "new_status": task_result.get("status"),
        "content_hash": payload.content_hash,
    }


@reviews_router.get("")
async def list_reviews(
    request: Request,
    reviewer: str | None = Query(default=None, min_length=1),
    since_id: int | None = Query(default=None, ge=0),
    limit: int = Query(default=50, ge=1, le=500),
) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    events = await db.list_review_events(
        reviewer_slug=reviewer,
        since_id=since_id,
        limit=limit,
    )
    return {
        "events": events,
        "next_since_id": max((event["id"] for event in events), default=since_id),
    }


@router.post("/{task_id}/dispatch", status_code=status.HTTP_202_ACCEPTED)
async def dispatch_task(
    task_id: str, payload: TaskDispatch, request: Request
) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    task = await db.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")
    agent = await _ensure_agent_has_tmux(db, task["assignee"])

    try:
        claimed = await db.claim_task_dispatch(task_id, note=payload.note)
    except ValueError as e:
        status_code = 409 if "execução" in str(e) else 400
        raise HTTPException(status_code=status_code, detail=str(e)) from e
    if claimed is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")

    run_id = claimed["run_id"]
    dispatch_text = _format_dispatch_message(task=claimed["task"], note=payload.note)
    try:
        tmux_delivered = await tmux_driver.send_message(agent["tmux_session"], dispatch_text)
    except Exception as e:
        await db.record_task_dispatch_failed(
            task_id,
            run_id=run_id,
            tmux_session=agent["tmux_session"],
            reason="tmux_exception",
        )
        log.warning(
            "Falha ao despachar task %s para tmux session %s: %s",
            task_id,
            agent["tmux_session"],
            e,
        )
        raise HTTPException(status_code=502, detail="falha ao enviar mensagem para tmux") from e
    if not tmux_delivered:
        await db.record_task_dispatch_failed(
            task_id,
            run_id=run_id,
            tmux_session=agent["tmux_session"],
            reason="tmux_session_not_found",
        )
        raise HTTPException(
            status_code=409,
            detail=f"tmux session {agent['tmux_session']!r} não encontrada",
        )

    dispatched = await db.record_task_dispatch_delivered(
        task_id,
        run_id=run_id,
        tmux_session=agent["tmux_session"],
        note=payload.note,
    )
    if dispatched is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")

    return {
        "task": dispatched["task"],
        "run_id": dispatched["run_id"],
        "event_id": dispatched["event_id"],
        "tmux_delivered": True,
    }


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

    hop_limited = result.get("hop_limit_blocked", False)
    tmux_delivered = False
    if not hop_limited:
        handoff_text = _format_handoff_message(
            parent=result["parent"],
            child=result["child"],
            note=payload.note,
        )
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
        "hop_limit_blocked": hop_limited,
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


def _format_dispatch_message(*, task: dict[str, Any], note: str | None) -> str:
    note_text = (note or "").strip()
    display_id = task.get("human_id") or task["id"]
    lines = [
        "Nova missão via cockpit",
        f"Task: {display_id} ({task['id']})",
        f"Título: {task['title']}",
    ]
    body = (task.get("body") or "").strip()
    if body:
        lines.append(f"Body: {body}")
    if note_text:
        lines.append(f"Nota: {note_text}")
    lines.append("Ao iniciar, mantenha esta task como referência no retorno.")
    return "\n".join(lines)


@router.post("/{task_id}/checkpoint")
async def checkpoint_task(
    task_id: str, payload: TaskCheckpoint, request: Request
) -> dict[str, Any]:
    """Registra um checkpoint do agente e transita o status da task no kanban.

    Idempotente: se content_hash for omitido, é calculado automaticamente.
    Chamadas duplicadas (mesmo content_hash) retornam 200 sem re-processar.
    """
    db: GrupoBorgesDB = request.app.state.db

    task = await db.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")

    # Calcula content_hash se não veio no body
    chash = payload.content_hash or checkpoint_hash(
        state=payload.state,
        summary=payload.summary,
        files_changed=payload.files_changed,
        next_step=payload.next_step,
    )

    result = await db.record_checkpoint(
        task_id=task_id,
        agent_slug=task.get("assignee"),
        state=payload.state,
        summary=payload.summary,
        files_changed=payload.files_changed,
        next_step=payload.next_step,
        handoff_to=payload.handoff_to,
        content_hash=chash,
        source="api",
    )

    if result is None:
        return {
            "duplicate": True,
            "task_id": task_id,
            "state": payload.state,
            "content_hash": chash,
        }

    return {
        "duplicate": False,
        "event_id": result["event_id"],
        "task_id": task_id,
        "state": payload.state,
        "new_task_status": result["new_task_status"],
        "content_hash": chash,
    }


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, request: Request) -> None:
    db: GrupoBorgesDB = request.app.state.db
    if not await db.delete_task(task_id):
        raise HTTPException(status_code=404, detail=f"task {task_id} não encontrada")
