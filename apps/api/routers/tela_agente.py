"""Tela do Chrome: SSE só de saída; entrada sempre sob posse do harness."""

from __future__ import annotations

from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sse_starlette.sse import EventSourceResponse
from websockets.exceptions import WebSocketException

from services import tela_agente as tela

router = APIRouter()


class Modelo(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Aparelho(Modelo):
    largura: int = Field(strict=True, gt=0, le=4096)
    altura: int = Field(strict=True, gt=0, le=4096)


class Clique(Modelo):
    tipo: Literal["clique"]
    quadro: str
    x: float = Field(ge=0, lt=1)
    y: float = Field(ge=0, lt=1)


class Rolagem(Modelo):
    tipo: Literal["rolagem"]
    quadro: str
    x: float = Field(ge=0, lt=1)
    y: float = Field(ge=0, lt=1)
    delta_x: float = Field(default=0, ge=-3000, le=3000)
    delta_y: float = Field(ge=-3000, le=3000)


class Texto(Modelo):
    tipo: Literal["texto"]
    texto: str = Field(min_length=1, max_length=4096)


class Tecla(Modelo):
    tipo: Literal["tecla"]
    tecla: Literal["Enter", "Tab", "Backspace"]


class Aba(Modelo):
    tipo: Literal["aba"]
    aba: str = Field(min_length=1, max_length=128)


Entrada = Annotated[Clique | Rolagem | Texto | Tecla | Aba, Field(discriminator="tipo")]
Controle = Annotated[str | None, Header(alias="X-Tela-Controle")]


def dono(request):
    return getattr(request.state, "tailscale_user", "dev-loopback")


async def executar(coro):
    try:
        return await coro
    except (
        httpx.HTTPError,
        WebSocketException,
        TimeoutError,
        OSError,
        RuntimeError,
        KeyError,
        ValueError,
    ) as exc:
        raise HTTPException(502, "Chrome/túnel indisponível; reabra a tela") from exc


@router.get("/chromes")
async def chromes():
    return [{"id": id, "maquina": m, "rotulo": r} for id, (m, r) in tela.CATALOGO.items()]


@router.post("/chromes/{chrome}/sessoes", status_code=201)
async def abrir(chrome: str, request: Request, pedido: str | None = None):
    s = await executar(tela.servico.abrir(chrome, dono(request), pedido))
    return {
        "id": s.id,
        "chrome": s.chrome,
        "aba": s.cdp.alvo,
        "inatividade_s": tela.INATIVIDADE,
        "sem_fluxo_s": tela.SEM_FLUXO,
        "pedido": tela.pedidos.obter(s.pedido_id).corpo() if s.pedido_id else None,
    }


@router.get("/sessoes/{sid}/quadros")
async def quadros(sid: str, request: Request):
    s = tela.servico.obter(sid, dono(request))
    if s.fluxo:
        raise HTTPException(409, "fluxo já conectado")
    s.fluxo = True
    return EventSourceResponse(
        tela.servico.eventos(s),
        ping=5,
        send_timeout=10,
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/sessoes/{sid}/abas")
async def abas(sid: str, request: Request):
    s = tela.servico.obter(sid, dono(request))
    async with s.operacao:
        return await executar(s.cdp.abas())


@router.post("/sessoes/{sid}/assumir")
async def assumir(sid: str, request: Request, aparelho: Aparelho | None = None):
    s = tela.servico.obter(sid, dono(request))
    viewport = (aparelho.largura, aparelho.altura) if aparelho else None
    return {"controle": await executar(tela.servico.assumir(s, viewport))}


@router.post("/sessoes/{sid}/devolver")
async def devolver(sid: str, request: Request, x_tela_controle: Controle = None):
    s = tela.servico.obter(sid, dono(request))
    async with s.operacao:
        tela.servico.controlar(s, x_tela_controle)
        await executar(tela.servico.devolver(s))
        if s.pedido_id:
            tela.pedidos.concluir(tela.pedidos.obter(s.pedido_id), "devolvido")
    return {"devolvido": True}


@router.post("/sessoes/{sid}/entrada")
async def entrada(sid: str, request: Request, pedido: Entrada, x_tela_controle: Controle = None):
    s = tela.servico.obter(sid, dono(request))
    await executar(tela.servico.entrada(s, x_tela_controle, pedido))
    return {"entregue_cdp": True}


@router.delete("/sessoes/{sid}")
async def fechar(sid: str, request: Request):
    s = tela.servico.obter(sid, dono(request))
    await tela.servico.fechar(s)
    return {"encerrada": True}


class PedidoHumano(Modelo):
    chrome: str = Field(min_length=1, max_length=64)
    motivo: str = Field(min_length=1, max_length=1000)
    agente: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    prazo_s: int = Field(default=600, ge=2, le=1800)
    teste: bool = False


@router.post("/pedidos", status_code=201)
async def pedir_humano(pedido: PedidoHumano):
    p = await tela.pedidos.criar(
        pedido.chrome, pedido.motivo, pedido.agente, pedido.prazo_s, teste=pedido.teste
    )
    return p.corpo()


@router.get("/pedidos/{pid}")
async def pedido_humano(pid: str):
    return tela.pedidos.obter(pid).corpo()


@router.get("/pedidos/{pid}/esperar")
async def esperar_humano(pid: str):
    return EventSourceResponse(
        tela.pedidos.esperar(tela.pedidos.obter(pid)),
        ping=5,
        send_timeout=10,
        headers={"Cache-Control": "no-store"},
    )
