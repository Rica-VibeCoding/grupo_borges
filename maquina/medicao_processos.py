"""Recortes de processos que atravessam unidades systemd, sem contar cache/swap."""

import os


RELOGIO = "relogio"  # /proc/uptime em ticks: mesma base do starttime do stat.


def contadores_cpu(proc, processos):
    contadores = {}
    try:
        tick = os.sysconf("SC_CLK_TCK")
        contadores[RELOGIO] = int(float((proc / "uptime").read_text().split()[0]) * tick)
    except (OSError, ValueError, IndexError):
        pass  # Sem relógio, só um conjunto idêntico de processos dá delta.
    for p in processos:
        try:
            campos = (proc / str(p.pid) / "stat").read_text().rsplit(")", 1)[1].split()
            if int(campos[19]) != p.inicio:
                continue  # PID reaproveitado: o processo listado já saiu.
            uso = (int(campos[11]) + int(campos[12])) * 1_000_000 // os.sysconf("SC_CLK_TCK")
            contadores[f"pid:{p.pid}:{p.inicio}"] = uso
        except (FileNotFoundError, ProcessLookupError):
            continue  # Saiu entre a listagem e a leitura.
        except (OSError, ValueError, IndexError):
            return {}
    return contadores if any(k != RELOGIO for k in contadores) else {}


def delta_processos(cpus, anterior):
    """Microssegundos de CPU entre duas leituras de um conjunto de processos.

    Processo que saiu leva consigo a última fatia (vai para Fora da lista).
    Processo novo só conta se nasceu depois da leitura anterior: aí todo o
    contador dele cabe no intervalo. Um que já existia veio de outro item com
    a CPU da vida inteira — sem delta, espera a próxima amostra.
    """
    if anterior is None or RELOGIO not in cpus or RELOGIO not in anterior:
        return None
    total = 0
    for chave, uso in cpus.items():
        if chave == RELOGIO:
            continue
        if chave in anterior:
            if uso < anterior[chave]:
                return None
            total += uso - anterior[chave]
        elif int(chave.rsplit(":", 1)[1]) >= anterior[RELOGIO]:
            total += uso
        else:
            return None
    return total


def memoria_mb(proc, processos):
    kb = 0
    for p in processos:
        pasta = proc / str(p.pid)
        try:
            campos = (pasta / "stat").read_text().rsplit(")", 1)[1].split()
        except (FileNotFoundError, ProcessLookupError):
            continue  # Saiu entre a listagem e a leitura: não ocupa mais RAM.
        except (OSError, IndexError):
            return None
        try:
            if int(campos[19]) != p.inicio:
                continue  # PID reaproveitado: o processo listado já saiu.
            mem = {linha.split(':', 1)[0]: int(linha.split()[1])
                   for linha in (pasta / "smaps_rollup").read_text().splitlines()
                   if linha.startswith(("Pss_Anon:", "Pss_Shmem:"))}
            kb += mem["Pss_Anon"] + mem["Pss_Shmem"]
        except (OSError, ValueError, KeyError, IndexError):
            return None
    return round(kb / 1024, 2)


def soma_medidas(valores):
    valores = list(valores)
    return None if None in valores else round(sum(valores), 2)
