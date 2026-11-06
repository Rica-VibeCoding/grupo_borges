"""Ocupação de tmpfs não é RAM: swap, buracos, links e acesso parcial."""

from pathlib import Path
from types import SimpleNamespace
import os
import tempfile
import time

import pytest

import memoria_tmpfs as tmpfs
from memoria_sistema import item_memoria


def montagem(proc, caminho, ident="0:80", raiz="/"):
    (proc / "self").mkdir(exist_ok=True)
    escapado = str(caminho).replace(" ", r"\040")
    with (proc / "self/mountinfo").open("a") as arq:
        arq.write(f"1 0 {ident} {raiz} {escapado} rw - tmpfs tmpfs rw\n")


def test_montagem_deduplica_bind_e_separa_ram_de_swap(tmp_path, monkeypatch):
    caminho = tmp_path / "com espaço"
    caminho.mkdir()
    montagem(tmp_path, caminho)
    montagem(tmp_path, caminho, raiz="/bind")
    monkeypatch.setattr(tmpfs.os, "statvfs", lambda _: SimpleNamespace(
        f_blocks=10, f_bfree=2, f_frsize=2**20))
    # 8 MB alocados, mas só 3 MB residentes. Outros 2 MB de shmem são internos.
    monkeypatch.setattr(tmpfs, "recorte", lambda *a: (3 * 2**20, 8 * 2**20, False))
    itens = tmpfs.compartilhada(tmp_path, {"Shmem": 5 * 1024}, item_memoria)
    assert [i["memoria_mb"] for i in itens] == [3, 2]
    assert itens[0]["rotulo"] == "Arquivos em " + str(caminho)
    assert itens[0]["memoria_fontes"]["statvfs_usado_bytes"] == 8 * 2**20


def test_inacessivel_ou_desvinculado_fica_no_shmem_sem_inventar_residencia(tmp_path, monkeypatch):
    montagem(tmp_path, tmp_path)
    monkeypatch.setattr(tmpfs.os, "statvfs", lambda _: SimpleNamespace(
        f_blocks=10, f_bfree=2, f_frsize=2**20))
    monkeypatch.setattr(tmpfs, "recorte", lambda *a: (0, 0, True))
    itens = tmpfs.compartilhada(tmp_path, {"Shmem": 5 * 1024}, item_memoria)
    assert itens[0]["memoria_mb"] == 0 and "parcial" in itens[0]["rotulo"]
    assert itens[1]["memoria_mb"] == 5
    assert tmpfs.compartilhada(tmp_path, {}, item_memoria)[-1]["memoria_mb"] is None


def test_leitura_divergente_nao_normaliza_nem_inventa_zero(tmp_path, monkeypatch):
    montagem(tmp_path, tmp_path)
    monkeypatch.setattr(tmpfs.os, "statvfs", lambda _: SimpleNamespace(
        f_blocks=2, f_bfree=0, f_frsize=2**20))
    monkeypatch.setattr(tmpfs, "recorte", lambda *a: (2 * 2**20, 2 * 2**20, False))
    itens = tmpfs.compartilhada(tmp_path, {"Shmem": 1024}, item_memoria)
    assert itens[0]["memoria_mb"] == 2
    assert itens[1]["memoria_mb"] is None


def test_mincore_real_conta_paginas_sem_materializar_buracos_e_sem_duplicar_links():
    if not Path("/dev/shm").is_dir():
        pytest.skip("exige tmpfs Linux")
    with tempfile.TemporaryDirectory(prefix="cockpit-ram-test-", dir="/dev/shm") as pasta:
        arq = Path(pasta, "esparso")
        with arq.open("wb") as fd:
            fd.write(b"a" * tmpfs.PAGINA)
            fd.seek(2 * tmpfs.PAGINA)
            fd.write(b"b" * tmpfs.PAGINA)
        os.link(arq, Path(pasta, "link"))
        Path(pasta, "atalho").symlink_to(arq)
        _, ram, blocos = tmpfs.residente(arq, arq.stat().st_dev)
        assert ram == blocos == 2 * tmpfs.PAGINA
        assert arq.stat().st_size == 3 * tmpfs.PAGINA
        ram_total, blocos_total, _ = tmpfs.recorte(pasta, arq.stat().st_dev, time.monotonic() + 2)
        assert ram_total == blocos_total == ram


def test_prazo_limita_varredura_sem_sugerir_medida_completa(tmp_path):
    (tmp_path / "arquivo").write_text("a")
    assert tmpfs.recorte(tmp_path, tmp_path.stat().st_dev, 0) == (0, 0, True)
