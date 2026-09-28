"""`enxuto=1` no SSE de mensagens: sai o que nenhuma tela lê, fica o resto.

Medido em 28/09 (300 mensagens, `recentes=1`): `signature` do thinking e
`message.usage` somam ~21% do replay do `maestro` e ~22% do da `tara`.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.feed_enxuto import enxuga_para_feed

FAMILIAS = Path(__file__).resolve().parents[3] / "fixtures" / "cockpit-v2" / "familias"


def _familias() -> list[Path]:
    return sorted(p for p in FAMILIAS.glob("*.json") if not p.name.startswith("_"))


def _sem_o_que_sai(evento: dict[str, Any]) -> dict[str, Any]:
    """O evento como deveria ficar: o original menos as duas chaves, à mão."""
    esperado = copy.deepcopy(evento)
    message = esperado.get("message")
    if isinstance(message, dict):
        message.pop("usage", None)
        if isinstance(message.get("content"), list):
            for parte in message["content"]:
                if isinstance(parte, dict) and parte.get("type") == "thinking":
                    parte.pop("signature", None)
    return esperado


def test_familias_existem() -> None:
    assert len(_familias()) == 52


@pytest.mark.parametrize("caminho", _familias(), ids=lambda p: p.stem)
def test_familia_real_perde_so_signature_e_usage(caminho: Path) -> None:
    evento = json.loads(caminho.read_text(encoding="utf-8"))["evento"]
    enxuto = copy.deepcopy(evento)

    enxuga_para_feed(enxuto)

    assert enxuto == _sem_o_que_sai(evento)
    # O que os renderers ricos leem atravessa intacto.
    assert enxuto.get("tool_use_result") == evento.get("tool_use_result")
    for chave in ("id", "kind", "uuid", "parent_uuid", "session_id", "is_sidechain", "timestamp"):
        assert enxuto.get(chave) == evento.get(chave)


def test_thinking_fica_com_texto_e_sem_assinatura() -> None:
    evento = json.loads((FAMILIAS / "bloco__thinking.json").read_text(encoding="utf-8"))["evento"]
    antes = [p for p in evento["message"]["content"] if p.get("type") == "thinking"]
    assert antes and all("signature" in p for p in antes)

    enxuga_para_feed(evento)

    depois = [p for p in evento["message"]["content"] if p.get("type") == "thinking"]
    assert len(depois) == len(antes)
    assert all("signature" not in p for p in depois)
    assert [p["thinking"] for p in depois] == [p["thinking"] for p in antes]


def test_mensagem_de_resposta_perde_usage_e_mantem_stop_reason() -> None:
    evento = {
        "kind": "assistant",
        "message": {
            "role": "assistant",
            "stop_reason": "end_turn",
            "model": "claude-opus-4-8",
            "usage": {"input_tokens": 1, "output_tokens": 2},
            "content": [
                {"type": "thinking", "thinking": "", "signature": "x" * 2_000},
                {"type": "text", "text": "oi", "signature": "fica"},
            ],
        },
        "tool_use_result": None,
    }

    enxuga_para_feed(evento)

    assert evento["message"] == {
        "role": "assistant",
        "stop_reason": "end_turn",
        "model": "claude-opus-4-8",
        # Bloco `thinking` vazio continua na lista: a contagem de partes do
        # agrupador e a decisão de "ausência" olham o texto, não a presença.
        "content": [
            {"type": "thinking", "thinking": ""},
            {"type": "text", "text": "oi", "signature": "fica"},
        ],
    }


@pytest.mark.parametrize(
    "evento",
    [
        {"kind": "queued", "message": None, "content": "fila"},
        {"kind": "user", "message": {"role": "user", "content": "texto cru"}},
        {"kind": "system"},
    ],
)
def test_bordas_passam_sem_erro_e_sem_mudar(evento: dict[str, Any]) -> None:
    original = copy.deepcopy(evento)
    enxuga_para_feed(evento)
    assert evento == original
