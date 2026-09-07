"""Consumo da VPS pro rodapé da tropa: CPU, RAM, swap e disco.

Lido direto do `/proc` e do `statvfs`, sem `psutil`: ele não está no venv e
seria dependência nova pra quatro números que o kernel já entrega em texto.

Cada função de parse recebe o TEXTO e devolve os números — é o que deixa os
testes usarem amostras reais da Oracle em vez de mockar arquivo. Só `ler()`
toca no sistema.

A CPU é a única que precisa de DUAS leituras: o `/proc/stat` acumula ticks
desde o boot, e a porcentagem é a diferença entre dois instantes. A última
amostra fica no módulo — o cockpit pergunta a cada poucos segundos, e a janela
entre duas perguntas é a medida. Sem amostra anterior (primeiro pedido depois
do boot da API, ou amostra velha demais), tira duas com um respiro curto.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass

CAMINHO_STAT = "/proc/stat"
CAMINHO_MEMINFO = "/proc/meminfo"
CAMINHO_LOADAVG = "/proc/loadavg"
CAMINHO_UPTIME = "/proc/uptime"
RAIZ_DO_DISCO = "/"

#: Amostra de CPU mais velha que isto não serve de base: a porcentagem viraria a
#: média de uma hora inteira com cara de leitura de agora.
AMOSTRA_VALE_POR_SEGUNDOS = 60
#: Respiro entre as duas leituras quando não há amostra anterior.
RESPIRO_SEGUNDOS = 0.25

_KB_POR_MB = 1024


@dataclass(frozen=True)
class AmostraCpu:
    ocupado: int
    total: int


def amostra_cpu(texto_stat: str) -> AmostraCpu:
    """A primeira linha do `/proc/stat`: `cpu user nice system idle iowait irq softirq steal ...`.

    `guest` e `guest_nice` (colunas 9 e 10) já estão somados em `user` e `nice`;
    contá-los de novo inflaria o total. `iowait` conta como ocioso: a CPU está
    esperando o disco, não trabalhando.
    """
    campos = texto_stat.split("\n", 1)[0].split()
    if not campos or campos[0] != "cpu":
        raise ValueError("a primeira linha do /proc/stat não é a agregada da cpu")
    ticks = [int(v) for v in campos[1:9]]
    ocioso = ticks[3] + (ticks[4] if len(ticks) > 4 else 0)
    total = sum(ticks)
    return AmostraCpu(ocupado=total - ocioso, total=total)


def cpu_pct(antes: AmostraCpu, depois: AmostraCpu) -> float | None:
    total = depois.total - antes.total
    if total <= 0:
        return None
    return round(100 * (depois.ocupado - antes.ocupado) / total, 1)


def _recurso(usado_mb: int, livre_mb: int, total_mb: int) -> dict:
    # `usado / (usado + livre)` e não `usado / total`: no disco os dois divergem
    # (o ext4 reserva 5% pro root, que não está em nenhum dos dois), e é a conta
    # que o `df` faz no `Use%` — o número do cockpit tem que bater com o do
    # terminal. Na RAM `usado + livre == total` e as duas contas coincidem.
    base = usado_mb + livre_mb
    return {
        "usado_mb": usado_mb,
        "livre_mb": livre_mb,
        "total_mb": total_mb,
        "pct": round(100 * usado_mb / base, 1) if base > 0 else 0.0,
    }


def memoria(texto_meminfo: str) -> tuple[dict, dict | None]:
    """RAM e swap a partir do `/proc/meminfo`. Swap é `None` na máquina sem swap."""
    kb: dict[str, int] = {}
    for linha in texto_meminfo.splitlines():
        chave, _, resto = linha.partition(":")
        partes = resto.split()
        if partes and partes[0].isdigit():
            kb[chave] = int(partes[0])
    # `MemAvailable`, não `MemFree`: o kernel usa a RAM ociosa como cache de
    # disco e a devolve na hora que alguém pede. `MemFree` acusaria 97% de uso
    # numa máquina folgada.
    ram_total = kb["MemTotal"] // _KB_POR_MB
    ram_livre = kb["MemAvailable"] // _KB_POR_MB
    ram = _recurso(ram_total - ram_livre, ram_livre, ram_total)

    swap_total = kb.get("SwapTotal", 0) // _KB_POR_MB
    if swap_total == 0:
        return ram, None
    swap_livre = kb.get("SwapFree", 0) // _KB_POR_MB
    return ram, _recurso(swap_total - swap_livre, swap_livre, swap_total)


def disco(st: os.statvfs_result) -> dict:
    """Mesmas três colunas do `df`: `Size` = blocos, `Used` = blocos − livres,
    `Avail` = o que um usuário comum ainda pode escrever (`f_bavail`)."""
    bytes_por_mb = 1024 * 1024
    total = st.f_blocks * st.f_frsize // bytes_por_mb
    livre = st.f_bavail * st.f_frsize // bytes_por_mb
    usado = (st.f_blocks - st.f_bfree) * st.f_frsize // bytes_por_mb
    return _recurso(usado, livre, total)


def carga_1m(texto_loadavg: str) -> float:
    return float(texto_loadavg.split()[0])


def no_ar_segundos(texto_uptime: str) -> int:
    return int(float(texto_uptime.split()[0]))


def _le(caminho: str) -> str:
    with open(caminho, encoding="utf-8") as f:
        return f.read()


_ultima_amostra: tuple[AmostraCpu, float] | None = None


async def _cpu_agora() -> float | None:
    global _ultima_amostra
    agora = time.monotonic()
    atual = amostra_cpu(_le(CAMINHO_STAT))
    base = _ultima_amostra
    if base is None or agora - base[1] > AMOSTRA_VALE_POR_SEGUNDOS:
        await asyncio.sleep(RESPIRO_SEGUNDOS)
        base = (atual, agora)
        atual = amostra_cpu(_le(CAMINHO_STAT))
        agora = time.monotonic()
    _ultima_amostra = (atual, agora)
    return cpu_pct(base[0], atual)


async def ler() -> dict:
    ram, swap = memoria(_le(CAMINHO_MEMINFO))
    return {
        "cpu_pct": await _cpu_agora(),
        "carga_1m": carga_1m(_le(CAMINHO_LOADAVG)),
        "nucleos": os.cpu_count() or 1,
        "ram": ram,
        "swap": swap,
        "disco": disco(os.statvfs(RAIZ_DO_DISCO)),
        "no_ar_segundos": no_ar_segundos(_le(CAMINHO_UPTIME)),
        "medido_em": int(time.time()),
    }
