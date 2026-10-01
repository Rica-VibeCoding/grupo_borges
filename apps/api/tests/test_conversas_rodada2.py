# ruff: noqa: F811 — `bancada` vem importada da F2 e entra como parâmetro
"""F14 de `docs/conversas/PLANO.md` — leitura, concluída, renomear e `anterior`.

Mesma bancada da F2. A lixeira é trocada por uma função Python que move o
arquivo: o `gio` não importa aqui, só o que a exclusão faz com a `anterior`.
"""
from __future__ import annotations

import asyncio
import json
import shutil
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from test_conversas_lista import (  # noqa: F401 — `bancada` é fixture
    FIXTURES,
    ID_CLEAR,
    ID_CUSTOM,
    ID_PROMPT,
    _get,
    _meta,
    _por_id,
    bancada,
)
from test_conversas_nova import palco  # noqa: F401 — fixture
from test_conversas_retomar import linha  # noqa: F401 — fixture

from db.store import GrupoBorgesDB
from routers import conversas as conversas_router
from services import conversas as conversas_service

ID_GRANDE = "77777777-7777-4777-8777-777777777777"


def _linha(payload: dict) -> str:
    # Compacto, como o CC grava: o filtro por bytes conta com `"type":"user"`.
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


def _fala(texto: str, **extra) -> str:
    return _linha({"type": "user", "message": {"role": "user", "content": texto},
                   "timestamp": "2026-10-01T12:00:00.000Z", **extra})


def _resposta(msg_id: str, *blocos: dict) -> str:
    return _linha({"type": "assistant", "timestamp": "2026-10-01T12:00:01.000Z",
                   "message": {"id": msg_id, "role": "assistant", "content": list(blocos)}})


def _texto(t: str) -> dict:
    return {"type": "text", "text": t}


def _leitura(bancada, session_id: str, **params):
    with TestClient(bancada.app) as client:
        return client.get(f"/api/agents/pavan/conversas/{session_id}/leitura", params=params)


def _post(bancada, session_id: str, acao: str, corpo: dict):
    with TestClient(bancada.app) as client:
        return client.post(f"/api/agents/pavan/conversas/{session_id}/{acao}", json=corpo)


# ---------- leitura ----------


