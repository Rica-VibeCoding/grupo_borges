"""Data inicial da conversa no resumo incremental do JSONL."""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import conversas


def _linha(payload: dict) -> bytes:
    return (json.dumps(payload, separators=(",", ":")) + "\n").encode()


def _listar(pasta: Path) -> dict[str, dict]:
    itens = conversas.listar(
        pasta, nomes=set(), metas={}, atual=None, atuais_de_outras={},
        agora=time.time(), com_pendencia=False,
    )
    return {item["id"]: item for item in itens}


def test_inicio_ignora_linha_sem_timestamp_e_persiste_no_cache(tmp_path: Path, monkeypatch) -> None:
    session_id = "11111111-1111-4111-8111-111111111111"
    vazio_id = "22222222-2222-4222-8222-222222222222"
    caminho = tmp_path / f"{session_id}.jsonl"
    (tmp_path / f"{vazio_id}.jsonl").touch()
    primeiro = "2026-09-28T14:10:00.123Z"
    posterior = "2026-09-29T08:00:00.000Z"
    caminho.write_bytes(
        _linha({"type": "file-history-snapshot", "snapshot": {}})
        + _linha({"type": "assistant", "timestamp": primeiro, "message": {"content": []}})
        + _linha({"type": "user", "timestamp": posterior, "message": {"content": "Oi"}})
    )
    esperado = int(datetime.fromisoformat(primeiro.replace("Z", "+00:00")).timestamp() * 1000)

    itens = _listar(tmp_path)
    assert itens[session_id]["iniciada_em"] == esperado
    assert itens[vazio_id]["iniciada_em"] is None
    lidas: list[bytes] = []
    original = conversas._absorver

    def contar(resumo: conversas._Resumo, linha: bytes) -> None:
        lidas.append(linha)
        original(resumo, linha)

    monkeypatch.setattr(conversas, "_absorver", contar)
    assert _listar(tmp_path)[session_id]["iniciada_em"] == esperado
    assert lidas == []

    nova_linha = _linha({"type": "user", "timestamp": posterior, "message": {"content": "Depois"}})
    with caminho.open("ab") as arquivo:
        arquivo.write(nova_linha)
    assert _listar(tmp_path)[session_id]["iniciada_em"] == esperado
    assert lidas == [nova_linha.rstrip(b"\n")]
    assert conversas.ficha(
        caminho, caminho.stat(), session_id, meta=None, nomes=set()
    )["iniciada_em"] == esperado
