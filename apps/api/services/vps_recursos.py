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


# ── O vilão ─────────────────────────────────────────────────────────────────
#
# Ordem do Rica (07/09): *"coloca o vilão, o que estiver usando mais do que nos
# importa — menos de disco, só do que realmente trava"*. Trava é CPU e memória:
# o disco cheio incomoda, mas quem congela a frota é RAM que acabou e núcleo que
# não vaza.
#
# Uma leitura por processo, e ela é o `/proc/<pid>/stat`: o mesmo arquivo traz
# os ticks de CPU e as páginas residentes. 373 processos em 8 ms medidos na
# Oracle — um `ps` por chamada custaria um fork.
#
# O consumo é somado POR DONO, não por processo. Medido na Oracle antes de
# agrupar: com a máquina a 50% de CPU, o maior processo sozinho aparecia com 5%
# — o painel coroaria de vilão quem só era o maior de uma multidão, e um agente
# do Claude Code espalha o próprio trabalho em subprocessos (`rg`, `node`, `git`)
# que sozinhos não dizem nada. O cgroup é o que costura os pedaços de volta no
# nome de quem mandou fazer.

PAGINA_BYTES = 4096
TICKS_POR_SEGUNDO = 100

#: `comm` que não diz nada sozinho: quem manda é o primeiro argumento.
INTERPRETADORES = frozenset({"python", "python3", "node", "bash", "sh", "uv", "uvicorn"})


@dataclass(frozen=True)
class Processo:
    pid: int
    comm: str
    ticks: int
    rss_paginas: int
    #: O caminho cru do `/proc/<pid>/cgroup`. É a CHAVE do dono: todos os
    #: processos de um agente da frota compartilham o mesmo.
    cgroup: str = ""

    @property
    def rss_mb(self) -> int:
        return self.rss_paginas * PAGINA_BYTES // (1024 * 1024)


@dataclass(frozen=True)
class Dono:
    """Um consumidor somado: o agente, o serviço, o container."""

    chave: str
    representante: Processo
    ticks: int
    rss_paginas: int

    @property
    def rss_mb(self) -> int:
        return self.rss_paginas * PAGINA_BYTES // (1024 * 1024)


def processo_do_stat(texto: str, cgroup: str = "") -> Processo:
    """`/proc/<pid>/stat`: pid, `(comm)`, estado, e 49 campos depois.

    O corte é no ÚLTIMO `)` porque o `comm` pode ter espaço e parêntese dentro
    (`(sd-pam)`, `(Chrome_ChildIO)`) — dividir a linha por espaço desalinharia
    todos os campos seguintes num punhado de processos, justo os de nome
    estranho que a gente mais quer identificar.
    """
    abre = texto.index("(")
    fecha = texto.rindex(")")
    pid = int(texto[:abre].strip())
    comm = texto[abre + 1 : fecha]
    # A partir daqui o campo 1 da lista é o `state`, o 3º campo do arquivo.
    campos = texto[fecha + 2 :].split()
    return Processo(
        pid=pid,
        comm=comm,
        ticks=int(campos[11]) + int(campos[12]),  # utime + stime
        rss_paginas=int(campos[21]),
        cgroup=cgroup.strip(),
    )


def _varre_processos() -> dict[int, Processo]:
    achados: dict[int, Processo] = {}
    for entrada in os.listdir("/proc"):
        if not entrada.isdigit():
            continue
        try:
            achados[int(entrada)] = processo_do_stat(
                _le(f"/proc/{entrada}/stat"), _le(f"/proc/{entrada}/cgroup")
            )
        except (OSError, ValueError, IndexError):
            # Processo que morreu entre o `listdir` e a leitura. É o caso comum
            # numa máquina com 300 processos, não uma exceção digna de log.
            continue
    return achados


def nome_do_processo(cgroup: str, comm: str, cmdline: str) -> str:
    """Quem é o dono, na palavra que o Rica usa pra ele.

    A frota inteira roda sob `borges-clawd@<slug>.service`, então o cgroup
    transforma nove processos `claude` idênticos em nove nomes de agente — que é
    a única forma desta linha responder "quem está comendo".
    """
    unidade = ""
    # `.strip()` não é higiene: o `/proc/<pid>/cgroup` termina em `\n`, e sem
    # tirá-lo o último pedaço vira `...service\n` — nenhum nome de agente casa,
    # e os nove processos da frota voltam a se chamar `claude`.
    for pedaco in cgroup.strip().split("/"):
        if pedaco.endswith(".service"):
            unidade = pedaco[: -len(".service")]
    if unidade.startswith("borges-clawd@"):
        return unidade[len("borges-clawd@") :].capitalize()
    if unidade:
        return unidade
    if comm in INTERPRETADORES:
        argumentos = [a for a in cmdline.split("\0") if a and not a.startswith("-")]
        if len(argumentos) > 1:
            return os.path.basename(argumentos[1])
    return comm


