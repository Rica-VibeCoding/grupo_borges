"""`/api/agents/{slug}/conversas` — retomar conversa antiga do CC pelo cockpit.

Contrato em `docs/conversas/PLANO.md` ("Contrato da API"). F2: a lista; F3:
estrela e excluir; F5: estacionar, Nova conversa, `/operacao` e o aquecimento
do cache da lista na subida da API.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import get_settings
from db.store import GrupoBorgesDB
from orchestrator.jsonl_watcher import _mapear_por_encoded, encoded_cwd
from routers.agents import _esta_ocupado, _get_agent_or_404
from services import conversas, tmux_driver
from services import operacao_conversa as operacao

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


def _pasta_no_app(app, agent: dict) -> Path | None:
    """A pasta das conversas do agente, ou `None` se ela não é só dele.

    Mesma régua do JSONL watcher: pasta dividida por dois agentes não é de
    nenhum deles — listar daria a um as conversas do outro.
    """
    config = getattr(app.state, "agents_config", None) or {}
    agentes = config.get("agents") or [agent]
    encoded = encoded_cwd(agent["workspace_path"])
    if _mapear_por_encoded(agentes).get(encoded) != agent["slug"]:
        return None
    settings = getattr(app.state, "settings", None) or get_settings()
    return Path(settings.claude_projects_dir) / encoded


def _pasta_do_agente(request: Request, agent: dict) -> Path | None:
    return _pasta_no_app(request.app, agent)


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


# ---------- F5: estacionar, Nova conversa e /operacao ----------


class EstacionarPedido(BaseModel):
    titulo: str = Field(min_length=1, max_length=200)
    nota: str | None = Field(default=None, max_length=1000)


class EstacionarResposta(BaseModel):
    id: str
    titulo: str
    nota: str | None


_NOTA_MAX = 300


@router.post("/{slug}/conversas/estacionar", response_model=EstacionarResposta)
async def post_estacionar(
    request: Request, slug: str, pedido: EstacionarPedido
) -> EstacionarResposta:
    """Chamado **pelo agente**: título e nota da conversa atual dele.

    Vale com ou sem Nova conversa em curso; se houver uma esperando, ela segue.
    Título e nota viram uma linha só — o título vai para o `/clear`, e a nota
    para a lista, onde quebra de linha não tem onde morar.
    """
    agent = await _get_agent_or_404(request, slug)
    if not _eh_cc(agent):
        raise HTTPException(status_code=409, detail="motor_sem_conversas")
    titulo = operacao.linha_unica(pedido.titulo)
    if not titulo:
        raise HTTPException(status_code=422, detail="titulo_vazio")
    nota = operacao.linha_unica(pedido.nota, _NOTA_MAX) if pedido.nota else ""
    db: GrupoBorgesDB = request.app.state.db
    session_id = await db.latest_jsonl_session_id(slug)
    if session_id is None:
        raise HTTPException(status_code=409, detail="sem_conversa_atual")
    await db.estacionar_conversa(slug, session_id, titulo, nota or None, int(time.time() * 1000))
    operacao.avisar_estacionou(slug, session_id, titulo)
    return EstacionarResposta(id=session_id, titulo=titulo, nota=nota or None)


class OperacaoResposta(BaseModel):
    fase: Literal["estacionando", "religando", "pronta", "erro"] | None
    desde: int | None  # epoch ms da entrada na fase
    detalhe: str | None = None


def _operacao_resposta(slug: str) -> OperacaoResposta:
    op = operacao.estado(slug)
    if op is None:
        return OperacaoResposta(fase=None, desde=None)
    return OperacaoResposta(fase=op.fase, desde=op.desde, detalhe=op.detalhe)


@router.get("/{slug}/conversas/operacao", response_model=OperacaoResposta)
async def get_operacao(request: Request, slug: str) -> OperacaoResposta:
    """A fase da operação deste agente, para a tela mostrar os passos da espera."""
    await _get_agent_or_404(request, slug)
    return _operacao_resposta(slug)


class NovaPedido(BaseModel):
    forcar: bool = False


class NovaResposta(OperacaoResposta):
    titulo: str | None = None
    nota: bool = False  # o agente estacionou a tempo


class _Falha(RuntimeError):
    """Passo da operação que não se cumpriu; o texto vai para a tela."""


#: As tarefas das operações vivem aqui: `create_task` sem referência pode ser
#: recolhido pelo coletor no meio do caminho.
_tarefas: set[asyncio.Task] = set()


def _url_da_api(request: Request) -> str:
    """Endereço da API por dentro da VPS, para o `curl` do agente.

    A porta é a que o uvicorn ocupa (`scope["server"]`), não a do cabeçalho:
    pelo `tailscale serve` o cabeçalho traz a `:3445`, que o agente não alcança
    sem identidade da tailnet.
    """
    settings = getattr(request.app.state, "settings", None)
    fixa = getattr(settings, "api_url_agentes", "") if settings is not None else ""
    if fixa:
        return fixa
    servidor = request.scope.get("server")
    porta = servidor[1] if servidor and servidor[1] else 8000
    return f"http://127.0.0.1:{porta}"


async def _ocioso(db: GrupoBorgesDB, slug: str) -> bool:
    agent = await db.get_agent(slug)
    return agent is None or not _esta_ocupado(agent)


async def _interromper(db: GrupoBorgesDB, slug: str, tmux_session: str) -> None:
    """Escape no pane. O turno interrompido não grava fim de turno no JSONL, então
    o `lifecycle_status` ficaria em `trabalhando` por até 5 min — e o `/clear`
    seguinte não depende dele. Limpa aqui, como o `/interromper` faz no caso
    do pedido devolvido à caixa."""
    resultado = await tmux_driver.interrupt(tmux_session)
    if not resultado.get("parado"):
        raise _Falha("não consegui interromper o agente")
    await db.clear_agent_lifecycle(slug)


async def _conduzir_nova(
    app, agent: dict, op: operacao.Operacao, *, ocupado: bool, url_base: str
) -> None:
    """Fluxo da F5: estacionar → ocioso → `/clear <título>` → `/rename <agente>`."""
    db: GrupoBorgesDB = app.state.db
    slug, tmux_session = agent["slug"], agent["tmux_session"]
    try:
        sessao_antes = await db.latest_jsonl_session_id(slug)
        if ocupado:
            # `forcar`: interrompe e segue sem a nota.
            await _interromper(db, slug, tmux_session)
        elif sessao_antes is not None:
            op.aguardando = sessao_antes
            entrega = await tmux_driver.send_message(
                tmux_session, operacao.mensagem_de_estacionar(url_base, slug)
            )
            if not entrega.delivered:
                motivo = entrega.message or entrega.outcome
                raise _Falha(f"o pedido de estacionar não chegou ao agente ({motivo})")

            async def estacionou() -> bool:
                return op.estacionou

            await operacao.esperar(estacionou, operacao.PRAZO_ESTACIONAR_S)
            op.aguardando = None
            # Mandado no meio do turno, o `/clear` chega mas não vira comando.
            if not await operacao.esperar(
                lambda: _ocioso(db, slug), operacao.PRAZO_OCIOSO_S
            ):
                await _interromper(db, slug, tmux_session)

        if not op.estacionou and sessao_antes is not None:
            metas = await db.conversa_meta_do_agente(slug)
            op.titulo = await asyncio.to_thread(
                conversas.titulo_de,
                _pasta_no_app(app, agent),
                sessao_antes,
                nomes=conversas.nomes_do_agente(agent),
                meta=metas.get(sessao_antes),
            )
        titulo = operacao.linha_unica(op.titulo) if op.titulo else ""

        operacao.avancar(op, "religando")
        pasta = _pasta_no_app(app, agent)
        if pasta is None:
            raise _Falha("a pasta de conversas deste agente não é só dele")
        ja_havia = await asyncio.to_thread(conversas.ids_na_pasta, pasta)
        entrega = await tmux_driver.send_message(
            tmux_session, f"/clear {titulo}" if titulo else "/clear"
        )
        if not entrega.delivered:
            motivo = entrega.message or entrega.outcome
            raise _Falha(f"o /clear não chegou ao agente ({motivo})")

        # A conversa nova se prova pelo ARQUIVO, não pelo `latest_jsonl_session_id`
        # que o `/input` usa: o watcher só ingere JSONL modificado, e o recém-criado
        # pelo `/clear` pode só entrar no banco com a primeira mensagem (F2).
        async def nasceu() -> bool:
            return bool(await asyncio.to_thread(conversas.ids_na_pasta, pasta) - ja_havia)

        if not await operacao.esperar(nasceu, operacao.PRAZO_CONVERSA_NOVA_S):
            raise _Falha("o /clear foi enviado, mas a conversa nova não apareceu")
        # O `<título>` do `/clear` fica na conversa que sai; a nova nasce sem
        # nome e sem `agent-name` (F1/M2). Ela recebe o do agente, que é o que
        # o rodapé do card (`session_name`) mostra.
        entrega = await tmux_driver.send_message(tmux_session, f"/rename {agent['name']}")
        if not entrega.delivered:
            motivo = entrega.message or entrega.outcome
            raise _Falha(f"a conversa nova abriu, mas o /rename não chegou ({motivo})")
        operacao.avancar(op, "pronta")
    except _Falha as exc:
        operacao.avancar(op, "erro", str(exc))
    except Exception as exc:  # noqa: BLE001 — a fase nunca pode ficar presa em curso
        logger.exception("conversas: Nova conversa de %s falhou", slug)
        operacao.avancar(op, "erro", f"falha inesperada ({exc.__class__.__name__})")
    finally:
        op.aguardando = None


@router.post("/{slug}/conversas/nova", response_model=NovaResposta)
async def post_nova(request: Request, slug: str, pedido: NovaPedido | None = None):
    """Estaciona a conversa atual e abre uma nova na mesma linha.

    - 409 `ocupado`: agente no meio de um turno (com `forcar`, interrompe e
      segue sem a nota); `operacao_em_curso`; `desligado`; `motor_sem_conversas`.
    - Resposta síncrona com teto de 90 s. Passou disso, 202 com a fase em que
      está — a operação segue no servidor e a tela acompanha pelo `/operacao`.
    - 502 com `{fase: erro, detalhe}` quando um passo não se cumpre.
    """
    forcar = bool(pedido and pedido.forcar)
    agent = await _get_agent_or_404(request, slug)
    if not _eh_cc(agent):
        raise HTTPException(status_code=409, detail="motor_sem_conversas")
    try:
        vivas = await tmux_driver.list_session_names()
    except Exception as exc:  # noqa: BLE001 — sem inventário, o envio dirá
        logger.warning("conversas: inventário do tmux falhou na Nova conversa (%s)", exc)
    else:
        if agent["tmux_session"] not in vivas:
            raise HTTPException(status_code=409, detail="desligado")
    atual = operacao.estado(slug)
    if atual is not None and atual.fase in operacao.EM_CURSO:
        raise HTTPException(status_code=409, detail="operacao_em_curso")
    ocupado = _esta_ocupado(agent)
    if ocupado and not forcar:
        raise HTTPException(status_code=409, detail="ocupado")
    try:
        op = operacao.comecar(slug)
    except operacao.OperacaoEmCurso as exc:
        raise HTTPException(status_code=409, detail="operacao_em_curso") from exc

    tarefa = asyncio.create_task(
        _conduzir_nova(request.app, agent, op, ocupado=ocupado, url_base=_url_da_api(request))
    )
    _tarefas.add(tarefa)
    tarefa.add_done_callback(_tarefas.discard)
    try:
        await asyncio.wait_for(asyncio.shield(tarefa), timeout=operacao.TETO_RESPOSTA_S)
    except TimeoutError:
        pass

    corpo = NovaResposta(
        **_operacao_resposta(slug).model_dump(), titulo=op.titulo, nota=op.estacionou
    )
    if op.fase == "erro":
        return JSONResponse(status_code=502, content=corpo.model_dump())
    if op.fase in operacao.EM_CURSO:
        return JSONResponse(status_code=202, content=corpo.model_dump())
    return corpo


# ---------- aquecimento do cache da lista ----------


async def aquecer_cache(app) -> None:
    """Lê as conversas de todos os agentes uma vez, logo depois da subida da API.

    Medido na VPS (F3): a primeira lista do Pavan depois de um restart levou
    9,7 s com 171 arquivos; com o cache, 0,36 s. Roda em segundo plano, um
    agente por vez, sem segurar o startup — quem abrir a lista no meio espera
    a trava do parser, não paga a leitura duas vezes.
    """
    db: GrupoBorgesDB = app.state.db
    inicio = time.monotonic()
    total = 0
    for agent in await db.list_agents():
        if not _eh_cc(agent) or not agent.get("workspace_path"):
            continue
        pasta = _pasta_no_app(app, agent)
        if pasta is None:
            continue
        try:
            metas = await db.conversa_meta_do_agente(agent["slug"])
            lista = await asyncio.to_thread(
                conversas.listar,
                pasta,
                nomes=conversas.nomes_do_agente(agent),
                metas=metas,
                atual=None,
                atuais_de_outras={},
                agora=time.time(),
            )
            total += len(lista)
        except Exception as exc:  # noqa: BLE001 — aquecer é bônus, nunca derruba
            logger.warning("conversas: aquecimento de %s falhou (%s)", agent["slug"], exc)
    logger.info(
        "conversas: cache aquecido, %d conversas em %.1fs", total, time.monotonic() - inicio
    )
