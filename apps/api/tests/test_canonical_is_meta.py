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


# ---------- F12: o rastro da troca de conversa não entra no feed ----------

_ENVELOPE_CLEAR = (
    "<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n"
    "            <command-args>Pesquisa lista de conversas para retomar</command-args>"
)
_LEMBRETE_RENAME = (
    "<system-reminder>\nThe user named this session \"Canário\". "
    "This may indicate the session's focus or intent.\n</system-reminder>"
)


def test_envelope_do_clear_some_do_feed() -> None:
    assert _canonical_jsonl_message_event(_evento(_payload_user(_ENVELOPE_CLEAR))) is None
    em_lista = _payload_user("x")
    em_lista["message"]["content"] = [{"type": "text", "text": _ENVELOPE_CLEAR}]
    assert _canonical_jsonl_message_event(_evento(em_lista)) is None


def test_lembrete_do_rename_some_do_feed_so_quando_is_meta() -> None:
    assert _canonical_jsonl_message_event(
        _evento(_payload_user(_LEMBRETE_RENAME, isMeta=True))
    ) is None
    # Digitado por alguém, não é rastro da máquina: fica.
    assert _canonical_jsonl_message_event(_evento(_payload_user(_LEMBRETE_RENAME))) is not None


def test_outros_slash_e_fala_que_cita_clear_ficam() -> None:
    encerrar = _ENVELOPE_CLEAR.replace("/clear", "/encerrar")
    assert _canonical_jsonl_message_event(_evento(_payload_user(encerrar))) is not None
    assert _canonical_jsonl_message_event(
        _evento(_payload_user("por que o <command-name>/clear</command-name> aparece?"))
    ) is not None
