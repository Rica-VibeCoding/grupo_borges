"""`/api/agents/{slug}/conversas` — retomar conversa antiga do CC pelo cockpit.

Contrato em `docs/conversas/PLANO.md` ("Contrato da API"). F2: a lista; F3:
estrela e excluir; F5: estacionar, Nova conversa, `/operacao` e o aquecimento
do cache da lista na subida da API; F6: Retomar; F7: `pendencia` e briefing
de retorno.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Literal

import libtmux.exc as libtmux_exc
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import get_settings
from db.store import GrupoBorgesDB
from orchestrator.jsonl_watcher import _mapear_por_encoded, encoded_cwd
from routers.agents import _esta_ocupado, _get_agent_or_404
from services import briefing_retorno, conversas, desligamento_deliberado, tmux_driver
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


async def _atuais_de_outras_linhas_vivas(app, slug: str) -> dict[str, str]:
    """`session_id → slug` da conversa atual de cada OUTRA linha com sessão tmux de pé.

    Inventário do tmux que falha não pode virar "ninguém vivo": aí todas as
    outras linhas contam como vivas — trava a mais, nunca a menos.
    """
    db: GrupoBorgesDB = app.state.db
    outras = [a for a in await db.list_agents() if a["slug"] != slug]
    try:
        vivas = await tmux_driver.list_session_names()
        outras = [a for a in outras if a.get("tmux_session") in vivas]
    except Exception as exc:  # noqa: BLE001 — qualquer falha de observação
        logger.warning("conversas: inventário do tmux falhou (%s); todas contam como vivas", exc)
    processos = await tmux_driver.conversas_dos_processos()
    atuais = await asyncio.gather(*(_atual_da_linha(app, a, processos) for a in outras))
    return {sid: a["slug"] for a, sid in zip(outras, atuais, strict=True) if sid}


async def _atual_e_deixada(
    app, agent: dict, processos: dict[str, tuple[str, float]] | None = None
) -> tuple[str | None, str | None]:
    """A conversa atual da linha e a que ela acabou de deixar.

    Atual: o banco, corrigido pelo `--resume` do Claude vivo e pela troca em
    memória do cockpit. O `--resume` cobre o restart da API, que apaga a troca
    antes de o banco alcançar a conversa retomada; aí a que o banco aponta é a
    deixada — escrita recente dela foi desta linha, não vira 🔒.
    """
    slug = agent["slug"]
    do_banco = await app.state.db.latest_jsonl_session_id(slug)
    atual = do_banco
    if _eh_cc(agent):
        if processos is None:
            processos = await tmux_driver.conversas_dos_processos()
        resume = processos.get(agent.get("tmux_session"))
        if resume is not None:
            atual = await asyncio.to_thread(
                conversas.atual_pelo_processo, _pasta_no_app(app, agent), do_banco, resume
            )
    deixada = operacao.deixada(slug)
    if deixada is None and atual != do_banco:
        deixada = do_banco
    return operacao.corrigir_atual(slug, atual), deixada


async def _atual_da_linha(
    app, agent: dict, processos: dict[str, tuple[str, float]] | None = None
) -> str | None:
    return (await _atual_e_deixada(app, agent, processos))[0]


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
    metas, (atual, deixada), atuais_de_outras = await asyncio.gather(
        db.conversa_meta_do_agente(slug),
        _atual_e_deixada(request.app, agent),
        _atuais_de_outras_linhas_vivas(request.app, slug),
    )
    lista = await asyncio.to_thread(
        conversas.listar,
        pasta,
        nomes=conversas.nomes_do_agente(agent),
        metas=metas,
        atual=atual,
        atuais_de_outras=atuais_de_outras,
        agora=time.time(),
        deixada=deixada,
        cwd_padrao=agent.get("workspace_path"),
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


async def _livre_ou_409(app, agent: dict, session_id: str, st: os.stat_result) -> None:
    """409 se a conversa é a atual desta linha ou está 🔒 (régua do excluir e do retomar)."""
    (atual, deixada), atuais_de_outras = await asyncio.gather(
        _atual_e_deixada(app, agent), _atuais_de_outras_linhas_vivas(app, agent["slug"])
    )
    if session_id == atual:
        raise HTTPException(status_code=409, detail="É a conversa atual desta linha")
    bloqueada, dono = conversas.trava(
        session_id,
        st,
        atual=atual,
        atuais_de_outras=atuais_de_outras,
        agora=time.time(),
        deixada=deixada,
    )
    if bloqueada:
        onde = f"na linha {dono}" if dono else "em outro lugar (escrita há menos de 2 min)"
        raise HTTPException(status_code=409, detail=f"Conversa aberta {onde}")


@router.delete("/{slug}/conversas/{session_id}", response_model=ExcluirResposta)
async def delete_conversa(request: Request, slug: str, session_id: str) -> ExcluirResposta:
    """Manda a conversa para a lixeira (`gio trash`). 409 se for a atual ou estiver 🔒."""
    agent, pasta, caminho, st = await _conversa_ou_404(request, slug, session_id)
    await _livre_ou_409(request.app, agent, session_id, st)
    try:
        feito = await asyncio.to_thread(conversas.mandar_para_lixeira, pasta, session_id, caminho)
    except conversas.LixeiraIndisponivel as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except conversas.LixeiraFalhou as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    await request.app.state.db.apagar_conversa_meta(slug, session_id)
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
    session_id = await _atual_da_linha(request.app, agent)
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


async def _estacionar_atual(
    db: GrupoBorgesDB,
    agent: dict,
    op: operacao.Operacao,
    *,
    sessao_antes: str | None,
    ocupado: bool,
    url_base: str,
    para: str,
) -> None:
    """Passo comum da Nova e do Retomar: pede a nota e deixa o agente ocioso.

    Ocupado (só chega aqui com `forcar`): interrompe e segue sem a nota.
    """
    slug, tmux_session = agent["slug"], agent["tmux_session"]
    if ocupado:
        await _interromper(db, slug, tmux_session)
        return
    if sessao_antes is None:
        return
    op.aguardando = sessao_antes
    entrega = await tmux_driver.send_message(
        tmux_session, operacao.mensagem_de_estacionar(url_base, slug, para)
    )
    if not entrega.delivered:
        motivo = entrega.message or entrega.outcome
        raise _Falha(f"o pedido de estacionar não chegou ao agente ({motivo})")

    async def estacionou() -> bool:
        return op.estacionou

    await operacao.esperar(estacionou, operacao.PRAZO_ESTACIONAR_S)
    op.aguardando = None
    # Mandado no meio do turno, o `/clear` chega mas não vira comando.
    if not await operacao.esperar(lambda: _ocioso(db, slug), operacao.PRAZO_OCIOSO_S):
        await _interromper(db, slug, tmux_session)


async def _conduzir_nova(
    app, agent: dict, op: operacao.Operacao, *, ocupado: bool, url_base: str
) -> None:
    """Fluxo da F5: estacionar → ocioso → `/clear <título>` → `/rename <agente>`."""
    db: GrupoBorgesDB = app.state.db
    slug, tmux_session = agent["slug"], agent["tmux_session"]
    try:
        sessao_antes = await _atual_da_linha(app, agent)
        await _estacionar_atual(
            db, agent, op, sessao_antes=sessao_antes, ocupado=ocupado,
            url_base=url_base, para="nova",
        )

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
        novas: set[str] = set()

        async def nasceu() -> bool:
            novas.update(await asyncio.to_thread(conversas.ids_na_pasta, pasta) - ja_havia)
            return bool(novas)

        if not await operacao.esperar(nasceu, operacao.PRAZO_CONVERSA_NOVA_S):
            raise _Falha("o /clear foi enviado, mas a conversa nova não apareceu")
        if len(novas) == 1:
            operacao.registrar_troca(slug, sessao_antes, next(iter(novas)))
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
    return await _responder(slug, op, tarefa)


# ---------- F6: Retomar ----------


async def _subir_e_esperar(
    tmux_session: str, pasta: Path, resume_session_id: str | None
) -> str | None:
    """Sobe a linha e espera ela ficar pronta. `None` = pronta; senão, o motivo.

    Pronta = caixa de input vazia e, no `--resume`, o JSONL pedido como o mais
    recente da pasta (o `--resume` mexe no mtime dele na subida). Diálogo de
    retomada na tela leva Escape — o único atalho seguro nos dois diálogos, ver
    `tmux_driver._MARCAS_DE_DIALOGO_DE_RETOMADA`. Os Escapes ficam espaçados:
    dois seguidos numa caixa vazia abrem o menu de voltar no histórico do CC.
    """
    try:
        await tmux_driver.boot_agent(tmux_session, resume_session_id)
    except tmux_driver.TmuxSessionBusyError:
        return "já havia um boot deste agente em curso"
    except (ValueError, libtmux_exc.LibTmuxException) as exc:
        return f"o boot falhou ({exc})"

    visto: dict[str, object] = {"estado": "ausente", "escapes": 0, "desde_escape": 99}

    async def pronta() -> bool:
        estado = await tmux_driver.estado_da_largada(tmux_session)
        visto["estado"] = estado
        visto["desde_escape"] = int(visto["desde_escape"]) + 1
        if estado == "dialogo":
            if (
                int(visto["escapes"]) < operacao.ESCAPES_NO_DIALOGO
                and int(visto["desde_escape"]) >= 4
            ):
                await tmux_driver.send_named_key(tmux_session, "Escape")
                visto["escapes"] = int(visto["escapes"]) + 1
                visto["desde_escape"] = 0
            return False
        if estado != "pronta":
            return False
        if resume_session_id is None:
            return True
        return await asyncio.to_thread(conversas.mais_recente, pasta) == resume_session_id

    if await operacao.esperar(pronta, operacao.PRAZO_LARGADA_S):
        return None
    if visto["estado"] == "dialogo":
        return "a linha ficou parada num diálogo de retomada do Claude Code"
    if visto["estado"] == "pronta":
        return "a linha subiu, mas não na conversa pedida"
    return f"a linha não ficou pronta em {int(operacao.PRAZO_LARGADA_S)} s"


async def _conduzir_retomar(
    app,
    agent: dict,
    op: operacao.Operacao,
    *,
    alvo: str,
    viva: bool,
    ocupado: bool,
    url_base: str,
) -> None:
    """Fluxo da F6: estacionar → desligar → `--resume <alvo>` → linha pronta.

    Falhou a subida, a linha volta na conversa de antes (`--continue`, com o
    JSONL dela tocado para ser o mais recente) e a resposta é erro legível —
    nunca linha morta calada.
    """
    db: GrupoBorgesDB = app.state.db
    slug, tmux_session = agent["slug"], agent["tmux_session"]
    try:
        pasta = _pasta_no_app(app, agent)
        if pasta is None:
            raise _Falha("a pasta de conversas deste agente não é só dele")
        sessao_antes = await _atual_da_linha(app, agent)
        if viva:
            await _estacionar_atual(
                db, agent, op, sessao_antes=sessao_antes, ocupado=ocupado,
                url_base=url_base, para="retomar",
            )

        operacao.avancar(op, "religando")
        # Desligar de propósito: o vigia não conta como morte no meio da troca.
        await asyncio.to_thread(desligamento_deliberado.marcar, tmux_session)
        try:
            desligado = await tmux_driver.shutdown_agent(tmux_session)
            if desligado.get("scopes_resistiram"):
                logger.warning(
                    "conversas: retomar em %s com scopes que resistiram: %s",
                    slug, desligado["scopes_resistiram"],
                )
            # Antes do boot: o gancho do briefing (F7) roda na largada e lê esta
            # marca. A última atividade sai do mtime de agora: o `--resume` mexe nele.
            achada = conversas.localizar(pasta, alvo)
            atividade_ms = achada[1].st_mtime_ns // 1_000_000 if achada else None
            await db.marcar_retomada(slug, alvo, int(time.time() * 1000), atividade_ms)
            motivo = await _subir_e_esperar(tmux_session, pasta, alvo)
            if motivo is None:
                operacao.registrar_troca(slug, sessao_antes, alvo)
                operacao.avancar(op, "pronta")
                return
            logger.warning("conversas: retomar %s em %s falhou: %s", alvo, slug, motivo)
            raise _Falha(f"não consegui retomar a conversa: {motivo}; "
                         + await _voltar_para_a_anterior(tmux_session, pasta, sessao_antes))
        finally:
            await asyncio.to_thread(desligamento_deliberado.desmarcar, tmux_session)
    except _Falha as exc:
        operacao.avancar(op, "erro", str(exc))
    except Exception as exc:  # noqa: BLE001 — a fase nunca pode ficar presa em curso
        logger.exception("conversas: Retomar em %s falhou", slug)
        operacao.avancar(op, "erro", f"falha inesperada ({exc.__class__.__name__})")
    finally:
        op.aguardando = None


async def _voltar_para_a_anterior(
    tmux_session: str, pasta: Path, sessao_antes: str | None
) -> str:
    """Religa com `--continue` e diz em uma frase como a linha ficou.

    O `--resume` que falhou pode ter deixado o JSONL pedido como o mais recente
    da pasta, e é o mais recente que o `--continue` pega. Tocar o da conversa
    de antes devolve a linha a ela.
    """
    achada = conversas.localizar(pasta, sessao_antes) if sessao_antes else None
    if achada is not None:
        try:
            await asyncio.to_thread(os.utime, achada[0])
        except OSError as exc:
            logger.warning("conversas: não toquei o JSONL de %s (%s)", sessao_antes, exc)
    motivo = await _subir_e_esperar(tmux_session, pasta, None)
    if motivo is None:
        return "a linha voltou na conversa anterior"
    logger.error("conversas: a volta com --continue em %s também falhou: %s", tmux_session, motivo)
    return f"e a linha também não voltou ({motivo}) — ligue o agente pelo botão Ligar"


@router.post("/{slug}/conversas/{session_id}/retomar", response_model=NovaResposta)
async def post_retomar(
    request: Request, slug: str, session_id: str, pedido: NovaPedido | None = None
):
    """Troca a conversa da linha por `session_id`: estaciona, derruba e sobe com `--resume`.

    - 404: a conversa não é deste agente.
    - 409 `É a conversa atual…` / `Conversa aberta…` (🔒); `ocupado` (com
      `forcar`, interrompe e segue sem a nota); `operacao_em_curso`;
      `motor_sem_conversas`.
    - Agente desligado: não há o que estacionar, sobe direto na conversa pedida.
    - Mesmas respostas da Nova: 200 `pronta`, 502 `{fase: erro, detalhe}`, 202
      depois de 90 s com a operação seguindo no servidor.
    """
    forcar = bool(pedido and pedido.forcar)
    agent = await _get_agent_or_404(request, slug)
    if not _eh_cc(agent):
        raise HTTPException(status_code=409, detail="motor_sem_conversas")
    _, _, _, st = await _conversa_ou_404(request, slug, session_id)
    await _livre_ou_409(request.app, agent, session_id, st)
    try:
        viva = agent["tmux_session"] in await tmux_driver.list_session_names()
    except Exception as exc:  # noqa: BLE001 — sem inventário, trata como viva
        logger.warning("conversas: inventário do tmux falhou no Retomar (%s)", exc)
        viva = True
    atual = operacao.estado(slug)
    if atual is not None and atual.fase in operacao.EM_CURSO:
        raise HTTPException(status_code=409, detail="operacao_em_curso")
    ocupado = viva and _esta_ocupado(agent)
    if ocupado and not forcar:
        raise HTTPException(status_code=409, detail="ocupado")
    try:
        op = operacao.comecar(slug)
    except operacao.OperacaoEmCurso as exc:
        raise HTTPException(status_code=409, detail="operacao_em_curso") from exc

    tarefa = asyncio.create_task(
        _conduzir_retomar(
            request.app, agent, op, alvo=session_id, viva=viva, ocupado=ocupado,
            url_base=_url_da_api(request),
        )
    )
    return await _responder(slug, op, tarefa)


async def _responder(slug: str, op: operacao.Operacao, tarefa: asyncio.Task):
    """Segura a resposta até o teto de 90 s; a operação segue no servidor depois."""
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


# ---------- F7: briefing de retorno ----------

#: Por quanto tempo depois do Retomar a largada ainda recebe o briefing.
VALIDADE_BRIEFING_MS = 10 * 60 * 1000


class BriefingResposta(BaseModel):
    briefing: str  # vazio = nada a dizer (não foi retomada agora, ou nada mudou)


async def _agente_da_linha(request: Request, slug: str) -> dict:
    """O agente pelo slug ou pela sessão tmux — o gancho só sabe a sessão (`#S`).

    São diferentes no Canário: slug `canarinho`, sessão `canario`.
    """
    db: GrupoBorgesDB = request.app.state.db
    agent = await db.get_agent(slug)
    if agent is None:
        agent = next((a for a in await db.list_agents() if a.get("tmux_session") == slug), None)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return agent


@router.get("/{slug}/conversas/{session_id}/briefing", response_model=BriefingResposta)
async def get_briefing(request: Request, slug: str, session_id: str) -> BriefingResposta:
    """Chamado pelo gancho `SessionStart` (`scripts/briefing-retorno.sh`).

    Só fala com a conversa que o cockpit acabou de retomar: a `retomada_em`
    vale 10 min e é gasta na primeira chamada, saia texto ou não. `--continue`
    do Ligar comum chega igual ao gancho (`source: resume`, F1) e cai aqui sem
    marca: vazio.
    """
    agent = await _agente_da_linha(request, slug)
    pasta = _pasta_do_agente(request, agent) if _eh_cc(agent) else None
    achada = conversas.localizar(pasta, session_id) if pasta is not None else None
    if achada is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")
    db: GrupoBorgesDB = request.app.state.db
    agora = time.time()
    marca = await db.consumir_retomada(
        agent["slug"], session_id, int(agora * 1000), VALIDADE_BRIEFING_MS
    )
    if marca is None:
        return BriefingResposta(briefing="")
    desde_ms = marca.get("atividade_em") or marca["retomada_em"]
    arquivos = await asyncio.to_thread(
        conversas.arquivos_de, *achada, cwd_padrao=agent.get("workspace_path")
    )
    texto = await asyncio.to_thread(
        briefing_retorno.montar, arquivos, desde=desde_ms / 1000, agora=agora
    )
    return BriefingResposta(briefing=texto)


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
                cwd_padrao=agent.get("workspace_path"),
                com_pendencia=False,
            )
            total += len(lista)
        except Exception as exc:  # noqa: BLE001 — aquecer é bônus, nunca derruba
            logger.warning("conversas: aquecimento de %s falhou (%s)", agent["slug"], exc)
    logger.info(
        "conversas: cache aquecido, %d conversas em %.1fs", total, time.monotonic() - inicio
    )
