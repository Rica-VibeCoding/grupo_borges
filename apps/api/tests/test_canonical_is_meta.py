"""O repasse de `isMeta` → `is_meta` na canonização (ordem do Rica, 17/08).

O CC grava o corpo expandido de um slash custom como `user` com `isMeta: true`
logo depois do envelope do comando. Sem o repasse o feed desenhava o ritual
inteiro como fala digitada — o "textão" do `/encerrar`. Com a marca, o
classificador dobra o corpo dentro do chip do comando.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers.agents import _canonical_jsonl_message_event


def _evento(payload: dict) -> dict:
    return {"id": 1, "created_at": 1_755_590_400, "payload": payload}


def _payload_user(texto: str, **extra: object) -> dict:
    return {
        "type": "user",
        "uuid": "u-1",
        "sessionId": "s-1",
        "timestamp": "2026-08-17T00:00:00Z",
        "isSidechain": False,
        "message": {"role": "user", "content": texto},
        **extra,
    }


def test_canonical_event_repassa_is_meta_quando_true() -> None:
    canon = _canonical_jsonl_message_event(
        _evento(_payload_user("Sessão encerrada. Nesta ordem:…", isMeta=True))
    )
    assert canon is not None
    assert canon["is_meta"] is True


def test_canonical_event_omite_is_meta_nos_demais() -> None:
    canon = _canonical_jsonl_message_event(_evento(_payload_user("digitado")))
    assert canon is not None
    assert "is_meta" not in canon
