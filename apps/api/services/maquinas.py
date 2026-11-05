"""Ponte com os painéis da tailnet; só o resumo tem cache por máquina."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass
from os import getenv
from typing import Literal, TypeVar

import httpx
from pydantic import BaseModel, ConfigDict

MAQUINAS = {
    "oficina": {
        "nome": "Oficina",
        "url_env": "MAQUINA_OFICINA_URL",
        "url_padrao": "http://100.91.105.22:8787",
        "chave_env": "MAQUINA_OFICINA_CHAVE",
    },
}
CACHE_SEGUNDOS = 30


class RespostaPainel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


class Recurso(RespostaPainel):
    usado_mb: float
    livre_mb: float
    total_mb: float
    pct: float


class Tela(RespostaPainel):
    em_uso: bool | None
    ultimo_uso_s: int | None


class ResumoPainel(RespostaPainel):
    cpu_pct: float
    ram: Recurso
    disco: Recurso
    temperatura_c: float | None
    parados_30min: int
    tela: Tela
    medido_em: int


class ItemAberto(RespostaPainel):
    id: str
    grupo: Literal["seus", "agente", "protegido"]
    rotulo: str
    dono: str | None
    memoria_mb: float
    parado_s: int | None
    abas: list[str]
    pede_confirmacao: bool
    acao_rotulo: str | None


class Abertos(RespostaPainel):
    observado_desde: int
    itens: list[ItemAberto]


class Fechado(RespostaPainel):
    liberou_mb: float


class Mensagem(RespostaPainel):
    mensagem: str


class FalhaPainel(Exception):
    def __init__(self, mensagem: str, status: int = 502):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status


@dataclass(frozen=True)
class Configuracao:
    url: str
    chave: str


@dataclass
class CacheResumo:
    configuracao: Configuracao
    expira_em: float
    corpo: dict


Modelo = TypeVar("Modelo", bound=BaseModel)


class ServicoMaquinas:
    def __init__(
        self,
        *,
        relogio: Callable[[], float] = time.monotonic,
        fabrica_cliente: Callable[..., httpx.AsyncClient] = httpx.AsyncClient,
    ):
        self._relogio = relogio
        self._fabrica_cliente = fabrica_cliente
        self._cache: dict[str, CacheResumo] = {}
        self._travas: dict[str, asyncio.Lock] = {}

    def _configuracao(self, maquina: str) -> Configuracao:
        entrada = MAQUINAS[maquina]
        return Configuracao(
            url=getenv(entrada["url_env"], entrada["url_padrao"]).rstrip("/"),
            chave=getenv(entrada["chave_env"], ""),
        )

    async def _pedir(
        self,
        config: Configuracao,
        caminho: str,
        limite_s: float,
        modelo: type[Modelo],
        *,
        corpo: dict | None = None,
    ) -> Modelo:
        if not config.chave:
            raise FalhaPainel("sem chave")
        try:
            async with self._fabrica_cliente(timeout=limite_s) as cliente:
                resposta = await cliente.request(
                    "GET" if corpo is None else "POST",
                    f"{config.url}/api/maquina/{caminho}",
                    headers={"Authorization": f"Bearer {config.chave}"},
                    json=corpo,
                )
            if resposta.status_code in (403, 404, 409):
                mensagem = Mensagem.model_validate(resposta.json())
                raise FalhaPainel(mensagem.mensagem, resposta.status_code)
            resposta.raise_for_status()
            return modelo.model_validate(resposta.json())
        except httpx.TimeoutException as erro:
            raise FalhaPainel("tempo esgotado") from erro
        except httpx.HTTPStatusError as erro:
            raise FalhaPainel(f"erro do painel (HTTP {erro.response.status_code})") from erro
        except (httpx.RequestError, httpx.InvalidURL) as erro:
            raise FalhaPainel("painel indisponível") from erro
        except ValueError as erro:
            raise FalhaPainel("resposta inválida do painel") from erro

    async def resumo(self, maquina: str) -> dict:
        trava = self._travas.setdefault(maquina, asyncio.Lock())
        async with trava:
            config = self._configuracao(maquina)
            cache = self._cache.get(maquina)
            if cache and cache.configuracao == config and self._relogio() < cache.expira_em:
                return cache.corpo
            try:
                resumo = await self._pedir(config, "resumo", 3.0, ResumoPainel)
                corpo = {**resumo.model_dump(), "online": True}
            except FalhaPainel as erro:
                corpo = {"online": False, "motivo": erro.mensagem}
            self._cache[maquina] = CacheResumo(config, self._relogio() + CACHE_SEGUNDOS, corpo)
            return corpo

    async def abertos(self, maquina: str) -> Abertos:
        return await self._pedir(self._configuracao(maquina), "abertos", 6.0, Abertos)

    async def fechar(self, maquina: str, item_id: str) -> Fechado:
        return await self._pedir(
            self._configuracao(maquina), "fechar", 12.0, Fechado, corpo={"id": item_id}
        )


servico = ServicoMaquinas()
