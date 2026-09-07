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


#: Linha real do `/proc/<pid>/stat` (comm com espaço e parêntese dentro, que é o
#: caso que quebra o parse por split simples).
STAT_DE_PROCESSO = (
    "3454703 (Chrome (io)) S 1 3454 3454 0 -1 4194560 91234 0 12 0 "
    "400 165 0 0 20 0 42 0 987654 2300000000 143132 " + "0 " * 30 + "\n"
)

#: Como o kernel entrega: com o `\n` no fim, que já derrubou o nome do agente.
CGROUP_DO_DANIEL = "0::/borges.slice/borges-frota.slice/borges-clawd@daniel.service\n"


CGROUP_DO_PAVAN = "0::/borges.slice/borges-frota.slice/borges-clawd@pavan.service\n"


def _proc(
    pid: int, comm: str, ticks: int, rss_paginas: int, cgroup: str = "0::/x\n"
) -> vps_recursos.Processo:
    return vps_recursos.Processo(
        pid=pid, comm=comm, ticks=ticks, rss_paginas=rss_paginas, cgroup=cgroup.strip()
    )


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
    """A resposta que o rodapé da tropa consome, com a máquina inteira falsa."""
    leituras = iter([STAT_ANTES, STAT_DEPOIS])
    # Daniel gastou 700 dos 1000 ticks da janela e é o maior residente.
    varreduras = iter(
        [
            {7: _proc(7, "claude", 1000, 143132, CGROUP_DO_DANIEL)},
            {7: _proc(7, "claude", 1700, 143132, CGROUP_DO_DANIEL)},
        ]
    )

    def le_falso(caminho: str) -> str:
        if caminho == vps_recursos.CAMINHO_STAT:
            return next(leituras)
        if caminho == vps_recursos.CAMINHO_MEMINFO:
            return MEMINFO
        if caminho == vps_recursos.CAMINHO_LOADAVG:
            return "2.62 2.54 3.39 4/1486 4046398\n"
        if caminho == vps_recursos.CAMINHO_UPTIME:
            return "3024031.48 5338825.23\n"
        if caminho.endswith("/cgroup"):
            return CGROUP_DO_DANIEL
        if caminho.endswith("/cmdline"):
            return "claude\0--continue\0"
        raise AssertionError(caminho)

    monkeypatch.setattr(vps_recursos, "_le", le_falso)
    monkeypatch.setattr(vps_recursos, "_varre_processos", lambda: next(varreduras))
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
    assert corpo["vilao"]["cpu"] == {"nome": "Daniel", "pct": 70.0, "usado_mb": 559}
    assert corpo["vilao"]["ram"] == {"nome": "Daniel", "pct": 4.7, "usado_mb": 559}


def test_stat_com_parentese_no_nome_nao_desalinha_os_campos() -> None:
    p = vps_recursos.processo_do_stat(STAT_DE_PROCESSO)

    assert p.pid == 3454703
    assert p.comm == "Chrome (io)"
    assert p.ticks == 565  # utime 400 + stime 165
    assert p.rss_mb == 559  # 143132 páginas de 4 KB


def test_o_cgroup_transforma_nove_claude_iguais_em_nome_de_agente() -> None:
    """A regressão do `\\n`: sem `strip()` o pedaço vira `...service\\n` e ninguém casa."""
    assert vps_recursos.nome_do_processo(CGROUP_DO_DANIEL, "claude", "") == "Daniel"


def test_processo_de_unidade_comum_usa_o_nome_da_unidade() -> None:
    cgroup = "0::/user.slice/user-1002.slice/user@1002.service/app.slice/cockpit-api.service\n"

    assert vps_recursos.nome_do_processo(cgroup, "python", "") == "cockpit-api"


def test_interpretador_generico_cede_o_nome_pro_primeiro_argumento() -> None:
    """`python3` não informa nada; `homeassistant` informa tudo."""
    cgroup = "0::/system.slice/docker-2e7c3a5b.scope\n"
    cmdline = "python3\0-P\0-m\0homeassistant\0--config\0/config\0"

    assert vps_recursos.nome_do_processo(cgroup, "python3", cmdline) == "homeassistant"


def test_sem_cgroup_nem_argumento_sobra_o_comm() -> None:
    assert vps_recursos.nome_do_processo("0::/\n", "go2rtc", "go2rtc\0") == "go2rtc"


def test_o_consumo_soma_por_dono_e_nao_por_processo() -> None:
    """O agente espalha o trabalho em subprocessos; sozinhos, nenhum é vilão.

    Medido na Oracle: com a máquina a 55%, o maior PROCESSO tinha 5%. Somados
    pelo cgroup, o agente aparece inteiro — que é a pergunta "quem está comendo".
    """
    antes = {
        1: _proc(1, "claude", 100, 100_000, CGROUP_DO_PAVAN),
        2: _proc(2, "rg", 100, 500, CGROUP_DO_PAVAN),
        3: _proc(3, "python", 100, 1000, "0::/system.slice/outro.service\n"),
    }
    depois = {
        1: _proc(1, "claude", 140, 100_000, CGROUP_DO_PAVAN),
        2: _proc(2, "rg", 150, 500, CGROUP_DO_PAVAN),
        3: _proc(3, "python", 160, 1000, "0::/system.slice/outro.service\n"),
    }

    donos = vps_recursos.por_dono(antes, depois)
    achado = vps_recursos.vilao_de_cpu(donos, delta_total_ticks=200)

    assert achado is not None
    # 40 + 50 do Pavan batem os 60 do processo solitário do outro serviço.
    assert achado[1] == 45.0
    # O representante do grupo é o maior residente — o `claude`, não o `rg`.
    assert achado[0].representante.comm == "claude"


def test_pid_reciclado_nao_vira_consumo_e_recem_nascido_espera_a_proxima_janela() -> None:
    """Delta negativo é outro dono no mesmo número; sem par não há janela."""
    antes = {1: _proc(1, "morto", 900, 10)}
    depois = {1: _proc(1, "novo", 5, 10), 2: _proc(2, "recem", 400, 10)}

    donos = vps_recursos.por_dono(antes, depois)

    assert vps_recursos.vilao_de_cpu(donos, delta_total_ticks=200) is None


def test_vilao_de_ram_e_o_maior_residente_com_a_fatia_da_maquina() -> None:
    processos = {
        1: _proc(1, "claude", 0, 143132, CGROUP_DO_DANIEL),
        2: _proc(2, "node", 0, 1000, "0::/outro\n"),
    }

    achado = vps_recursos.vilao_de_ram(vps_recursos.por_dono({}, processos), ram_total_mb=11927)

    assert achado is not None
    assert achado[0].representante.pid == 1
    assert achado[1] == 4.7


def test_maquina_sem_leitura_de_processo_nao_inventa_vilao() -> None:
    assert vps_recursos.vilao_de_ram([], ram_total_mb=11927) is None
    assert vps_recursos.vilao_de_cpu([], delta_total_ticks=200) is None
