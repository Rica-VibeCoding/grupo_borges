"""O consumo da VPS lido do `/proc` — parse e conta, contra amostras reais.

As amostras são da Oracle em 07/09/2026 (2 núcleos ARM, 12 GB, swap de 4 GB,
disco de 96 GB a 64%). O que se trava aqui é a CONTA: RAM por `MemAvailable`,
disco com a mesma fórmula do `df`, CPU como diferença entre duas leituras.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import vps as vps_router
from services import vps_recursos

STAT_ANTES = "cpu  44838772 41551 20187572 533882523 380647 0 497489 782469 0 0\n"
#: 1000 ticks depois: 700 de user, 100 de system, 150 idle, 50 iowait.
STAT_DEPOIS = "cpu  44839472 41551 20187672 533882673 380697 0 497489 782469 0 0\n"

MEMINFO = """MemTotal:       12213612 kB
MemFree:          218500 kB
MemAvailable:    4567684 kB
Buffers:          237244 kB
Cached:          3309024 kB
SwapTotal:       4194300 kB
SwapFree:        1139588 kB
"""

MEMINFO_SEM_SWAP = """MemTotal:        2000000 kB
MemFree:          500000 kB
MemAvailable:    1000000 kB
SwapTotal:             0 kB
SwapFree:              0 kB
"""


def test_cpu_e_a_diferenca_entre_duas_leituras_e_iowait_conta_como_ocioso() -> None:
    antes = vps_recursos.amostra_cpu(STAT_ANTES)
    depois = vps_recursos.amostra_cpu(STAT_DEPOIS)

    # 1000 ticks no total; 150 idle + 50 iowait ociosos → 80% ocupado.
    assert vps_recursos.cpu_pct(antes, depois) == 80.0


def test_cpu_sem_intervalo_nao_inventa_numero() -> None:
    amostra = vps_recursos.amostra_cpu(STAT_ANTES)

    assert vps_recursos.cpu_pct(amostra, amostra) is None


def test_cpu_recusa_texto_que_nao_e_a_linha_agregada() -> None:
    with pytest.raises(ValueError):
        vps_recursos.amostra_cpu("cpu0 1 2 3 4 5 6 7 8 0 0\n")


def test_ram_usa_mem_available_e_nao_mem_free() -> None:
    """Com `MemFree` a Oracle acusaria 98% de uso; o cache de disco é devolvível."""
    ram, swap = vps_recursos.memoria(MEMINFO)

    assert ram == {"usado_mb": 7467, "livre_mb": 4460, "total_mb": 11927, "pct": 62.6}
    assert swap == {"usado_mb": 2983, "livre_mb": 1112, "total_mb": 4095, "pct": 72.8}


def test_maquina_sem_swap_devolve_none_em_vez_de_zero_por_cento() -> None:
    _, swap = vps_recursos.memoria(MEMINFO_SEM_SWAP)

    assert swap is None


def test_disco_faz_a_mesma_conta_do_df() -> None:
    """`df /` na Oracle: 98122M total, 62642M usado, 35465M livre, 64%."""
    st = os.statvfs_result((4096, 4096, 25119164, 9082917, 9078821, 0, 0, 0, 0, 255))

    assert vps_recursos.disco(st) == {
        "usado_mb": 62641,
        "livre_mb": 35464,
        "total_mb": 98121,
        "pct": 63.9,
    }


def test_carga_e_uptime_leem_o_primeiro_campo() -> None:
    assert vps_recursos.carga_1m("2.62 2.54 3.39 4/1486 4046398\n") == 2.62
    assert vps_recursos.no_ar_segundos("3024031.48 5338825.23\n") == 3024031


def test_endpoint_entrega_o_bloco_inteiro(monkeypatch) -> None:
    leituras = iter([STAT_ANTES, STAT_DEPOIS])

    def le_falso(caminho: str) -> str:
        if caminho == vps_recursos.CAMINHO_STAT:
            return next(leituras)
        if caminho == vps_recursos.CAMINHO_MEMINFO:
            return MEMINFO
        if caminho == vps_recursos.CAMINHO_LOADAVG:
            return "2.62 2.54 3.39 4/1486 4046398\n"
        if caminho == vps_recursos.CAMINHO_UPTIME:
            return "3024031.48 5338825.23\n"
        raise AssertionError(caminho)

    monkeypatch.setattr(vps_recursos, "_le", le_falso)
    monkeypatch.setattr(vps_recursos, "_ultima_amostra", None)
    monkeypatch.setattr(vps_recursos, "RESPIRO_SEGUNDOS", 0)
    monkeypatch.setattr(
        vps_recursos.os,
        "statvfs",
        lambda _: os.statvfs_result((4096, 4096, 25119164, 9082917, 9078821, 0, 0, 0, 0, 255)),
    )
    app = FastAPI()
    app.include_router(vps_router.router, prefix="/api/vps")

    corpo = TestClient(app).get("/api/vps").json()

    assert corpo["cpu_pct"] == 80.0
    assert corpo["carga_1m"] == 2.62
    assert corpo["ram"]["pct"] == 62.6
    assert corpo["swap"]["usado_mb"] == 2983
    assert corpo["disco"]["livre_mb"] == 35464
    assert corpo["no_ar_segundos"] == 3024031
    assert corpo["nucleos"] >= 1