def _nomeia(dono: Dono) -> str:
    representante = dono.representante
    try:
        cmdline = _le(f"/proc/{representante.pid}/cmdline")
    except OSError:
        cmdline = ""
    return nome_do_processo(representante.cgroup, representante.comm, cmdline)


def por_dono(antes: dict[int, Processo], depois: dict[int, Processo]) -> list[Dono]:
    """O consumo somado por cgroup, com o maior processo do grupo como cara dele.

    O representante é escolhido pela RAM residente porque é o processo principal
    que carrega a memória do trabalho: num agente do Claude Code é o `claude`, e
    não o `git` de dois segundos que nasceu debaixo dele.
    """
    ticks: dict[str, int] = {}
    rss: dict[str, int] = {}
    representantes: dict[str, Processo] = {}
    for pid, atual in depois.items():
        chave = atual.cgroup
        anterior = antes.get(pid)
        # Sem par na leitura anterior não há janela pra este processo; a RAM,
        # que é instantânea, entra do mesmo jeito.
        gasto = atual.ticks - anterior.ticks if anterior is not None else 0
        # Negativo é pid reciclado: o número do processo voltou pra outro dono
        # entre as duas leituras, e o "gasto" seria a diferença entre estranhos.
        ticks[chave] = ticks.get(chave, 0) + max(0, gasto)
        rss[chave] = rss.get(chave, 0) + atual.rss_paginas
        maior = representantes.get(chave)
        if maior is None or atual.rss_paginas > maior.rss_paginas:
            representantes[chave] = atual
    return [
        Dono(chave=chave, representante=representantes[chave], ticks=ticks[chave], rss_paginas=rss[chave])
        for chave in representantes
    ]


def vilao_de_cpu(donos: list[Dono], delta_total_ticks: int) -> tuple[Dono, float] | None:
    """Quem consumiu mais da CPU entre as duas leituras, na escala da MÁQUINA.

    Mesma base do `cpu_pct` de cima — 100% é a soma dos núcleos, não um deles.
    Dois números na mesma tela com réguas diferentes seriam duas verdades.
    """
    if delta_total_ticks <= 0 or not donos:
        return None
    maior = max(donos, key=lambda d: d.ticks)
    if maior.ticks <= 0:
        return None
    return maior, round(100 * maior.ticks / delta_total_ticks, 1)


def vilao_de_ram(donos: list[Dono], ram_total_mb: int) -> tuple[Dono, float] | None:
    if not donos:
        return None
    maior = max(donos, key=lambda d: d.rss_paginas)
    if maior.rss_paginas <= 0:
        return None
    pct = round(100 * maior.rss_mb / ram_total_mb, 1) if ram_total_mb > 0 else 0.0
    return maior, pct


_ultima_amostra: tuple[AmostraCpu, dict[int, Processo], float] | None = None


async def _amostra_agora() -> tuple[AmostraCpu, dict[int, Processo]]:
    return amostra_cpu(_le(CAMINHO_STAT)), _varre_processos()


async def ler() -> dict:
    """As duas leituras que a CPU exige, e o resto pendurado nelas.

    A amostra anterior fica no módulo: o cockpit pergunta a cada dez segundos, e
    a janela entre duas perguntas é a medida. Sem amostra utilizável (primeira
    chamada, ou uma velha demais pra representar "agora"), tira as duas na hora
    com um respiro curto — a resposta atrasa 250 ms uma vez, não sempre.
    """
    global _ultima_amostra
    agora = time.monotonic()
    cpu, processos = await _amostra_agora()
    base = _ultima_amostra
    if base is None or agora - base[2] > AMOSTRA_VALE_POR_SEGUNDOS:
        await asyncio.sleep(RESPIRO_SEGUNDOS)
        base = (cpu, processos, agora)
        cpu, processos = await _amostra_agora()
        agora = time.monotonic()
    _ultima_amostra = (cpu, processos, agora)

    donos = por_dono(base[1], processos)
    ram, swap = memoria(_le(CAMINHO_MEMINFO))
    return {
        "cpu_pct": cpu_pct(base[0], cpu),
        "carga_1m": carga_1m(_le(CAMINHO_LOADAVG)),
        "nucleos": os.cpu_count() or 1,
        "ram": ram,
        "swap": swap,
        "disco": disco(os.statvfs(RAIZ_DO_DISCO)),
        "vilao": {
            "cpu": _publica_vilao(vilao_de_cpu(donos, cpu.total - base[0].total)),
            "ram": _publica_vilao(vilao_de_ram(donos, ram["total_mb"])),
        },
        "no_ar_segundos": no_ar_segundos(_le(CAMINHO_UPTIME)),
        "medido_em": int(time.time()),
    }


def _publica_vilao(achado: tuple[Dono, float] | None) -> dict | None:
    if achado is None:
        return None
    dono, pct = achado
    return {"nome": _nomeia(dono), "pct": pct, "usado_mb": dono.rss_mb}
