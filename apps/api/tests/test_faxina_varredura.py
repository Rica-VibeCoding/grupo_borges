from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from db.store import GrupoBorgesDB
import faxina_varredura as scan


@pytest.fixture
def env(tmp_path):
    repo = tmp_path / "ze_claude"
    repo.mkdir()
    scan.git(repo, "init", "-b", "main")
    scan.git(repo, "config", "user.name", "Teste Faxina")
    scan.git(repo, "config", "user.email", "faxina@example.invalid")
    scan.git(repo, "config", "core.hooksPath", str(tmp_path / "hooks"))
    files = {
        "tara/docs/antigo.md": "Pesquisa encerrada",
        "tara/docs/incluido.md": "Referência perene",
        "tara/docs/transitivo.md": "Referência transitiva",
        "tara/CLAUDE.md": "@docs/incluido.md",
        "ze-shared/planos/antigo.md": "Plano antigo",
        "ze-shared/.claude/skills/teste/SKILL.md": "---\nname: apelido\n---\nHabilidade",
        "ze-shared/.claude/skills/teste/references/apoio.md": "Apoio",
    }
    for name, content in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    (repo / "tara/docs/incluido.md").write_text("@transitivo.md")
    now = int(time.time())
    commit(repo, list(files), now - 30 * 86400)
    log = tmp_path / "leituras.jsonl"
    record(log, repo, "Read", "tara/docs/incluido.md", now - 25 * 86400)
    db = GrupoBorgesDB(str(tmp_path / "test.db"))
    asyncio.run(db.startup())
    return repo, log, db, now


def commit(repo, files, stamp):
    scan.git(repo, "add", "--", *files)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "documentos", "--", *files],
        env=os.environ | {"GIT_AUTHOR_DATE": f"@{stamp} +0000", "GIT_COMMITTER_DATE": f"@{stamp} +0000"},
        check=True, capture_output=True)


def record(log, repo, tool, target, stamp):
    with log.open("a") as source:
        source.write(json.dumps({"ts": stamp, "session_id": "teste", "cwd": str(repo),
                                 "tool": tool, "alvo": target}) + "\n")


def names(report):
    return {item["caminho"] for item in report["candidatos"]}


def test_inventario_exclui_includes_transitivos_e_grava_citacoes(env):
    repo, log, db, now = env
    (repo / "tara/README.md").write_text("[Pesquisa](docs/antigo.md)")
    report = scan.collect(repo, log, now)
    assert report["modo"] == "aplicar"
    assert names(report) == {"tara/docs/antigo.md", "ze-shared/planos/antigo.md",
                             "ze-shared/.claude/skills/teste"}
    doc = next(item for item in report["candidatos"] if item["tipo"] == "doc")
    assert doc["citado_em"] == ["tara/README.md"]
    created = asyncio.run(scan.persist(report, db))
    assert len(created) == 3
    assert asyncio.run(scan.persist(report, db)) == []
    assert asyncio.run(db.list_faxina())["resumo"]["ultima_varredura"] == now


@pytest.mark.parametrize("age", [0, 19])
def test_historico_novo_so_relatorio(env, age):
    repo, log, db, now = env
    log.unlink()
    record(log, repo, "Read", "tara/docs/incluido.md", now - age * 86400)
    report = scan.collect(repo, log, now)
    assert report["modo"] == "relatorio"
    assert report["candidatos"]
    assert asyncio.run(scan.persist(report, db)) == []
    assert asyncio.run(db.list_faxina())["resumo"]["ultima_varredura"] is None


def test_sem_jsonl_nao_grava(env):
    repo, log, db, now = env
    log.unlink()
    report = scan.collect(repo, log, now)
    assert report["modo"] == "relatorio"
    assert asyncio.run(scan.persist(report, db)) == []


@pytest.mark.parametrize("tool,target", [
    ("Read", "ze-shared/.claude/skills/teste/references/apoio.md"),
    ("Skill", "teste"), ("Skill", "apelido"), ("Skill", "plugin:teste"),
])
def test_skill_conta_qualquer_read_ou_invocacao(env, tool, target):
    repo, log, _, now = env
    record(log, repo, tool, target, now - 86400)
    assert "ze-shared/.claude/skills/teste" not in names(scan.collect(repo, log, now))


