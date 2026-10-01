# ruff: noqa: F811 — `bancada` vem importada da F2 e entra como parâmetro
"""F17 — arestas da conferência da rodada 2.

A leitura sem o pedido de estacionar do cockpit (e sem o "ok" do agente a
ele), e a conversa curta deixada por uma troca que não some da lista.
"""
from __future__ import annotations

import asyncio

from test_conversas_lista import _get, _meta, _por_id, bancada  # noqa: F401 — fixture
from test_conversas_rodada2 import _fala, _leitura, _linha, _resposta, _texto

from routers import conversas as conversas_router
from services import conversas as conversas_service
from services.operacao_conversa import mensagem_de_estacionar

ID_CURTA = "88888888-8888-4888-8888-888888888888"
PEDIDO = mensagem_de_estacionar("http://127.0.0.1:8000", "pavan")


def _curl(msg_id: str) -> list[str]:
    """O agente atendendo o pedido: a chamada do `curl`, o resultado e o "ok"."""
    return [
        _resposta(msg_id, {"type": "tool_use", "id": f"t_{msg_id}", "name": "Bash",
                           "input": {"command": "curl -sS -X POST …"}}),
        _linha({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": f"t_{msg_id}", "content": "{}"}]}}),
        _resposta(f"{msg_id}_ok", _texto("ok")),
    ]


def _fala_real(texto: str) -> str:
    """Fala como o CC grava: `parentUuid` antes do `type`. O resumo trata linha
    que abre com `{"type":"` como metadado e não conta o turno."""
    return _linha({"parentUuid": None, "type": "user",
                   "message": {"role": "user", "content": texto},
                   "timestamp": "2026-10-01T12:00:00.000Z"})


def _escrever(bancada, session_id: str, linhas: list[str]) -> None:
    with (bancada.pasta / f"{session_id}.jsonl").open("a", encoding="utf-8") as arquivo:
        arquivo.writelines(linhas)


def _curta(bancada) -> None:
    """Conversa de um turno que a troca deixou: a fala, a resposta e o pedido."""
    _escrever(bancada, ID_CURTA, [
        _fala_real("Obrigado em japonês"),
        _resposta("msg_j", _texto("ありがとう")),
        _fala_real(PEDIDO),
        *_curl("msg_p"),
    ])


# ---------- leitura ----------


def test_leitura_tira_o_pedido_do_cockpit_e_o_ok_do_agente(bancada) -> None:
    _curta(bancada)
    _escrever(bancada, ID_CURTA, [
        _fala("[Request interrupted by user]"),
        _fala("E em coreano?"),
        _resposta("msg_k", _texto("감사합니다")),
    ])
    mensagens = _leitura(bancada, ID_CURTA).json()["mensagens"]
    assert [(m["papel"], m["texto"]) for m in mensagens] == [
        ("rica", "Obrigado em japonês"),
        ("agente", "ありがとう"),
        ("rica", "E em coreano?"),
        ("agente", "감사합니다"),
    ]


def test_leitura_com_limite_no_meio_do_pedido_nao_deixa_o_ok(bancada) -> None:
    _curta(bancada)
    st = (bancada.pasta / f"{ID_CURTA}.jsonl").stat()
    mensagens, mais_antigas = conversas_service.ler_fim(
        bancada.pasta / f"{ID_CURTA}.jsonl", st, 1
    )
    assert [(m["papel"], m["texto"]) for m in mensagens] == [("agente", "ありがとう")]
    assert mais_antigas is True


def test_pedido_do_cockpit_nao_conta_como_turno(bancada) -> None:
    _curta(bancada)
    _meta(bancada, ID_CURTA, estrela=1)
    assert _por_id(_get(bancada))[ID_CURTA]["turnos"] == 1


# ---------- curta guardada ----------


def test_curta_sem_marca_do_cockpit_segue_escondida(bancada) -> None:
    _escrever(bancada, ID_CURTA, [_fala_real("Oi"), _resposta("msg_o", _texto("Oi!"))])
    assert ID_CURTA not in _por_id(_get(bancada))
    assert ID_CURTA in _por_id(_get(bancada, curtas=1))


def test_curta_estacionada_aparece_na_lista(bancada) -> None:
    _curta(bancada)
    _meta(bancada, ID_CURTA, titulo="Obrigado em japonês", nota="pronto")
    assert ID_CURTA in _por_id(_get(bancada))


def test_curta_renomeada_aparece_na_lista(bancada) -> None:
    _curta(bancada)
    _meta(bancada, ID_CURTA, renomeada="Japonês")
    assert ID_CURTA in _por_id(_get(bancada))


def test_curta_que_e_a_anterior_aparece_na_lista(bancada) -> None:
    _curta(bancada)
    asyncio.run(conversas_router._gravar_anterior(bancada.db, "pavan", ID_CURTA))
    assert ID_CURTA in _por_id(_get(bancada))


def test_curta_com_meta_vazia_segue_escondida(bancada) -> None:
    """Linha na `conversa_meta` sem marca nenhuma (⭐ desligada) não guarda."""
    _curta(bancada)
    _meta(bancada, ID_CURTA, estrela=0)
    assert ID_CURTA not in _por_id(_get(bancada))
