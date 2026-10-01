# ruff: noqa: F811 — `bancada` vem importada da F2 e entra como parâmetro
"""F3 de `docs/conversas/PLANO.md` — estrela, excluir e `bloqueada_por`.

Mesma bancada da F2. O `gio` é trocado por um script de verdade numa pasta
temporária: um que move para uma "lixeira" de teste, outro que recusa. Nada
aqui toca a lixeira real da máquina.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_conversas_lista import (  # noqa: F401 — `bancada` é fixture
    _DIA,
    DANIEL,
    ID_CLEAR,
    ID_CUSTOM,
    ID_NOME,
    ID_PROMPT,
    _get,
    _instalar,
    _meta,
    _por_id,
    bancada,
)

from orchestrator.jsonl_watcher import encoded_cwd
from services import conversas as conversas_service


def _gio_falso(tmp_path: Path, monkeypatch, corpo: str) -> Path:
    script = tmp_path / "gio-falso"
    script.write_text(f"#!/bin/sh\n{corpo}\n")
    script.chmod(0o755)
    monkeypatch.setattr(conversas_service, "_comando_gio", lambda: str(script))
    return script


@pytest.fixture
def lixeira(tmp_path: Path, monkeypatch) -> Path:
    destino = tmp_path / "lixeira"
    destino.mkdir()
    _gio_falso(tmp_path, monkeypatch, f'[ "$1" = trash ] || exit 9\nmv "$2" "{destino}/"')
    return destino


def _delete(bancada, session_id: str, slug: str = "pavan"):
    with TestClient(bancada.app) as client:
        return client.delete(f"/api/agents/{slug}/conversas/{session_id}")


def _estrela(bancada, session_id: str, valor: bool, slug: str = "pavan"):
    with TestClient(bancada.app) as client:
        return client.post(
            f"/api/agents/{slug}/conversas/{session_id}/estrela", json={"valor": valor}
        )


def _linhas_meta(bancada, session_id: str) -> list[tuple]:
    with sqlite3.connect(bancada.db.db_path) as conn:
        return conn.execute(
            "SELECT estrela, titulo FROM conversa_meta WHERE slug = 'pavan' AND session_id = ?",
            (session_id,),
        ).fetchall()


# ---------- estrela ----------


def test_estrela_grava_e_tira_sem_perder_o_titulo_estacionado(bancada) -> None:
    _meta(bancada, ID_CUSTOM, titulo="Feed enxuto")
    assert _estrela(bancada, ID_CUSTOM, True).json() == {"id": ID_CUSTOM, "estrela": True}
    assert _linhas_meta(bancada, ID_CUSTOM) == [(1, "Feed enxuto")]
    assert _por_id(_get(bancada))[ID_CUSTOM]["estrela"] is True

    _estrela(bancada, ID_CUSTOM, False)
    assert _linhas_meta(bancada, ID_CUSTOM) == [(0, "Feed enxuto")]
    # Sem linha anterior: o upsert cria.
    _estrela(bancada, ID_PROMPT, True)
    assert _linhas_meta(bancada, ID_PROMPT) == [(1, None)]


def test_estrela_mantem_conversa_de_40_dias_na_lista(bancada) -> None:
    velha = "99999999-9999-4999-8999-999999999999"
    _instalar(bancada.pasta, "titulo-custom.jsonl", velha, idade_s=40 * _DIA)
    assert velha not in _por_id(_get(bancada))

    assert _estrela(bancada, velha, True).status_code == 200
    assert _por_id(_get(bancada))[velha]["estrela"] is True
    assert velha in _por_id(_get(bancada, filtro="estrela"))


@pytest.mark.parametrize("sid", ["../../etc/passwd", "..", "nao-e-uuid", ID_CUSTOM + ".jsonl"])
def test_estrela_com_id_malicioso_e_404(bancada, sid: str) -> None:
    assert _estrela(bancada, sid, True).status_code == 404


# ---------- excluir ----------


def test_excluir_manda_jsonl_e_pasta_irma_para_a_lixeira(bancada, lixeira) -> None:
    irma = bancada.pasta / ID_CUSTOM / "subagents"
    irma.mkdir(parents=True)
    (irma / "agent-1.jsonl").write_text("{}\n")
    _meta(bancada, ID_CUSTOM, estrela=1)

    resposta = _delete(bancada, ID_CUSTOM)
    assert resposta.status_code == 200, resposta.text
    assert resposta.json() == {"id": ID_CUSTOM, "pasta_irma": "lixeira"}
    assert not (bancada.pasta / f"{ID_CUSTOM}.jsonl").exists()
    assert not (bancada.pasta / ID_CUSTOM).exists()
    assert {p.name for p in lixeira.iterdir()} == {f"{ID_CUSTOM}.jsonl", ID_CUSTOM}
    assert _linhas_meta(bancada, ID_CUSTOM) == []
    assert ID_CUSTOM not in _por_id(_get(bancada, curtas=1))


def test_excluir_sem_pasta_irma(bancada, lixeira) -> None:
    assert _delete(bancada, ID_PROMPT).json() == {"id": ID_PROMPT, "pasta_irma": "ausente"}


@pytest.mark.parametrize("sid", ["..%2F..%2Fetc%2Fpasswd", "nao-e-uuid", "%2E%2E"])
def test_excluir_com_id_malicioso_e_404(bancada, lixeira, sid: str) -> None:
    assert _delete(bancada, sid).status_code in (404, 405)
    assert list(lixeira.iterdir()) == []


def test_localizar_recusa_fuga_da_pasta(bancada, tmp_path: Path) -> None:
    assert conversas_service.localizar(bancada.pasta, "../" + ID_CUSTOM) is None
    # Id válido, mas o arquivo é link para fora da pasta.
    fora = tmp_path / "fora.jsonl"
    fora.write_text("{}\n")
    link = "abababab-abab-4bab-8bab-abababababab"
    (bancada.pasta / f"{link}.jsonl").symlink_to(fora)
    assert conversas_service.localizar(bancada.pasta, link) is None


def test_excluir_id_de_outra_pasta_e_404(bancada, lixeira) -> None:
    pasta_daniel = bancada.pasta.parent / encoded_cwd(DANIEL["workspace_path"])
    pasta_daniel.mkdir()
    do_daniel = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd"
    _instalar(pasta_daniel, "titulo-custom.jsonl", do_daniel, idade_s=_DIA)

    assert _delete(bancada, do_daniel, slug="pavan").status_code == 404
    assert (pasta_daniel / f"{do_daniel}.jsonl").exists()


def test_excluir_conversa_atual_e_409(bancada, lixeira) -> None:
    bancada.atuais["pavan"] = ID_CUSTOM
    resposta = _delete(bancada, ID_CUSTOM)
    assert resposta.status_code == 409
    assert (bancada.pasta / f"{ID_CUSTOM}.jsonl").exists()


def test_excluir_bloqueada_e_409_com_dono_ou_sem(bancada, lixeira) -> None:
    bancada.atuais["daniel"] = ID_NOME
    resposta = _delete(bancada, ID_NOME)
    assert resposta.status_code == 409 and "daniel" in resposta.json()["detail"]

    _instalar(bancada.pasta, "titulo-custom.jsonl", ID_CUSTOM, idade_s=30)
    assert _delete(bancada, ID_CUSTOM).status_code == 409
    assert list(lixeira.iterdir()) == []


def test_gio_ausente_da_erro_legivel_sem_apagar(bancada, monkeypatch) -> None:
    monkeypatch.setattr(conversas_service, "_comando_gio", lambda: None)
    _meta(bancada, ID_CUSTOM, estrela=1)
    resposta = _delete(bancada, ID_CUSTOM)
    assert resposta.status_code == 503
    assert "nada foi apagado" in resposta.json()["detail"]
    assert (bancada.pasta / f"{ID_CUSTOM}.jsonl").exists()
    assert _linhas_meta(bancada, ID_CUSTOM) == [(1, None)]


def test_gio_que_falha_da_erro_legivel_sem_apagar(bancada, tmp_path, monkeypatch) -> None:
    _gio_falso(tmp_path, monkeypatch, 'echo "Lixeira não suportada" >&2\nexit 1')
    (bancada.pasta / ID_CUSTOM).mkdir()
    resposta = _delete(bancada, ID_CUSTOM)
    assert resposta.status_code == 500
    detalhe = resposta.json()["detail"]
    assert "Lixeira não suportada" in detalhe and "nada foi apagado" in detalhe
    assert (bancada.pasta / f"{ID_CUSTOM}.jsonl").exists()
    assert (bancada.pasta / ID_CUSTOM).is_dir()


# ---------- bloqueada_por ----------


def test_bloqueada_por_diz_a_linha_ou_null(bancada) -> None:
    bancada.atuais["daniel"] = ID_NOME
    _instalar(bancada.pasta, "titulo-custom.jsonl", ID_CUSTOM, idade_s=30)
    itens = _por_id(_get(bancada, curtas=1))

    assert (itens[ID_NOME]["bloqueada"], itens[ID_NOME]["bloqueada_por"]) == (True, "daniel")
    # Escrita recente sem dono conhecido: trava, mas sem nome.
    assert (itens[ID_CUSTOM]["bloqueada"], itens[ID_CUSTOM]["bloqueada_por"]) == (True, None)
    assert (itens[ID_CLEAR]["bloqueada"], itens[ID_CLEAR]["bloqueada_por"]) == (False, None)
