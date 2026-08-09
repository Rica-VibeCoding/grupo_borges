"""Corte de `tool_result` gigante no replay do SSE de mensagens.

Medido em 09/08: o replay do `daniel` traz 1005 mensagens somando 4,67 MB, com
mediana de 1,4 KB — o peso está em seis resultados de ferramenta, o maior com
360 mil caracteres. O feed nunca desenha isso inteiro (todos os renderers param
em 120 linhas), mas o navegador paga o parse: 3,6s de JS bloqueado contra 50ms
de um agente leve.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers.agents import _corta_resultados_grandes


def _com_tool_result(conteudo: Any) -> dict[str, Any]:
    return {
        "kind": "user",
        "message": {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "t1", "content": conteudo}],
        },
        "tool_use_result": None,
    }


def test_corta_tool_result_em_string_e_diz_quanto_omitiu() -> None:
    evento = _com_tool_result("x" * 5_000)
    _corta_resultados_grandes(evento, 1_000)

    cortado = evento["message"]["content"][0]["content"]
    assert cortado.startswith("x" * 1_000)
    assert "4000 caracteres omitidos" in cortado
    assert len(cortado) < 1_200


def test_corta_tool_result_entregue_em_blocos_de_texto() -> None:
    evento = _com_tool_result([{"type": "text", "text": "y" * 5_000}])
    _corta_resultados_grandes(evento, 1_000)

    bloco = evento["message"]["content"][0]["content"][0]
    assert bloco["text"].startswith("y" * 1_000)
    assert "4000 caracteres omitidos" in bloco["text"]


def test_corta_tool_use_result_que_espelha_o_mesmo_resultado() -> None:
    evento = _com_tool_result("curto")
    evento["tool_use_result"] = "z" * 5_000
    _corta_resultados_grandes(evento, 1_000)

    assert evento["tool_use_result"].startswith("z" * 1_000)
    assert "4000 caracteres omitidos" in evento["tool_use_result"]


def test_teto_zero_nao_corta_nada() -> None:
    """O default. O v1 (`apps/web`) consome este mesmo endpoint sem passar o
    parâmetro, e é a tela que o Rica usa todo dia."""
    evento = _com_tool_result("x" * 500_000)
    _corta_resultados_grandes(evento, 0)

    assert evento["message"]["content"][0]["content"] == "x" * 500_000


def test_resultado_abaixo_do_teto_fica_intocado() -> None:
    evento = _com_tool_result("cabe inteiro")
    _corta_resultados_grandes(evento, 1_000)

    assert evento["message"]["content"][0]["content"] == "cabe inteiro"


def test_fala_e_texto_do_assistente_passam_inteiros() -> None:
    """O peso do feed nunca esteve na conversa: cortar fala do Rica ou resposta
    longa do assistente seria perder o que ele foi ler."""
    evento = {
        "kind": "assistant",
        "message": {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "a" * 50_000},
                {"type": "thinking", "thinking": "b" * 50_000},
            ],
        },
        "tool_use_result": None,
    }
    _corta_resultados_grandes(evento, 1_000)

    assert evento["message"]["content"][0]["text"] == "a" * 50_000
    assert evento["message"]["content"][1]["thinking"] == "b" * 50_000


def test_fala_do_rica_em_string_crua_passa_inteira() -> None:
    evento = {"kind": "user", "message": {"role": "user", "content": "c" * 50_000}}
    _corta_resultados_grandes(evento, 1_000)

    assert evento["message"]["content"] == "c" * 50_000


# --- imagem em base64: o caso REAL, e o que mais pesa -----------------------
# Cinco imagens somam 1,15 MB do replay do `daniel` e o feed não desenha
# nenhuma (`renderers/file-content.ts` devolve `conteudo: ''` para binário).


def _com_imagem(data: str) -> dict[str, Any]:
    bloco = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}
    return {
        "kind": "user",
        "message": {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "t1", "content": [bloco]}],
        },
        "tool_use_result": {"type": "image", "file": {"filePath": "/tmp/x.png", "image": bloco}},
    }


def test_esvazia_base64_da_imagem_nos_dois_lugares_em_que_ela_aparece() -> None:
    evento = _com_imagem("A" * 500_000)
    _corta_resultados_grandes(evento, 32_000)

    do_content = evento["message"]["content"][0]["content"][0]
    do_espelho = evento["tool_use_result"]["file"]["image"]
    assert do_content["source"]["data"] == ""
    assert do_espelho["source"]["data"] == ""


def test_a_forma_da_imagem_sobrevive_ao_corte() -> None:
    """Quem classifica o payload olha `type`/`media_type`, não os bytes — se o
    corte levasse a forma junto, o item deixaria de ser reconhecido."""
    evento = _com_imagem("A" * 500_000)
    _corta_resultados_grandes(evento, 32_000)

    fonte = evento["message"]["content"][0]["content"][0]
    assert fonte["type"] == "image"
    assert fonte["source"]["type"] == "base64"
    assert fonte["source"]["media_type"] == "image/png"


def test_teto_zero_tambem_preserva_a_imagem_inteira() -> None:
    evento = _com_imagem("A" * 500_000)
    _corta_resultados_grandes(evento, 0)

    assert evento["message"]["content"][0]["content"][0]["source"]["data"] == "A" * 500_000


# --- espelho em forma de DICT ----------------------------------------------
# Apontado pela auditoria do Canário (09/08) e confirmado no replay real: o
# `tool_use_result` costuma ser dict, e texto longo aninhado nele escapava do
# corte. Eram quatro no histórico do `daniel`, o maior com 199 mil caracteres.


def test_corta_texto_longo_aninhado_no_espelho_dict() -> None:
    evento = _com_tool_result("curto")
    evento["tool_use_result"] = {
        "type": "text",
        "file": {"filePath": "/tmp/gigante.log", "content": "L" * 200_000},
    }
    _corta_resultados_grandes(evento, 32_000)

    conteudo = evento["tool_use_result"]["file"]["content"]
    assert conteudo.startswith("L" * 32_000)
    assert "168000 caracteres omitidos" in conteudo
    assert len(conteudo) < 33_000


def test_campo_estrutural_curto_do_espelho_nao_e_tocado() -> None:
    evento = _com_tool_result("curto")
    evento["tool_use_result"] = {
        "type": "text",
        "file": {"filePath": "/tmp/gigante.log", "content": "L" * 200_000},
    }
    _corta_resultados_grandes(evento, 32_000)

    assert evento["tool_use_result"]["type"] == "text"
    assert evento["tool_use_result"]["file"]["filePath"] == "/tmp/gigante.log"
