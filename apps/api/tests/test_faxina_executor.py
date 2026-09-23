from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import faxina

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "faxina_executor.py"
spec = importlib.util.spec_from_file_location("faxina_executor", SCRIPT)
executor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(executor)


@pytest.fixture
def env(tmp_path):
    repo = tmp_path / "ze_claude"
    repo.mkdir()
    executor.git(repo, "init", "-b", "main")
    executor.git(repo, "config", "user.name", "Teste Faxina")
    executor.git(repo, "config", "user.email", "faxina@example.invalid")
    executor.git(repo, "config", "core.hooksPath", str(tmp_path / "hooks"))
    (repo / "tara/docs").mkdir(parents=True)
    (repo / "tara/docs/antigo.md").write_text("Documento preservado\n")
    (repo / "README.md").write_text("Índice vazio\n")
    (repo / "outra.txt").write_text("Original\n")
    executor.git(repo, "add", "--", "tara/docs/antigo.md", "README.md", "outra.txt")
    executor.git(repo, "commit", "-m", "inicial", "--", "tara/docs/antigo.md", "README.md", "outra.txt")
    db = GrupoBorgesDB(str(tmp_path / "test.db"))
    asyncio.run(db.startup())
    item = asyncio.run(db.create_faxina_item(
        caminho="tara/docs/antigo.md", workspace="tara", tipo="doc",
        ultima_leitura=int(time.time()) - 25 * 86400,
    ))
    return repo, db, item


def archive(env):
    repo, db, item = env
    asyncio.run(db.decide_faxina(item["id"], "arquivar"))
    results = executor.run_once(db.db_path, repo)
    assert len(results) == 1
    return results[0]


def test_ciclo_http_arquivar_desfazer(env, monkeypatch):
    repo, db, item = env
    monkeypatch.setattr(faxina, "ZE_CLAUDE_ROOT", repo)
    app = FastAPI()
    app.state.db = db
    app.include_router(faxina.router, prefix="/api/faxina")
    url = f"/api/faxina/{item['id']}"
    with TestClient(app) as client:
        requested = client.post(url + "/arquivar")
        assert requested.status_code == 200
        assert requested.json()["status"] == "arquivar_pedido"
        archived = executor.run_once(db.db_path, repo)[0]
        assert archived["status"] == "arquivado"
        assert client.get(url + "/conteudo").json()["texto"] == "Documento preservado\n"
        requested = client.post(url + "/desfazer")
        assert requested.status_code == 200
        assert requested.json()["status"] == "desfazer_pedido"
        restored = executor.run_once(db.db_path, repo)[0]
        assert restored["status"] == "mantido"
        assert client.get(url + "/conteudo").json()["caminho"] == item["caminho"]
        assert executor.git(repo, "status", "--porcelain") == ""
    print(json.dumps({"repo_temporario": str(repo), "arquivar": {
        "status": archived["status"], "commit_sha": archived["commit_sha"],
        "arquivado_para": archived["arquivado_para"],
    }, "desfazer": {"status": restored["status"], "commit_sha": restored["commit_sha"]}}, ensure_ascii=False))


def test_arquivar_desfazer_preserva_indice_alheio(env):
    repo, db, item = env
    (repo / "outra.txt").write_text("Alteração de outra sessão\n")
    executor.git(repo, "add", "--", "outra.txt")
    (repo / "README.md").write_text("Mudança não preparada\n")
    archived = archive(env)
    assert archived["status"] == "arquivado", archived
    assert archived["arquivado_para"] == "tara/arquivo/docs/antigo.md"
    assert (repo / archived["arquivado_para"]).read_text() == "Documento preservado\n"
    assert not (repo / item["caminho"]).exists()
    assert executor.git(repo, "show", "HEAD:outra.txt") == "Original"
    assert executor.git(repo, "diff", "--cached", "--name-only") == "outra.txt"
    assert executor.git(repo, "diff", "--name-only") == "README.md"
    assert executor.git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").splitlines() == [
        "tara/arquivo/docs/antigo.md", "tara/docs/antigo.md",
    ]
    assert archived["commit_sha"] == executor.git(repo, "rev-parse", "HEAD")
    assert executor.run_once(db.db_path, repo) == []
    asyncio.run(db.decide_faxina(item["id"], "desfazer"))
    restored = executor.run_once(db.db_path, repo)[0]
    assert restored["status"] == "mantido"
    assert restored["commit_sha"] != archived["commit_sha"]
    assert restored["dias_parado"] == 0
    assert (repo / item["caminho"]).read_text() == "Documento preservado\n"
    assert not (repo / archived["arquivado_para"]).exists()
    assert executor.git(repo, "diff", "--cached", "--name-only") == "outra.txt"
    print(json.dumps({"arquivar": archived, "desfazer": restored}, ensure_ascii=False))


@pytest.mark.parametrize("index,reference", [
    ("README.md", "tara/docs/antigo.md"),
    ("tara/CLAUDE.md", "@docs/antigo.md"),
    ("tara/docs/MEMORY.md", "[Documento](antigo.md)"),
    ("tara/SKILL.md", "docs/antigo.md"),
])
def test_citacao_viva_impede_movimento(env, index, reference):
    repo, _, item = env
    (repo / index).write_text(reference)
    before = executor.git(repo, "rev-parse", "HEAD")
    result = archive(env)
    assert result["status"] == "erro"
    assert result["erro"] == "citado em " + index
    assert (repo / item["caminho"]).exists()
    assert executor.git(repo, "rev-parse", "HEAD") == before