def test_leitura_traz_fala_e_texto_sem_ferramenta_nem_pensamento(bancada) -> None:
    caminho = bancada.pasta / f"{ID_PROMPT}.jsonl"
    with caminho.open("a", encoding="utf-8") as arquivo:
        arquivo.write(_fala("Roda os testes <system-reminder>lembrete</system-reminder>"))
        arquivo.write(_resposta("msg_a", {"type": "thinking", "thinking": "pensando"}))
        arquivo.write(_resposta("msg_a", _texto("Vou rodar.")))
        arquivo.write(_resposta("msg_a", {"type": "tool_use", "id": "t1", "name": "Bash",
                                          "input": {"command": "pytest"}}))
        arquivo.write(_linha({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": "905 passed"}]}}))
        arquivo.write(_resposta("msg_b", _texto("Passou tudo.")))
        arquivo.write(_resposta("msg_b", _texto("Faltou o ruff.")))
    _meta(bancada, ID_PROMPT, nota="falta o ruff", estrela=1)

    resposta = _leitura(bancada, ID_PROMPT)
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()
    assert [(m["papel"], m["texto"]) for m in corpo["mensagens"][-3:]] == [
        ("rica", "Roda os testes"),
        ("agente", "Vou rodar."),
        ("agente", "Passou tudo.\n\nFaltou o ruff."),
    ]
    quando = datetime(2026, 10, 1, 12, 0, 1, tzinfo=UTC)
    assert corpo["mensagens"][-1]["em"] == int(quando.timestamp() * 1000)
    assert corpo["nota"] == "falta o ruff"
    assert corpo["estrela"] is True and corpo["concluida"] is False
    assert corpo["titulo_origem"] == "prompt" and corpo["turnos"] >= 1
    assert corpo["mais_antigas"] is False


def test_leitura_nao_toca_no_tmux(bancada, monkeypatch) -> None:
    for nome in ("send_message", "boot_agent", "shutdown_agent", "interrupt"):
        monkeypatch.setattr(
            conversas_router.tmux_driver, nome, AsyncMock(side_effect=AssertionError(nome))
        )
    assert _leitura(bancada, ID_CUSTOM).status_code == 200


def test_leitura_de_conversa_nascida_de_clear_tira_o_residuo(bancada) -> None:
    caminho = bancada.pasta / f"{ID_CLEAR}.jsonl"
    with caminho.open("a", encoding="utf-8") as arquivo:
        arquivo.write(_fala(
            "<system-reminder>The user named this session José Pavan.</system-reminder>",
            isMeta=True,
        ))
        arquivo.write(_fala("Agora o feed"))
        arquivo.write(_resposta("msg_c", _texto("Feito.")))
    mensagens = _leitura(bancada, ID_CLEAR).json()["mensagens"]
    assert [(m["papel"], m["texto"]) for m in mensagens] == [
        ("rica", "Agora o feed"), ("agente", "Feito."),
    ]


def test_leitura_de_conversa_grande_le_so_o_fim(bancada, monkeypatch) -> None:
    caminho = bancada.pasta / f"{ID_GRANDE}.jsonl"
    shutil.copyfile(FIXTURES / "titulo-custom.jsonl", caminho)
    lixo = _linha({"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "x", "content": "x" * 200_000}]}})
    with caminho.open("a", encoding="utf-8") as arquivo:
        for _ in range(60):  # ~12 MB de resultado de ferramenta
            arquivo.write(lixo)
        for i in range(40):
            arquivo.write(_fala(f"pedido {i}"))
            arquivo.write(_resposta(f"msg_{i}", _texto(f"resposta {i}")))
    tamanho = caminho.stat().st_size
    assert tamanho > 10 << 20

    lidos = 0
    abrir = conversas_service._abrir_binario

    class Contador:
        def __init__(self, arquivo) -> None:
            self.arquivo = arquivo

        def __enter__(self):
            return self

        def __exit__(self, *exc) -> None:
            self.arquivo.close()

        def seek(self, posicao: int) -> None:
            self.arquivo.seek(posicao)

        def read(self, n: int) -> bytes:
            nonlocal lidos
            bloco = self.arquivo.read(n)
            lidos += len(bloco)
            return bloco

    monkeypatch.setattr(conversas_service, "_abrir_binario", lambda c: Contador(abrir(c)))
    st = caminho.stat()
    mensagens, mais_antigas = conversas_service.ler_fim(caminho, st, 10)
    assert [m["texto"] for m in mensagens][-2:] == ["pedido 39", "resposta 39"]
    assert len(mensagens) == 10 and mais_antigas is True
    assert lidos <= conversas_service._BLOCO_DO_FIM

    # Pedido maior que o fim: o teto de bytes segura, nunca o arquivo inteiro.
    lidos = 0
    mensagens, mais_antigas = conversas_service.ler_fim(caminho, st, 100)
    assert len(mensagens) == 80 and mais_antigas is True
    assert lidos <= conversas_service.LEITURA_MAX_BYTES + conversas_service._BLOCO_DO_FIM
    assert lidos < tamanho


def test_leitura_de_id_malicioso_ou_de_outro_e_404(bancada) -> None:
    assert _leitura(bancada, "nao-e-uuid").status_code == 404
    assert _leitura(bancada, "88888888-8888-4888-8888-888888888888").status_code == 404


# ---------- concluída ----------


def test_concluida_sai_de_todas_e_aparece_em_concluidas(bancada) -> None:
    resposta = _post(bancada, ID_CUSTOM, "concluida", {"valor": True})
    assert resposta.json() == {"id": ID_CUSTOM, "concluida": True}
    assert ID_CUSTOM not in _por_id(_get(bancada))
    concluidas = _por_id(_get(bancada, filtro="concluidas"))
    assert set(concluidas) == {ID_CUSTOM}
    assert concluidas[ID_CUSTOM]["concluida"] is True
    assert _leitura(bancada, ID_CUSTOM).json()["concluida"] is True

    _post(bancada, ID_CUSTOM, "concluida", {"valor": False})
    assert _por_id(_get(bancada))[ID_CUSTOM]["concluida"] is False
    assert _get(bancada, filtro="concluidas")["conversas"] == []


def test_concluida_com_estrela_so_aparece_em_concluidas(bancada) -> None:
    _meta(bancada, ID_CUSTOM, estrela=1, concluida=1)
    assert ID_CUSTOM not in _por_id(_get(bancada, filtro="estrela"))
    assert ID_CUSTOM in _por_id(_get(bancada, filtro="concluidas"))


def test_atual_concluida_segue_em_todas_enquanto_for_a_atual(bancada) -> None:
    bancada.atuais["pavan"] = ID_CUSTOM
    assert _post(bancada, ID_CUSTOM, "concluida", {"valor": True}).status_code == 200
    assert ID_CUSTOM in _por_id(_get(bancada))
    bancada.atuais["pavan"] = ID_PROMPT
    assert ID_CUSTOM not in _por_id(_get(bancada))


def test_concluida_de_id_malicioso_e_404(bancada) -> None:
    assert _post(bancada, "nao-e-uuid", "concluida", {"valor": True}).status_code == 404


# ---------- renomear ----------


def test_renomear_vence_a_queda_e_vazio_volta(bancada) -> None:
    _meta(bancada, ID_CUSTOM, titulo="Estacionado pelo agente")
    resposta = _post(bancada, ID_CUSTOM, "titulo", {"titulo": "  Feed\nenxuto  "})
    assert resposta.json() == {
        "id": ID_CUSTOM, "titulo": "Feed enxuto", "titulo_origem": "renomeada",
    }
    item = _por_id(_get(bancada))[ID_CUSTOM]
    assert (item["titulo"], item["titulo_origem"]) == ("Feed enxuto", "renomeada")
    assert _leitura(bancada, ID_CUSTOM).json()["titulo"] == "Feed enxuto"

    volta = _post(bancada, ID_CUSTOM, "titulo", {"titulo": "   "}).json()
    assert (volta["titulo"], volta["titulo_origem"]) == ("Estacionado pelo agente", "estacionada")
    item = _por_id(_get(bancada))[ID_CUSTOM]
    assert (item["titulo"], item["titulo_origem"]) == ("Estacionado pelo agente", "estacionada")


def test_renomeado_sobrevive_ao_estacionar(bancada) -> None:
    _post(bancada, ID_PROMPT, "titulo", {"titulo": "Nome do Rica"})
    bancada.atuais["pavan"] = ID_PROMPT
    with TestClient(bancada.app) as client:
        client.post("/api/agents/pavan/conversas/estacionar",
                    json={"titulo": "Nome do agente", "nota": "n"})
    item = _por_id(_get(bancada))[ID_PROMPT]
    assert (item["titulo"], item["titulo_origem"]) == ("Nome do Rica", "renomeada")
    assert item["nota"] == "n"


def test_renomear_sem_conversa_meta_cria_a_linha(bancada) -> None:
    assert _post(bancada, ID_PROMPT, "titulo", {"titulo": "Novo"}).status_code == 200
    with sqlite3.connect(bancada.db.db_path) as conn:
        assert conn.execute(
            "SELECT renomeada, titulo FROM conversa_meta WHERE session_id = ?", (ID_PROMPT,)
        ).fetchall() == [("Novo", None)]


# ---------- anterior ----------


def test_anterior_grava_na_troca_sobrevive_e_some_na_exclusao(bancada, monkeypatch) -> None:
    assert _get(bancada)["anterior"] is None
    asyncio_run(conversas_router._gravar_anterior(bancada.db, "pavan", ID_CUSTOM))
    bancada.atuais["pavan"] = ID_CLEAR
    assert _get(bancada)["anterior"] == ID_CUSTOM

    # Restart da API: banco reaberto do zero, mesma resposta.
    db_novo = GrupoBorgesDB(bancada.db.db_path)
    db_novo._apply_schema()
    db_novo.latest_jsonl_session_id = bancada.db.latest_jsonl_session_id
    bancada.app.state.db = db_novo
    assert _get(bancada)["anterior"] == ID_CUSTOM

    # Voltou para ela: não é mais "anterior".
    bancada.atuais["pavan"] = ID_CUSTOM
    assert _get(bancada)["anterior"] is None
    bancada.atuais["pavan"] = ID_CLEAR

    lixeira = bancada.pasta.parent / "lixeira"
    lixeira.mkdir()

    def mover(pasta: Path, session_id: str, caminho: Path) -> dict:
        shutil.move(str(caminho), str(lixeira / caminho.name))
        return {"id": session_id, "pasta_irma": "ausente"}

    monkeypatch.setattr(conversas_service, "mandar_para_lixeira", mover)
    with TestClient(bancada.app) as client:
        assert client.delete(f"/api/agents/pavan/conversas/{ID_CUSTOM}").status_code == 200
    assert _get(bancada)["anterior"] is None
    with sqlite3.connect(bancada.db.db_path) as conn:
        assert conn.execute("SELECT * FROM conversa_anterior").fetchall() == []


def test_anterior_some_quando_o_arquivo_saiu_por_fora(bancada) -> None:
    asyncio_run(conversas_router._gravar_anterior(bancada.db, "pavan", ID_PROMPT))
    (bancada.pasta / f"{ID_PROMPT}.jsonl").unlink()
    assert _get(bancada)["anterior"] is None


async def test_nova_grava_a_anterior(palco) -> None:
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 200, r.text
    corpo = (await palco.cliente.get("/api/agents/pavan/conversas")).json()
    assert corpo["anterior"] == ID_CUSTOM


async def test_retomar_grava_a_anterior(linha) -> None:
    r = await linha.cliente.post(f"/api/agents/pavan/conversas/{ID_PROMPT}/retomar", json={})
    assert r.status_code == 200, r.text
    corpo = (await linha.cliente.get("/api/agents/pavan/conversas")).json()
    assert corpo["anterior"] == ID_CUSTOM


def asyncio_run(coro):
    return asyncio.run(coro)
