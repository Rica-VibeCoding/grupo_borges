"""`/api/agents/{slug}/conversas` — retomar conversa antiga do CC pelo cockpit.

Contrato em `docs/conversas/PLANO.md` ("Contrato da API"). F2: a lista; F3:
estrela e excluir.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
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
    bloqueada_por: str | None  # slug da linha que tem a conversa aberta
    pendencia: int | None


class ConversasResposta(BaseModel):
    suportado: bool
    conversas: list[ConversaItem]
    escondidas_curtas: int


_VAZIA_SUPORTADA = ConversasResposta(suportado=True, conversas=[], escondidas_curtas=0)


def _projects_dir(request: Request) -> Path:
    settings = getattr(request.app.state, "settings", None) or get_settings()
    return Path(settings.claude_projects_dir)


async def _atuais_de_outras_linhas_vivas(db: GrupoBorgesDB, slug: str) -> dict[str, str]:
    """`session_id → slug` da conversa atual de cada OUTRA linha com sessão tmux de pé.

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
    return {sid: a["slug"] for a, sid in zip(outras, atuais, strict=True) if sid}


def _pasta_do_agente(request: Request, agent: dict) -> Path | None:
    """A pasta das conversas do agente, ou `None` se ela não é só dele.

    Mesma régua do JSONL watcher: pasta dividida por dois agentes não é de
    nenhum deles — listar daria a um as conversas do outro.
    """
    config = getattr(request.app.state, "agents_config", None) or {}
    agentes = config.get("agents") or [agent]
    encoded = encoded_cwd(agent["workspace_path"])
    if _mapear_por_encoded(agentes).get(encoded) != agent["slug"]:
        return None
    return _projects_dir(request) / encoded


def _eh_cc(agent: dict) -> bool:
    return (agent.get("cli_default") or "claude_code") == "claude_code"


async def _conversa_ou_404(
    request: Request, slug: str, session_id: str
) -> tuple[dict, Path, Path, os.stat_result]:
    agent = await _get_agent_or_404(request, slug)
    pasta = _pasta_do_agente(request, agent) if _eh_cc(agent) else None
    achada = conversas.localizar(pasta, session_id) if pasta is not None else None
    if achada is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")
    return agent, pasta, *achada


@router.get("/{slug}/conversas", response_model=ConversasResposta)
async def get_conversas(
    request: Request,
    slug: str,
    filtro: Literal["todas", "estrela", "pendencia"] = "todas",
    q: str | None = Query(default=None, max_length=200),
    curtas: int = Query(default=0, ge=0, le=1),
) -> ConversasResposta:
    agent = await _get_agent_or_404(request, slug)
    if not _eh_cc(agent):
        return ConversasResposta(suportado=False, conversas=[], escondidas_curtas=0)
    pasta = _pasta_do_agente(request, agent)
    if pasta is None:
        return _VAZIA_SUPORTADA

    db: GrupoBorgesDB = request.app.state.db
    metas, atual, atuais_de_outras = await asyncio.gather(
        db.conversa_meta_do_agente(slug),
        db.latest_jsonl_session_id(slug),
        _atuais_de_outras_linhas_vivas(db, slug),
    )
    lista = await asyncio.to_thread(
        conversas.listar,
        pasta,
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


class EstrelaPedido(BaseModel):
    valor: bool


class EstrelaResposta(BaseModel):
    id: str
    estrela: bool


@router.post("/{slug}/conversas/{session_id}/estrela", response_model=EstrelaResposta)
async def post_estrela(
    request: Request, slug: str, session_id: str, pedido: EstrelaPedido
) -> EstrelaResposta:
    """Marca ou tira a ⭐. Vale também para a atual e a 🔒: guardar não mexe no arquivo."""
    await _conversa_ou_404(request, slug, session_id)
    db: GrupoBorgesDB = request.app.state.db
    await db.marcar_estrela(slug, session_id, pedido.valor)
    return EstrelaResposta(id=session_id, estrela=pedido.valor)


class ExcluirResposta(BaseModel):
    id: str
    pasta_irma: Literal["lixeira", "ausente", "ficou"]


@router.delete("/{slug}/conversas/{session_id}", response_model=ExcluirResposta)
async def delete_conversa(request: Request, slug: str, session_id: str) -> ExcluirResposta:
    """Manda a conversa para a lixeira (`gio trash`). 409 se for a atual ou estiver 🔒."""
    _, pasta, caminho, st = await _conversa_ou_404(request, slug, session_id)
    db: GrupoBorgesDB = request.app.state.db
    atual, atuais_de_outras = await asyncio.gather(
        db.latest_jsonl_session_id(slug), _atuais_de_outras_linhas_vivas(db, slug)
    )
    if session_id == atual:
        raise HTTPException(status_code=409, detail="É a conversa atual desta linha")
    bloqueada, dono = conversas.trava(
        session_id, st, atual=atual, atuais_de_outras=atuais_de_outras, agora=time.time()
    )
    if bloqueada:
        onde = f"na linha {dono}" if dono else "em outro lugar (escrita há menos de 2 min)"
        raise HTTPException(status_code=409, detail=f"Conversa aberta {onde}")
    try:
        feito = await asyncio.to_thread(conversas.mandar_para_lixeira, pasta, session_id, caminho)
    except conversas.LixeiraIndisponivel as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except conversas.LixeiraFalhou as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    await db.apagar_conversa_meta(slug, session_id)
    return ExcluirResposta(**feito)
