"""`/api/agents/{slug}/conversas` — retomar conversa antiga do CC pelo cockpit.

Contrato em `docs/conversas/PLANO.md` ("Contrato da API"). F2: só a leitura.
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from config import get_settings
from db.store import GrupoBorgesDB
from orchestrator.jsonl_watcher import _mapear_por_encoded, encoded_cwd
from routers.agents import _get_agent_or_404
from services import conversas, tmux_driver

logger = logging.getLogger(__name__)

router = APIRouter()


class ConversaItem(BaseModel):
    id: str
    titulo: str
    titulo_origem: Literal["estacionada", "custom", "ai", "prompt", "primeira"]
    nota: str | None
    atualizada_em: int  # epoch ms (mtime do JSONL)
    turnos: int
    bytes: int
    estrela: bool
    atual: bool
    bloqueada: bool
    pendencia: int | None


class ConversasResposta(BaseModel):
    suportado: bool
    conversas: list[ConversaItem]
    escondidas_curtas: int


_VAZIA_SUPORTADA = ConversasResposta(suportado=True, conversas=[], escondidas_curtas=0)


def _projects_dir(request: Request) -> Path:
    settings = getattr(request.app.state, "settings", None) or get_settings()
    return Path(settings.claude_projects_dir)


async def _atuais_de_outras_linhas_vivas(db: GrupoBorgesDB, slug: str) -> set[str]:
    """A conversa atual de cada OUTRA linha com sessão tmux de pé.

    Inventário do tmux que falha não pode virar "ninguém vivo": aí todas as
    outras linhas contam como vivas — trava a mais, nunca a menos.
    """
    outras = [a for a in await db.list_agents() if a["slug"] != slug]
    try:
        vivas = await tmux_driver.list_session_names()
        outras = [a for a in outras if a.get("tmux_session") in vivas]
    except Exception as exc:  # noqa: BLE001 — qualquer falha de observação
        logger.warning("conversas: inventário do tmux falhou (%s); todas contam como vivas", exc)
    atuais = await asyncio.gather(*(db.latest_jsonl_session_id(a["slug"]) for a in outras))
    return {sid for sid in atuais if sid}


@router.get("/{slug}/conversas", response_model=ConversasResposta)
async def get_conversas(
    request: Request,
    slug: str,
    filtro: Literal["todas", "estrela", "pendencia"] = "todas",
    q: str | None = Query(default=None, max_length=200),
    curtas: int = Query(default=0, ge=0, le=1),
) -> ConversasResposta:
    agent = await _get_agent_or_404(request, slug)
    if (agent.get("cli_default") or "claude_code") != "claude_code":
        return ConversasResposta(suportado=False, conversas=[], escondidas_curtas=0)

    # Mesma régua do JSONL watcher: pasta dividida por dois agentes não é de
    # nenhum deles — listar daria a um as conversas do outro.
    config = getattr(request.app.state, "agents_config", None) or {}
    agentes = config.get("agents") or [agent]
    encoded = encoded_cwd(agent["workspace_path"])
    if _mapear_por_encoded(agentes).get(encoded) != slug:
        return _VAZIA_SUPORTADA

    db: GrupoBorgesDB = request.app.state.db
    metas, atual, atuais_de_outras = await asyncio.gather(
        db.conversa_meta_do_agente(slug),
        db.latest_jsonl_session_id(slug),
        _atuais_de_outras_linhas_vivas(db, slug),
    )
    lista = await asyncio.to_thread(
        conversas.listar,
        _projects_dir(request) / encoded,
        nomes=conversas.nomes_do_agente(agent),
        metas=metas,
        atual=atual,
        atuais_de_outras=atuais_de_outras,
        agora=time.time(),
    )
    visiveis, escondidas = conversas.filtrar(lista, filtro=filtro, q=q, curtas=bool(curtas))
    return ConversasResposta(
        suportado=True,
        conversas=[ConversaItem(**c) for c in visiveis],
        escondidas_curtas=escondidas,
    )
