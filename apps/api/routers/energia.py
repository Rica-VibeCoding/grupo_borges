"""Controle de energia das máquinas permitidas, atrás da identidade Tailscale."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, field_validator

from services import energia

router = APIRouter()


class PedidoDesligar(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmo: Literal[True]

    @field_validator("confirmo", mode="before")
    @classmethod
    def confirmar(cls, valor):
        if valor is not True:
            raise ValueError("confirme o desligamento com confirmo: true")
        return valor


async def maquina_conhecida(maquina: str) -> str:
    if maquina not in energia.MAQUINAS:
        raise HTTPException(status_code=404, detail="máquina desconhecida")
    return maquina


MaquinaConhecida = Annotated[str, Depends(maquina_conhecida)]
ERROS = {status: {"model": energia.Mensagem} for status in (409, 502)}


@router.get("", response_model=list[energia.EstadoEnergia])
async def get_energia() -> list[energia.EstadoEnergia]:
    return await energia.servico.listar()


@router.get("/{maquina}/impacto", response_model=energia.Impacto, responses=ERROS)
async def get_impacto(maquina: MaquinaConhecida) -> energia.Impacto | JSONResponse:
    try:
        return await energia.servico.impacto(maquina)
    except energia.FalhaEnergia as erro:
        return JSONResponse(status_code=erro.status, content={"mensagem": erro.mensagem})


async def acionar(maquina: str, acao: Literal["ligar", "desligar"]) -> JSONResponse:
    try:
        status, corpo = await energia.servico.acionar(maquina, acao)
        return JSONResponse(status_code=status, content=corpo.model_dump())
    except energia.FalhaEnergia as erro:
        return JSONResponse(status_code=erro.status, content={"mensagem": erro.mensagem})


@router.post(
    "/{maquina}/desligar", status_code=202, response_model=energia.AcaoEnergia, responses=ERROS,
)
async def post_desligar(maquina: MaquinaConhecida, pedido: PedidoDesligar) -> JSONResponse:
    return await acionar(maquina, "desligar")


@router.post(
    "/{maquina}/ligar", status_code=202, response_model=energia.AcaoEnergia,
    responses={**ERROS, 200: {"model": energia.AcaoEnergia}},
)
async def post_ligar(maquina: MaquinaConhecida) -> JSONResponse:
    return await acionar(maquina, "ligar")
