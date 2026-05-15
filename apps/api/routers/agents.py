"""
GET  /api/agents                       — lista 6 agentes da frota com state agregado
GET  /api/agents/{slug}                — detalhe + state de um agente
GET  /api/agents/{slug}/instances      — lista instâncias do agente (pílulas multi-instância)
GET  /api/agents/{slug}/sparkline      — eventos por hora (mini-chart de atividade)
GET  /api/agents/{slug}/skills         — skills do workspace (.claude/skills/*/SKILL.md)
GET  /api/agents/{slug}/docs           — docs do workspace (lista + resolved com @include)
GET  /api/agents/{slug}/tables         — tabelas do domínio do agente (de agents.yaml)
GET  /api/agents/{slug}/pane/stream    — DS-2 stub: SSE com excerpt do pane (1 Hz na impl)
POST /api/agents/{slug}/input          — DS-2 stub: envia texto pro pane via paste-buffer
POST /api/agents/{slug}/model          — DS-2 stub: troca modelo via /model <slug>
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time
from typing import Any, AsyncGenerator, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from libtmux import exc as libtmux_exc
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from db.store import GrupoBorgesDB, build_hour_series, hour_window
from services import tmux_driver
from services import workspace_reader

router = APIRouter()
log = logging.getLogger(__name__)

InstanceStatus = Literal["idle", "running", "blocked", "done"]
AgentCli = Literal["claude_code", "codex"]
MODELS_BY_CLI: dict[AgentCli, set[str]] = {
    "claude_code": {"claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"},
    "codex": {
        "codex-gpt-5-5",
        "codex-gpt-5-4",
        "codex-gpt-5-4-mini",
        "codex-gpt-5-3-codex",
        "codex-gpt-5-2",
    },
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
    agent = await db.get_agent(slug)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    if payload.model not in MODELS_BY_CLI[payload.cli]:
        raise HTTPException(
            status_code=400,
            detail=f"combinação cli={payload.cli} + model={payload.model} inválida",
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
    bootstrap_result = {
        "bootstrap_attempted": False,
        "bootstrap_confirmed": False,
    }
    tmux_session = instance.get("tmux_session")
    if tmux_session:
        try:
            await tmux_driver.create_empty_session(tmux_session)
            tmux_created = True
        except libtmux_exc.LibTmuxException as e:
            log.warning("Falha ao criar tmux session %s: %s", tmux_session, e)
            session_error = str(e)

        if tmux_created and not payload.is_subagent:
            try:
                bootstrap = await tmux_driver.bootstrap_cli_in_session(
                    tmux_session,
                    agent["workspace_path"],
                    payload.cli,
                    payload.model,
                )
                bootstrap_result = {
                    f"bootstrap_{k}": v for k, v in bootstrap.items()
                }
            except (libtmux_exc.LibTmuxException, ValueError) as e:
                log.warning("Falha ao bootar CLI em %s: %s", tmux_session, e)
                session_error = str(e)

    response: dict[str, Any] = {
        "instance": instance,
        "tmux_created": tmux_created,
        **bootstrap_result,
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
    filename: str | None = Query(default=None, description="Quando preenchido, devolve o conteúdo do doc"),
    resolve: bool = Query(default=False, description="Se true, expande @include inline (default: false — conteúdo cru)"),
) -> dict[str, Any]:
    """Docs do workspace (CLAUDE/SOUL/IDENTITY/AGENTS/TOOLS/OPS).

    Sem `filename`: lista os docs existentes (metadados leves).
    Com `filename`: devolve `content_md` cru (default) ou com `@include`
    expandido inline quando `resolve=true` (cap profundidade 5, cap 256KB).
    """
    agent = await _get_agent_or_404(request, slug)
    if filename:
        resolved = await asyncio.to_thread(
            workspace_reader.read_doc_resolved,
            agent["workspace_path"],
            filename,
            resolve=resolve,
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


# ----- Chat / Pane endpoints (DS-2) ---------------------------------------
# Stubs. Tipos + roteamento + gates determinísticos prontos; lógica real entra
# em passo 2 (send_message, capture_pane loop, upsert_agent_state, task_event).

ChatModel = Literal["opus", "sonnet", "haiku"]


class PaneStreamEvent(BaseModel):
    excerpt: str
    captured_at: int
    executor_kind: str


class InputRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8192)
    idempotency_key: str = Field(min_length=1, max_length=128)


class InputResponse(BaseModel):
    tmux_delivered: bool
    sent_at: int


class ModelChangeRequest(BaseModel):
    model: ChatModel
    force: bool = False


class ModelChangeResponse(BaseModel):
    tmux_delivered: bool
    state_persisted: bool
    confirmed: bool
    model: str


@router.get("/{slug}/pane/stream")
async def stream_agent_pane(slug: str, request: Request) -> EventSourceResponse:
    """SSE com excerpt do pane em tempo real (1 Hz na impl real).

    Stub: 404 quando agente não existe; senão emite 1 evento placeholder e fecha.
    Tara: teste cobre 404 + recebimento do placeholder + close gracioso.
    """
    await _get_agent_or_404(request, slug)

    async def _placeholder_stream() -> AsyncGenerator[dict, None]:
        yield {
            "event": "pane",
            "data": json.dumps(
                {
                    "excerpt": "",
                    "captured_at": int(time.time()),
                    "executor_kind": "",
                    "stub": True,
                }
            ),
        }

    return EventSourceResponse(_placeholder_stream())


@router.post("/{slug}/input", response_model=InputResponse)
async def send_agent_input(
    slug: str, payload: InputRequest, request: Request
) -> InputResponse:
    """Cola `payload.text` no pane ativo via tmux paste-buffer + Enter.

    Stub: 404 quando agente não existe; valida payload via Pydantic (422 em
    text vazio/>8KB ou idempotency_key vazio/>128); senão 501.
    Impl real: chama tmux_driver.send_message, retorna delivered.
    """
    await _get_agent_or_404(request, slug)
    raise HTTPException(status_code=501, detail="not_implemented")


@router.post("/{slug}/model", response_model=ModelChangeResponse)
async def change_agent_model(
    slug: str, payload: ModelChangeRequest, request: Request
) -> ModelChangeResponse:
    """Troca modelo do agente via `/model <slug>` (Claude Code).

    Gates:
    - 404 quando agente não existe
    - 422 (Pydantic) quando model fora do whitelist opus/sonnet/haiku
    - 422 `codex_no_runtime_model_switch` quando executor_kind=codex (DS-2.1)
    - 409 `agent_busy_confirm_required` quando lifecycle=trabalhando sem force

    Caminho feliz (200):
    1. envia `/model <slug>` via send_message
    2. picker idempotente: aguarda 300ms e envia Enter extra
    3. poll capture_pane_excerpt em t+500/1000/1500ms; regex parse_model_from_pane
       confirma propagação. `confirmed=False` é warning (não erro).
    4. persiste state_model SÓ se delivered=True (inversão v2)
    5. emite task_event `agent.model_change` com {from, to, actor, confirmed}
    """
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") == "codex":
        raise HTTPException(status_code=422, detail="codex_no_runtime_model_switch")
    if agent.get("lifecycle_status") == "trabalhando" and not payload.force:
        raise HTTPException(status_code=409, detail="agent_busy_confirm_required")

    db: GrupoBorgesDB = request.app.state.db
    session = agent["tmux_session"]
    target = payload.model
    from_model = agent.get("state_model") or agent.get("model_default")

    delivered = await tmux_driver.send_message(session, f"/model {target}")

    state_persisted = False
    confirmed = False

    if delivered:
        # Picker do /model pode parar em prompt de confirmação ("Switch to ... y/n").
        # Enter idempotente: sem picker, cai em prompt vazio e o CC ignora.
        await asyncio.sleep(0.3)
        await tmux_driver.press_enter(session)

        # Poll de confirmação em t+500/1000/1500ms (acumulado). Sai cedo no match.
        for _ in range(3):
            await asyncio.sleep(0.5)
            excerpt = await tmux_driver.capture_pane_excerpt(session)
            if tmux_driver.parse_model_from_pane(excerpt) == target:
                confirmed = True
                break

        # Persistência só após delivered=True (v2: sem regressão silenciosa).
        await db.upsert_agent_state(slug, model=target)
        state_persisted = True

        await db.insert_task_event(
            kind="agent.model_change",
            agent_slug=slug,
            payload={
                "from": from_model,
                "to": target,
                "actor": "cockpit",
                "confirmed": confirmed,
            },
        )

    return ModelChangeResponse(
        tmux_delivered=delivered,
        state_persisted=state_persisted,
        confirmed=confirmed,
        model=target,
    )
