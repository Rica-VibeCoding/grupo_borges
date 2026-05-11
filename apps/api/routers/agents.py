"""
GET /api/agents                     — lista 6 agentes da frota com state agregado
GET /api/agents/{slug}              — detalhe + state de um agente
GET /api/agents/{slug}/instances    — lista instâncias do agente (pílulas multi-instância)
GET /api/agents/{slug}/sparkline    — eventos por hora (mini-chart de atividade)
GET /api/agents/{slug}/skills       — skills do workspace (.claude/skills/*/SKILL.md)
GET /api/agents/{slug}/docs         — docs do workspace (lista + resolved com @include)
GET /api/agents/{slug}/tables       — tabelas do domínio do agente (de agents.yaml)
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from libtmux import exc as libtmux_exc
from pydantic import BaseModel, Field

from db.store import GrupoBorgesDB, build_hour_series, hour_window
from services import tmux_driver
from services import workspace_reader

router = APIRouter()
log = logging.getLogger(__name__)

InstanceStatus = Literal["idle", "running", "blocked", "done"]
AgentCli = Literal["claude_code", "codex"]
ALLOWED_MODELS = {
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "codex-gpt-5-5",
}


class AgentInstanceCreate(BaseModel):
    cli: AgentCli
    model: str = Field(min_length=1, max_length=80)
    is_subagent: bool = False


@router.get("")
async def list_agents(request: Request):
    db: GrupoBorgesDB = request.app.state.db
    return await db.list_agents()


@router.get("/{slug}")
async def get_agent(slug: str, request: Request):
    db: GrupoBorgesDB = request.app.state.db
    agent = await db.get_agent(slug)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return agent


@router.get("/{slug}/instances")
async def list_agent_instances(
    slug: str,
    request: Request,
    status: InstanceStatus | None = Query(default=None),
) -> list[dict[str, Any]]:
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return await db.list_agent_instances(slug, status=status)


@router.post("/{slug}/instances", status_code=status.HTTP_201_CREATED)
async def create_agent_instance(
    slug: str, payload: AgentInstanceCreate, request: Request
) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    if payload.model not in ALLOWED_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"model inválido: {payload.model}",
        )

    try:
        instance = await db.create_agent_instance(
            agent_slug=slug,
            cli=payload.cli,
            model=payload.model,
            is_subagent=payload.is_subagent,
        )
    except sqlite3.IntegrityError as e:
        log.warning("IntegrityError ao criar instância de %s: %s", slug, e)
        raise HTTPException(
            status_code=409,
            detail="colisão ao alocar instance_num; tente novamente",
        ) from e

    tmux_created = False
    session_error: str | None = None
    tmux_session = instance.get("tmux_session")
    if tmux_session:
        try:
            await tmux_driver.create_empty_session(tmux_session)
            tmux_created = True
        except libtmux_exc.LibTmuxException as e:
            log.warning("Falha ao criar tmux session %s: %s", tmux_session, e)
            session_error = str(e)

    response: dict[str, Any] = {
        "instance": instance,
        "tmux_created": tmux_created,
    }
    if session_error:
        response["session_error"] = session_error
    return response


@router.delete("/{slug}/instances/{instance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent_instance(slug: str, instance_id: str, request: Request) -> Response:
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")

    instance = await db.end_agent_instance(agent_slug=slug, instance_id=instance_id)
    if instance is None:
        raise HTTPException(status_code=404, detail=f"Instância {instance_id} não encontrada")

    tmux_session = instance.get("tmux_session")
    if tmux_session:
        try:
            await tmux_driver.kill_session_if_exists(tmux_session)
        except libtmux_exc.LibTmuxException as e:
            log.warning("Falha ao matar tmux session %s: %s", tmux_session, e)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{slug}/sparkline")
async def get_agent_sparkline(
    slug: str,
    request: Request,
    hours: int = Query(default=24, ge=1, le=168),
) -> list[dict[str, Any]]:
    """Série horária de `task_events` do agente.

    Retorna `hours` buckets cobrindo `[hora_corrente_UTC - (hours-1), hora_corrente_UTC]`,
    inclusive — ou seja, a hora atual + (hours-1) anteriores. Horas sem evento entram
    com `count=0` pra UI consumir série contínua sem gap-fill no cliente.
    """
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")

    start_dt, _ = hour_window(hours)
    counts = await db.event_counts_per_hour(slug, since_unix=int(start_dt.timestamp()))
    return build_hour_series(counts, start_dt, hours)


# ----- Fase 3: skills / docs / tables (alimenta o AgentModal) ---------------

@router.get("/{slug}/skills")
async def list_agent_skills(slug: str, request: Request) -> dict[str, Any]:
    """Skills disponíveis no workspace (parse de `.claude/skills/*/SKILL.md`).

    Detecta symlinks pra skills compartilhadas (`ze-shared/.claude/skills/`).
    """
    agent = await _get_agent_or_404(request, slug)
    skills = await asyncio.to_thread(workspace_reader.read_skills_cached, agent["workspace_path"])
    return {"slug": slug, "skills": skills, "count": len(skills)}


@router.get("/{slug}/docs")
async def list_agent_docs(
    slug: str,
    request: Request,
    filename: str | None = Query(default=None, description="Quando preenchido, devolve o doc com @include resolvido"),
) -> dict[str, Any]:
    """Docs do workspace (CLAUDE/SOUL/IDENTITY/AGENTS/TOOLS/OPS).

    Sem `filename`: lista os docs existentes (metadados leves).
    Com `filename`: devolve `content_md` com `@include` recursivo resolvido
    (cap profundidade 5, cap 256KB).
    """
    agent = await _get_agent_or_404(request, slug)
    if filename:
        resolved = await asyncio.to_thread(
            workspace_reader.read_doc_resolved, agent["workspace_path"], filename
        )
        if resolved is None:
            raise HTTPException(status_code=404, detail=f"Doc {filename} não encontrado em {slug}")
        return {"slug": slug, **resolved}

    docs = await asyncio.to_thread(workspace_reader.read_docs_cached, agent["workspace_path"])
    return {"slug": slug, "docs": docs, "count": len(docs)}


@router.get("/{slug}/tables")
async def list_agent_tables(slug: str, request: Request) -> dict[str, Any]:
    """Tabelas do domínio do agente — fonte de verdade: `agents.yaml`.

    Cada item: `{ name, db, description }`. Lista vazia é resposta válida
    (agente sem domínio de dados próprio).
    """
    await _get_agent_or_404(request, slug)
    config = request.app.state.agents_config
    tables: list[dict[str, Any]] = []
    for entry in config.get("agents", []):
        if entry.get("slug") == slug:
            tables = list(entry.get("domain_tables") or [])
            break
    return {"slug": slug, "tables": tables, "count": len(tables)}


async def _get_agent_or_404(request: Request, slug: str) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    agent = await db.get_agent(slug)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return agent
