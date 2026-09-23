from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from db.store import GrupoBorgesDB
from routers import faxina
from services.faxina import CONTENT_LIMIT


@pytest.fixture
def env(tmp_path, monkeypatch):
    repo = tmp_path / "ze_claude"
    (repo / "tara" / "docs").mkdir(parents=True)
    (repo / "tara" / "docs" / "antigo.md").write_text("Conteúdo antigo\n")
    monkeypatch.setattr(faxina, "ZE_CLAUDE_ROOT", repo)
    db = GrupoBorgesDB(str(tmp_path / "test.db"))
    asyncio.run(db.startup())
    app = FastAPI()
    app.state.db = db
    app.include_router(faxina.router, prefix="/api/faxina")
    with TestClient(app) as client:
        yield repo, db, client


def candidate(db, **kwargs):
    defaults = {"caminho": "tara/docs/antigo.md", "workspace": "tara", "tipo": "doc",
                "ultima_leitura": int(time.time()) - 25 * 86400}
    return asyncio.run(db.create_faxina_item(**(defaults | kwargs)))


def test_listagem_resumo_e_migracao_idempotente(env):
    _, db, client = env
    assert client.get("/api/faxina").json() == {
        "itens": [], "resumo": {"pendentes": 0, "arquivados": 0, "ultima_varredura": None},
    }
    item = candidate(db, citado_em=["tara/README.md"], jev_veredito="manter", jev_motivo="referência")
    asyncio.run(db.startup())
    asyncio.run(db.record_faxina_scan(1234))
    body = client.get("/api/faxina").json()
    assert body["itens"] == [item]
    assert body["resumo"] == {"pendentes": 1, "arquivados": 0, "ultima_varredura": 1234}
    assert item["dias_parado"] == 25
    assert client.get("/api/faxina?status=arquivado").json()["itens"] == []
    assert client.get("/api/faxina?status=invalido").status_code == 422


def test_manter_reinicia_relogio_sem_inventar_leitura(env, monkeypatch):
    _, db, client = env
    now = int(time.time())
    monkeypatch.setattr("db.store.time.time", lambda: now)
    item = candidate(db)
    result = client.post(f"/api/faxina/{item['id']}/manter")
    assert result.status_code == 200
    kept = result.json()
    assert kept["status"] == "mantido"
    assert kept["decidido_em"] == now
    assert kept["dias_parado"] == 0
    assert kept["ultima_leitura"] == item["ultima_leitura"]
    assert candidate(db) is None
    monkeypatch.setattr("db.store.time.time", lambda: now + 19 * 86400)
    assert candidate(db) is None
    assert client.post(f"/api/faxina/{item['id']}/manter").json() == kept
    monkeypatch.setattr("db.store.time.time", lambda: now + 20 * 86400)
    new = candidate(db)
    assert new["id"] != item["id"]
    assert new["dias_parado"] == 20


def test_deduplicacao_concorrente(env):
    _, db, _ = env
    with ThreadPoolExecutor(max_workers=4) as pool:
        items = list(pool.map(lambda _: candidate(db), range(8)))
    assert len({item["id"] for item in items}) == 1
    assert asyncio.run(db.list_faxina())["resumo"]["pendentes"] == 1
    asyncio.run(db.decide_faxina(items[0]["id"], "arquivar"))
    assert candidate(db)["status"] == "arquivar_pedido"


def test_transicoes_e_erros_http(env):
    _, db, client = env
    item = candidate(db)
    url = f"/api/faxina/{item['id']}"
    assert client.post(url + "/desfazer").status_code == 409
    assert client.post(url + "/arquivar").json()["status"] == "arquivar_pedido"
    assert client.post(url + "/arquivar").status_code == 200
    assert client.post(url + "/manter").status_code == 409
    asyncio.run(db.finish_faxina(item["id"], "arquivar_pedido", commit_sha="a" * 40,
                               arquivado_para="tara/arquivo/docs/antigo.md"))
    assert client.get("/api/faxina?status=arquivado").json()["resumo"]["arquivados"] == 1
    assert client.post(url + "/desfazer").json()["status"] == "desfazer_pedido"
    assert client.post(url + "/desfazer").status_code == 200
    for action in ("manter", "arquivar", "desfazer"):
        assert client.post(f"/api/faxina/999/{action}").status_code == 404
    assert client.get("/api/faxina/999/conteudo").status_code == 404
    assert len(client.get("/api/faxina?status=todos").json()["itens"]) == 1


def test_conteudo_normal_arquivado_e_limite(env):
    repo, db, client = env
    item = candidate(db)
    url = f"/api/faxina/{item['id']}/conteudo"
    assert client.get(url).json() == {"caminho": item["caminho"], "texto": "Conteúdo antigo\n"}
    source = repo / item["caminho"]
    source.write_bytes(b"a" * CONTENT_LIMIT)
    assert len(client.get(url).json()["texto"]) == CONTENT_LIMIT
    source.write_bytes(b"a" * (CONTENT_LIMIT + 1))
    assert client.get(url).status_code == 413
    source.write_text("Restaurável")
    archived = "tara/arquivo/docs/antigo.md"
    (repo / archived).parent.mkdir(parents=True)
    source.rename(repo / archived)
    asyncio.run(db.decide_faxina(item["id"], "arquivar"))
    asyncio.run(db.finish_faxina(item["id"], "arquivar_pedido", commit_sha="a" * 40,
                               arquivado_para=archived))
    assert client.get(url).json() == {"caminho": archived, "texto": "Restaurável"}
    (repo / archived).unlink()
    assert client.get(url).status_code == 404


@pytest.mark.parametrize("path", ["../fora.txt", "/etc/passwd", "tara/../../fora.txt", "tara//docs/a.md", "tara/.git/config"])
def test_travessia_recusada_mesmo_com_banco_adulterado(env, path):
    _, db, client = env
    item = candidate(db)
    with db._connect() as conn, conn:
        conn.execute("UPDATE faxina_item SET caminho = ? WHERE id = ?", (path, item["id"]))
    assert client.get(f"/api/faxina/{item['id']}/conteudo").status_code == 403
    with pytest.raises(ValueError):
        candidate(db, caminho=path)


def test_link_simbolico_recusado(env, tmp_path):
    repo, db, client = env
    outside = tmp_path / "privado.txt"
    outside.write_text("não mostrar")
    target = repo / "tara/docs/antigo.md"
    target.unlink()
    target.symlink_to(outside)
    item = candidate(db)
    assert client.get(f"/api/faxina/{item['id']}/conteudo").status_code == 403


def test_probabilidade_e_migracao_do_banco_existente(env):
    _, db, client = env
    with db._connect() as conn, conn:
        conn.execute("ALTER TABLE faxina_item DROP COLUMN jev_probabilidade")
    asyncio.run(db.startup())
    item = candidate(db, jev_veredito="manter", jev_probabilidade=0.63)
    assert item["jev_probabilidade"] == 0.63
    assert client.get("/api/faxina").json()["itens"][0]["jev_probabilidade"] == 0.63
    asyncio.run(db.startup())
    assert asyncio.run(db.get_faxina_item(item["id"]))["jev_probabilidade"] == 0.63


def test_candidato_recente_ou_sem_data_nao_entra(env):
    _, db, _ = env
    assert candidate(db, ultima_leitura=int(time.time())) is None
    assert candidate(db, ultima_leitura=None, ultimo_commit=None) is None
    assert candidate(db, ultima_leitura=None, ultimo_commit=int(time.time()) - 21 * 86400)
