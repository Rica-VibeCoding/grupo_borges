"""
GET /api/fleet — snapshot agregado da frota para a UI montar o dashboard em 1 request.

Combina o que `/api/agents` + N× `/instances` + N× `/sparkline` + agregados de
tasks devolveriam, num único payload. Resposta inclui status derivado (`offline`
quando a sessão tmux ou o Claude Code está ausente), pra UI não replicar regra.
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from db.store import GrupoBorgesDB, RUN_STALE_THRESHOLD_SECONDS
from services import codex_reader, tmux_driver

router = APIRouter()
_CC_STATUS_PREFIX = "cc-status-"
# Par do `_AGENT_PAINEL_CONTEXTO_STALE_AFTER_SECONDS` (routers/agents.py): mesmo
# limiar do OFFLINE da frota, pra card e painel não julgarem o mesmo número com
# réguas diferentes.
CONTEXT_STALE_AFTER_SECONDS = 300

AgentStatus = Literal["ocioso", "trabalhando", "aguardando", "offline"]


class SparklineBucket(BaseModel):
    bucket: str  # ISO UTC "%Y-%m-%dT%H:00:00Z"
    count: int
    tokens: int = 0  # DS-58: SUM(input+output) da hora; altura da sparkline.


class FleetAgent(BaseModel):
    # campos da tabela agents
    slug: str
    name: str
    role: str | None
    emoji: str | None
    tmux_session: str
    workspace_path: str
    cli_default: str
    model_default: str
    # Família de modelos do agente (agents.yaml). "kimi" no Hiro — drive o
    # seletor de modelo/effort do front; None = família Anthropic padrão.
    model_family: str | None = None
    capabilities: list[str]
    created_at: int
    updated_at: int
    # state agregado (LEFT JOIN agent_state)
    state_cli: str | None
    state_model: str | None
    current_task_id: str | None
    current_task_last_heartbeat: int | None = None
    last_seen: int | None
    pane_excerpt: str | None
    executor_kind: str | None = None
    status_line: str | None = None
    active_task_label: str | None = None
    context_pct: float | None = None
    # Quando o `context_pct` foi MEDIDO, e se essa medida já não vale como atual.
    # Sem isto o card mostrava número de run morto com cara de leitura de agora.
    context_updated_at: int | None = None
    context_stale: bool = False
    session_started_at: int | None = None
    last_assistant_message: str | None = None
    token_usage_json: str | None = None
    codex_tokens_used: int | None = None
    codex_next_fresh: bool | None = None
    lifecycle_status: str | None = None
    lifecycle_detail: str | None = None
    lifecycle_event: str | None = None
    lifecycle_updated_at: int | None = None
    pane_session_started_at: int | None = None
    # campos derivados/hidratados pelo snapshot
    status: AgentStatus
    sparkline: list[SparklineBucket]


class FleetKpis(BaseModel):
    total: int
    trabalhando: int
    aguardando: int
    ocioso: int
    offline: int
    tasks_active: int
    tasks_running: int
    tasks_blocked: int
    tasks_done: int


class FleetHealth(BaseModel):
    last_sync: int | None = Field(
        default=None, description="max(agents.last_seen). NULL se nenhum heartbeat ainda.",
    )
    server_now: int = Field(description="unix ts do servidor — UI calcula 'há Xs' contra isso")
    offline_threshold_seconds: int
    stale_threshold_seconds: int


class FleetSnapshot(BaseModel):
    agents: list[FleetAgent]
    kpis: FleetKpis
    health: FleetHealth


async def _hydrate_pane_excerpts(agents: list[dict]) -> None:
    async def capture(agent: dict) -> tuple[str, str | None]:
        session_name = agent.get("tmux_session")
        if not session_name:
            return agent["slug"], None
        return agent["slug"], await tmux_driver.capture_pane_excerpt(session_name)

    results = await asyncio.gather(*(capture(agent) for agent in agents))
    by_slug = dict(results)
    now = int(time.time())
    for agent in agents:
        excerpt = by_slug.get(agent["slug"])
        agent["pane_excerpt"] = excerpt
        elapsed = tmux_driver.parse_session_elapsed_from_pane(excerpt)
        # statusline do CLI é mais fresco que agent_instances quando o usuário
        # fez /clear ou reiniciou o claude dentro da mesma tmux session.
        agent["pane_session_started_at"] = now - elapsed if elapsed is not None else None


def _num_or_none(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _read_cc_context_pct(session_id: str) -> tuple[float | None, int | None]:
    """O número E a hora em que ele foi medido — os dois ou nenhum.

    Devolver só o percentual era o que deixava `_marca_contexto_velho` cego no
    caminho Claude Code: sem carimbo não há como um número envelhecer.
    """
    path = Path("/tmp") / f"{_CC_STATUS_PREFIX}{session_id}.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, None
    if not isinstance(payload, dict):
        return None, None
    context_window = payload.get("context_window")
    if not isinstance(context_window, dict):
        return None, None
    return _num_or_none(context_window.get("used_percentage")), _int_or_none(
        payload.get("updated_at")
    )


async def _hydrate_cc_context_pct(db: GrupoBorgesDB, agents: list[dict]) -> None:
    """O contexto é o da sessão que está NO AR — ou zero.

    Andava pra trás nas sessões recentes até achar um arquivo legível, e era
    isso que publicava o percentual de uma sessão morta como se fosse de agora:
    depois do `/clear` a sessão nova leva minutos até escrever a primeira
    statusline (medido no Canário em 10/08 — clear 16h01, arquivo só 16h24), e
    nessa janela inteira o card mostrava os 16% da conversa que o Rica tinha
    acabado de apagar.

    Sem número da sessão atual o valor é zero, nunca o da anterior: ordem do
    Rica — *"ou mostra a verdade, se o harness não entrega, então colocar 0"*.
    E zero é o que o próprio harness diz nesse estado — sessão recém-aberta
    grava `used_percentage: null` com `total_input_tokens: 0`.
    """
    async def hydrate(agent: dict) -> None:
        if agent.get("executor_kind") == "codex":
            return
        if agent.get("context_pct") is not None:
            return
        session_ids = await db.recent_jsonl_session_ids(agent["slug"])
        if not session_ids:
            return
        pct, medido_em = await asyncio.to_thread(_read_cc_context_pct, session_ids[0])
        agent["context_pct"] = pct if pct is not None else 0.0
        agent["context_updated_at"] = medido_em

    await asyncio.gather(*(hydrate(agent) for agent in agents))


async def _hydrate_codex_tokens_used(agents: list[dict]) -> None:
    async def hydrate(agent: dict) -> None:
        if agent.get("executor_kind") != "codex":
            agent["codex_tokens_used"] = None
            return
        # Pelo id do run, não pelo workspace cadastrado: o run sai com
        # `-C <repo do dia>` e a busca por cwd achava a thread do run anterior.
        thread = await asyncio.to_thread(
            codex_reader.resolve_thread,
            thread_id=agent.get("codex_thread_id"),
            cwd=agent.get("workspace_path") or codex_reader.TARA_CWD,
        )
        agent["codex_tokens_used"] = thread.tokens_used if thread is not None else None
        stored_pct = None
        stored_observed_at = None
        raw_usage = agent.get("token_usage_json")
        if isinstance(raw_usage, str) and raw_usage.strip():
            try:
                stored_usage = json.loads(raw_usage)
            except (json.JSONDecodeError, ValueError):
                stored_usage = None
            if (
                isinstance(stored_usage, dict)
                and stored_usage.get("source") == "codex.event_msg.token_count"
                and stored_usage.get("context_pct") is not None
            ):
                stored_pct = stored_usage["context_pct"]
                stored_observed_at = _int_or_none(stored_usage.get("observed_at"))
        if thread is not None:
            snapshot = await asyncio.to_thread(codex_reader.read_latest_token_count, thread.rollout_path)
            if snapshot is not None:
                usa_snapshot = snapshot.get("context_pct") is not None
                agent["context_pct"] = snapshot["context_pct"] if usa_snapshot else stored_pct
                agent["context_updated_at"] = (
                    _int_or_none(snapshot.get("observed_at")) if usa_snapshot else stored_observed_at
                )
                return
        if stored_pct is not None:
            agent["context_pct"] = stored_pct
            agent["context_updated_at"] = stored_observed_at
        if agent.get("context_pct") is not None and agent.get("context_updated_at") is None:
            # Codex sem carimbo é o `context_pct` que ficou no banco de algum run
            # passado (a Tara tinha 100.0 parado lá). Não dá pra dizer a idade,
            # mas dá pra não afirmar que é de agora.
            agent["context_stale"] = True

    await asyncio.gather(*(hydrate(agent) for agent in agents))


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _marca_contexto_velho(agents: list[dict]) -> None:
    """A idade do número vai junto com o número — quem lê o card decide por ela.

    Duas maneiras de estar velho, as mesmas do painel: medida anterior ao início
    da sessão é de outro run, e medida parada além do limiar é de agente que
    dormiu. O número CONTINUA na tela; o que muda é o que a tela afirma sobre ele.

    Só age quando o carimbo é da mesma leitura que produziu o número. Valia só
    pro Codex enquanto o card do Claude Code bebia do pane — texto de terminal
    não tem hora, e carimbá-lo com a idade do cc-status seria trocar uma
    afirmação errada por outra. Desde 10/08 as duas pontas do CC vêm do mesmo
    arquivo, então a régua passou a valer aqui também.
    """
    agora = int(time.time())
    for agent in agents:
        medido_em = _int_or_none(agent.get("context_updated_at"))
        if agent.get("context_pct") is None or medido_em is None:
            continue
        iniciou = _int_or_none(agent.get("session_started_at"))
        agent["context_stale"] = (
            (iniciou is not None and medido_em < iniciou)
            or agora - medido_em > CONTEXT_STALE_AFTER_SECONDS
        )


@router.get("", response_model=FleetSnapshot)
async def get_fleet(
    request: Request,
    sparkline_hours: int = Query(default=24, ge=1, le=168),
):
    db: GrupoBorgesDB = request.app.state.db
    await db.mark_stale_runs()
    tmux_inventory = await tmux_driver.list_session_inventory()
    snapshot = await db.fleet_snapshot(
        sparkline_hours=sparkline_hours,
        active_tmux_sessions=tmux_inventory.sessions,
        active_claude_process_sessions=tmux_inventory.claude_process_sessions,
    )
    snapshot["health"]["stale_threshold_seconds"] = RUN_STALE_THRESHOLD_SECONDS
    await _hydrate_pane_excerpts(snapshot["agents"])
    await _hydrate_codex_tokens_used(snapshot["agents"])
    await _hydrate_cc_context_pct(db, snapshot["agents"])
    _marca_contexto_velho(snapshot["agents"])
    return snapshot
