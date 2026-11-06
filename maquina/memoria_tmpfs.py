"""Tmpfs por montagem: statvfs mede ocupação; mincore mede RAM sem ler páginas.

Sem acesso a todos os arquivos (inclusive desvinculados), o recorte é parcial;
o restante fica no Shmem global. Nunca considera df inteiro como RAM residente.
"""

import ctypes
import os
from pathlib import Path
import re
import stat
import time


LIBC = ctypes.CDLL(None, use_errno=True)
LIBC.mmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int,
                      ctypes.c_int, ctypes.c_int, ctypes.c_long]
LIBC.mmap.restype = ctypes.c_void_p
LIBC.mincore.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p]
LIBC.munmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
PAGINA = os.sysconf("SC_PAGE_SIZE")


def residente(arquivo, dispositivo, limite=float("inf")):
    # Sem seguir symlinks nem tocar o conteúdo. mincore mente (todos residentes)
    # para arquivos sem posse/permissão: restringe a dono ou root.
    fd = os.open(arquivo, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOATIME)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_dev != dispositivo:
            return None
        if os.geteuid() not in (0, info.st_uid):
            raise PermissionError("mincore sem garantia de residência")
        if info.st_size == 0:
            return info.st_ino, 0, 0
        # Limita o vetor e o mapeamento mesmo para arquivos enormes/esparsos.
        total = 0
        for inicio in range(0, info.st_size, 64 * 2**20):
            if time.monotonic() >= limite:
                raise TimeoutError("recorte parcial")
            tamanho = min(64 * 2**20, info.st_size - inicio)
            endereco = LIBC.mmap(None, tamanho, 0, 1, fd, inicio)  # PROT_NONE, MAP_SHARED
            if endereco == ctypes.c_void_p(-1).value:
                raise OSError(ctypes.get_errno(), "mmap")
            try:
                vetor = (ctypes.c_ubyte * ((tamanho + PAGINA - 1) // PAGINA))()
                if LIBC.mincore(endereco, tamanho, vetor):
                    raise OSError(ctypes.get_errno(), "mincore")
                total += sum(v & 1 for v in vetor) * PAGINA
            finally:
                LIBC.munmap(endereco, tamanho)
        return info.st_ino, total, info.st_blocks * 512
    finally:
        os.close(fd)


def recorte(montagem, dispositivo, limite):
    vistos, ram, blocos = set(), 0, 0
    parcial = False

    def erro(_):
        nonlocal parcial
        parcial = True

    for pasta, diretorios, arquivos in os.walk(montagem, onerror=erro, followlinks=False):
        if time.monotonic() >= limite:
            return ram, blocos, True
        # Não atravessa outro filesystem nem conta bind mounts de novo.
        permitidos = []
        for nome in diretorios:
            try:
                info = os.stat(Path(pasta, nome), follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode) and info.st_dev == dispositivo:
                    permitidos.append(nome)
            except OSError:
                parcial = True
        diretorios[:] = permitidos
        for nome in arquivos:
            if time.monotonic() >= limite:
                return ram, blocos, True
            try:
                leitura = residente(Path(pasta, nome), dispositivo, limite)
                if leitura is not None and leitura[0] not in vistos:
                    vistos.add(leitura[0])
                    ram += leitura[1]
                    blocos += leitura[2]
            except FileNotFoundError:
                pass
            except OSError:
                parcial = True
    return ram, blocos, parcial


def compartilhada(proc, mem, item):
    itens, dispositivos, total = [], set(), 0
    try:
        linhas = (proc / "self/mountinfo").read_text().splitlines()
    except OSError:
        linhas = []  # Shmem continua inteiro, sem inventar montagens.
    for linha in linhas:
        campos, fs = linha.split(" - ", 1)
        if fs.split()[0] != "tmpfs":
            continue
        campos = campos.split()
        # mountinfo escapa espaços, tabs, quebras de linha e barras em octal.
        montagem = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), campos[4])
        if campos[2] in dispositivos:
            continue
        dispositivos.add(campos[2])
        try:
            uso = os.statvfs(montagem)
            ocupado = (uso.f_blocks - uso.f_bfree) * uso.f_frsize
            if not ocupado:
                continue
            ram, blocos, parcial = recorte(montagem, os.stat(montagem).st_dev,
                                          time.monotonic() + 0.1)
            parcial |= blocos != ocupado
            fontes = {"montagem": montagem, "statvfs_usado_bytes": ocupado,
                      "mincore_residente_bytes": ram, "blocos_visiveis_bytes": blocos,
                      "parcial": parcial}
            total += ram
            itens.append(item("tmpfs:" + campos[2], "Arquivos em " + montagem +
                              (" (parcial)" if parcial else ""), round(ram / 2**20, 2), fontes))
        except OSError:
            # A RAM inacessível continua no Shmem global, nunca vira zero.
            continue
    resto = mem.get("Shmem")
    resto = None if resto is None or resto * 1024 < total else resto * 1024 - total
    if resto != 0:
        itens.append(item("memoria-compartilhada", "Memória compartilhada e tmpfs sem recorte",
                          None if resto is None else round(resto / 2**20, 2),
                          {"Shmem": mem.get("Shmem"), "tmpfs_residente_bytes": total}))
    return itens
