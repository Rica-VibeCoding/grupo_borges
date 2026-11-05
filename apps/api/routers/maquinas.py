"""Máquinas conhecidas e repasse autenticado para seus painéis."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from services import maquinas

router = APIRouter()


class Maquina(BaseModel):
    id: str
    nome: str


class ResumoOnline(maquinas.ResumoPainel):
    online: Literal[True]


class ResumoOffline(BaseModel):
    online: Literal[False]
    motivo: str


class PedidoFechar(BaseModel):
    id: str = Field(strict=True, min_length=1, max_length=128, pattern=r"\A[A-Za-z0-9_-]+\z")


async def maquina_conhecida(maquina: str) -> str:
    if maquina not in maquinas.MAQUINAS:
        raise HTTPException(status_code=404, detail="máquina desconhecida")
    return maquina


MaquinaConhecida = Annotated[str, Depends(maquina_conhecida)]
ERROS_PAINEL = {status: {"model": maquinas.Mensagem} for status in (403, 404, 409, 502)}


@router.get("", response_model=list[Maquina])
async def get_maquinas() -> list[dict]:
    return [{"id": id, "nome": entrada["nome"]} for id, entrada in maquinas.MAQUINAS.items()]


@router.get("/{maquina}/resumo", response_model=ResumoOnline | ResumoOffline)
async def get_resumo(maquina: MaquinaConhecida) -> dict:
    return await maquinas.servico.resumo(maquina)


@router.get("/{maquina}/abertos", response_model=maquinas.Abertos, responses=ERROS_PAINEL)
async def get_abertos(maquina: MaquinaConhecida) -> maquinas.Abertos | JSONResponse:
    try:
        return await maquinas.servico.abertos(maquina)
    except maquinas.FalhaPainel as erro:
        return JSONResponse(status_code=erro.status, content={"mensagem": erro.mensagem})


@router.post("/{maquina}/fechar", response_model=maquinas.Fechado, responses=ERROS_PAINEL)
async def post_fechar(
    maquina: MaquinaConhecida, pedido: PedidoFechar
) -> maquinas.Fechado | JSONResponse:
    try:
        return await maquinas.servico.fechar(maquina, pedido.id)
    except maquinas.FalhaPainel as erro:
        return JSONResponse(status_code=erro.status, content={"mensagem": erro.mensagem})