def test_leitura_ou_commit_recente_exclui(env):
    repo, log, _, now = env
    record(log, repo, "Read", "tara/docs/antigo.md", now - 86400)
    plan = "ze-shared/planos/antigo.md"
    (repo / plan).write_text("Plano atualizado")
    commit(repo, [plan], now - 86400)
    assert names(scan.collect(repo, log, now)) == {"ze-shared/.claude/skills/teste"}


def test_arquivo_alterado_e_nao_versionado_excluidos(env):
    repo, log, _, now = env
    (repo / "tara/docs/antigo.md").write_text("Edição em andamento")
    (repo / "tara/docs/novo.md").write_text("Novo documento")
    assert "tara/docs/antigo.md" not in names(scan.collect(repo, log, now))
    assert "tara/docs/novo.md" not in names(scan.collect(repo, log, now))


def test_alias_de_skill_e_resolvido_sem_duplicar(env):
    repo, log, _, now = env
    alias = repo / "tara/.claude/skills/teste"
    alias.parent.mkdir(parents=True)
    alias.symlink_to(repo / "ze-shared/.claude/skills/teste", target_is_directory=True)
    commit(repo, [str(alias.relative_to(repo))], now - 30 * 86400)
    report = scan.collect(repo, log, now)
    skills = [item for item in report["candidatos"] if item["tipo"] == "skill"]
    assert len(skills) == 1
    assert "tara/.claude/skills/teste" in skills[0]["citado_em"]
    record(log, repo, "Read", str(alias / "references/apoio.md"), now)
    assert "ze-shared/.claude/skills/teste" not in names(scan.collect(repo, log, now))


def test_manter_exige_nova_janela_e_commit_tambem(env):
    repo, log, db, now = env
    report = scan.collect(repo, log, now)
    created = asyncio.run(scan.persist(report, db))
    item = next(item for item in created if item["tipo"] == "doc")
    asyncio.run(db.decide_faxina(item["id"], "manter"))
    assert asyncio.run(scan.persist(report, db)) == []
    assert asyncio.run(db.create_faxina_item(caminho="tara/docs/recente.md", workspace="tara",
        tipo="doc", ultima_leitura=now - 30 * 86400, ultimo_commit=now)) is None


def test_execucao_com_jev_e_um_aviso_so_para_novos(env, monkeypatch, capsys):
    import faxina_aviso
    import faxina_jev

    repo, log, db, _ = env
    notices, batches = [], []

    def evaluate(items, **kwargs):
        batches.append(items)
        return {}, [{"cost": 0.0001}]

    monkeypatch.setattr(faxina_jev, "evaluate", evaluate)
    monkeypatch.setattr(faxina_aviso, "notify", lambda count: notices.append(count) or 123)
    monkeypatch.setattr(sys, "argv", ["faxina_varredura.py", "--repo", str(repo),
        "--leituras", str(log), "--db", db.db_path, "--aplicar"])
    scan.main()
    report = json.loads(capsys.readouterr().out)
    assert report["novos"] == 3
    assert notices == [3]
    scan.main()
    assert json.loads(capsys.readouterr().out)["novos"] == 0
    assert notices == [3]
    assert batches[-1] == []


def test_relatorio_nao_chama_jev_nem_notificacao(env, monkeypatch, capsys):
    import faxina_jev

    repo, log, db, now = env
    log.write_text("")
    record(log, repo, "Read", "tara/docs/incluido.md", now)

    def forbidden(*args, **kwargs):
        raise AssertionError("não deve chamar API no período inicial")

    monkeypatch.setattr(faxina_jev, "evaluate", forbidden)
    monkeypatch.setattr(sys, "argv", ["faxina_varredura.py", "--repo", str(repo),
        "--leituras", str(log), "--db", db.db_path, "--aplicar"])
    scan.main()
    report = json.loads(capsys.readouterr().out)
    assert report["modo"] == "relatorio"
    assert report["novos"] == 0


def test_jsonl_malformado_e_futuro_nao_criam_historico(env):
    repo, log, _, now = env
    log.write_text('{\n{"ts":"antigo"}\n')
    record(log, repo, "Read", "tara/docs/antigo.md", now + 86400)
    report = scan.collect(repo, log, now)
    assert report["modo"] == "relatorio"
    assert report["historico_desde"] is None