def test_indice_link_simbolico_interno_e_consultado(env):
    repo, _, _ = env
    (repo / "tara/AGENTS.md").write_text("[Documento](docs/antigo.md)")
    (repo / "tara/CLAUDE.md").symlink_to("AGENTS.md")
    result = archive(env)
    assert result["status"] == "erro"
    assert result["erro"] == "citado em tara/CLAUDE.md"


def test_indice_link_simbolico_sem_citacao_nao_bloqueia(env):
    repo, _, _ = env
    (repo / "tara/AGENTS.md").write_text("Instruções gerais")
    (repo / "tara/CLAUDE.md").symlink_to("AGENTS.md")
    assert archive(env)["status"] == "arquivado"


def test_citacao_gravada_impede_movimento(env):
    _, db, item = env
    with db._connect() as conn, conn:
        conn.execute("UPDATE faxina_item SET citado_em = ? WHERE id = ?",
                     (json.dumps(["tara/README.md"]), item["id"]))
    assert archive(env)["erro"] == "citado em tara/README.md"


@pytest.mark.parametrize("staged", [False, True])
def test_origem_alterada_nao_entra_no_commit(env, staged):
    repo, _, item = env
    (repo / item["caminho"]).write_text("Edição em andamento")
    if staged:
        executor.git(repo, "add", "--", item["caminho"])
    result = archive(env)
    assert result["status"] == "erro"
    assert "alterações locais" in result["erro"]
    assert (repo / item["caminho"]).read_text() == "Edição em andamento"


def test_destino_existente_nao_sobrescrito(env):
    repo, _, _ = env
    target = repo / "tara/arquivo/docs/antigo.md"
    target.parent.mkdir(parents=True)
    target.write_text("Não sobrescrever")
    assert archive(env)["status"] == "erro"
    assert target.read_text() == "Não sobrescrever"


def test_falha_commit_desfaz_movimento(env, tmp_path):
    repo, _, item = env
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    hook = hooks / "pre-commit"
    hook.write_text("#!/bin/sh\nexit 1\n")
    hook.chmod(0o755)
    result = archive(env)
    assert result["status"] == "erro"
    assert (repo / item["caminho"]).read_text() == "Documento preservado\n"
    assert executor.git(repo, "status", "--porcelain") == ""


def test_retomada_apos_commit_antes_de_gravar_banco(env, monkeypatch):
    repo, db, item = env
    original = GrupoBorgesDB.finish_faxina

    async def interrupt(*args, **kwargs):
        raise RuntimeError("queda simulada depois do commit")

    monkeypatch.setattr(GrupoBorgesDB, "finish_faxina", interrupt)
    with pytest.raises(RuntimeError, match="queda simulada"):
        archive(env)
    sha = executor.git(repo, "rev-parse", "HEAD")
    (repo / "tara/docs/outro.md").write_text("Outro documento")
    executor.git(repo, "add", "--", "tara/docs/outro.md")
    executor.git(repo, "commit", "-m", "outro documento", "--", "tara/docs/outro.md")
    newer = asyncio.run(db.create_faxina_item(
        caminho="tara/docs/outro.md", workspace="tara", tipo="doc",
        ultima_leitura=int(time.time()) - 25 * 86400,
    ))
    asyncio.run(db.decide_faxina(newer["id"], "arquivar"))
    monkeypatch.setattr(GrupoBorgesDB, "finish_faxina", original)
    results = executor.run_once(db.db_path, repo)
    assert [result["id"] for result in results] == [item["id"], newer["id"]]
    assert all(result["status"] == "arquivado" for result in results)
    assert results[0]["commit_sha"] == sha
    assert executor.git(repo, "rev-list", "--count", "HEAD") == "4"
    assert not (repo / ".git/faxina-operation.json").exists()


def test_registro_residual_apos_banco_nao_bloqueia_desfazer(env):
    repo, db, item = env
    result = archive(env)
    assert result["status"] == "arquivado"
    marker = next(line for line in executor.git(repo, "log", "-1", "--format=%B").splitlines()
                  if line.startswith("Faxina-Operacao:"))
    (repo / ".git/faxina-operation.json").write_text(json.dumps({
        "id": item["id"], "status": "arquivar_pedido", "marker": marker,
    }))
    asyncio.run(db.decide_faxina(item["id"], "desfazer"))
    assert executor.run_once(db.db_path, repo)[0]["status"] == "mantido"


def test_dois_executores_nao_duplicam_commit(env):
    repo, db, item = env
    asyncio.run(db.decide_faxina(item["id"], "arquivar"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: executor.run_once(db.db_path, repo), range(2)))
    assert sum(len(result) for result in results) == 1
    assert executor.git(repo, "rev-list", "--count", "HEAD") == "2"


def test_destino_link_simbolico_recusado(env, tmp_path):
    repo, _, item = env
    outside = tmp_path / "fora"
    outside.mkdir()
    (repo / "tara/arquivo").symlink_to(outside, target_is_directory=True)
    result = archive(env)
    assert result["status"] == "erro"
    assert "simbólico" in result["erro"]
    assert (repo / item["caminho"]).exists()
    assert list(outside.iterdir()) == []


def test_desfazer_nao_sobrescreve_novo_documento(env):
    repo, db, item = env
    archived = archive(env)
    assert archived["status"] == "arquivado"
    (repo / item["caminho"]).write_text("Novo documento")
    asyncio.run(db.decide_faxina(item["id"], "desfazer"))
    result = executor.run_once(db.db_path, repo)[0]
    assert result["status"] == "erro"
    assert (repo / item["caminho"]).read_text() == "Novo documento"
    assert (repo / archived["arquivado_para"]).exists()
