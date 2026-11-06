"""Recortes de processos que atravessam unidades systemd, sem contar cache/swap."""

import os


def contadores_cpu(proc, processos):
    contadores = {}
    for p in processos:
        try:
            campos = (proc / str(p.pid) / "stat").read_text().rsplit(")", 1)[1].split()
            if int(campos[19]) != p.inicio:
                return {}
            uso = (int(campos[11]) + int(campos[12])) * 1_000_000 // os.sysconf("SC_CLK_TCK")
            contadores[f"pid:{p.pid}:{p.inicio}"] = uso
        except (OSError, ValueError, IndexError):
            return {}
    return contadores


def memoria_mb(proc, processos):
    kb = 0
    for p in processos:
        try:
            pasta = proc / str(p.pid)
            campos = (pasta / "stat").read_text().rsplit(")", 1)[1].split()
            if int(campos[19]) != p.inicio:
                return None
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
