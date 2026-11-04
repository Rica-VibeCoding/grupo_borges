"""O mesmo botão entrega o ritual a Claude Code e Codex, nos dois hosts."""
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from test_agent_input import _build_app

from services import tmux_driver
from services.encerrar import expandir_encerrar


@pytest.fixture(autouse=True)
def ritual_da_frota(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr("services.encerrar.Path.home", lambda: tmp_path)
    canonical = tmp_path / "repos/ze_claude/ze-shared/.claude/commands/encerrar.md"
    canonical.parent.mkdir(parents=True)
    canonical.write_text("---\ndescription: Faxina\n---\nSessão encerrada. Salvar memória.\n")
    return canonical


@pytest.mark.parametrize("family", [None, "codex-proxy", "opencode"])
def test_botao_encerrar_entrega_corpo_sem_barra(tmp_path: Path, family: str | None) -> None:
    workspace = tmp_path / "workspace"
    command = workspace / ".claude/commands/encerrar.md"
    command.parent.mkdir(parents=True)
    command.write_text("Ritual local obsoleto: não executar.")
    adendo = workspace / ".claude/encerrar-adendo.md"
    adendo.write_text("Preservar a diferença do agente.")
    agent = dict(slug="encerrar", name="Encerrar", tmux_session="encerrar",
                 workspace_path=str(workspace), cli_default="claude_code",
                 model_default="opus", model_family=family, capabilities=[], can_review=[])
    app = _build_app(tmp_path, extra_agents=[agent])
    with patch("routers.agents.tmux_driver.send_message",
               return_value=tmux_driver.DELIVERED) as send:
        with TestClient(app) as client:
            response = client.post("/api/agents/encerrar/input",
                                   json={"text": "/encerrar", "idempotency_key": "fim"})
    assert response.status_code == 200, response.text
    text = send.call_args.args[1]
    assert not text.startswith("/")
    assert "Sessão encerrada. Salvar memória." in text
    assert "description:" not in text
    assert "Preservar a diferença do agente." in text
    assert "Ritual local obsoleto" not in text
    assert text.index("Salvar memória.") < text.index("Preservar a diferença")


@pytest.mark.parametrize("declaracao", [".claude/fin/encerrar-adendo.md", "absoluto", "til"])
def test_cadastro_escolhe_adendo_em_workspace_compartilhado(tmp_path: Path, declaracao: str):
    workspace = tmp_path / "compartilhado"
    padrao = workspace / ".claude/encerrar-adendo.md"
    padrao.parent.mkdir(parents=True)
    padrao.write_text("Adendo de outro agente.")
    fin = workspace / ".claude/fin/encerrar-adendo.md"
    fin.parent.mkdir()
    fin.write_text("Só o Financeiro.")
    caminho = str(fin) if declaracao == "absoluto" else declaracao
    if declaracao == "til":
        caminho = "~/compartilhado/.claude/fin/encerrar-adendo.md"
    agente = dict(slug="fin", name="Fin", tmux_session="fin", workspace_path=str(workspace),
                  encerrar_adendo_path=caminho, cli_default="claude_code", model_default="opus",
                  capabilities=[], can_review=[])
    app = _build_app(tmp_path, extra_agents=[agente])
    with patch("routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED) as send:
        with TestClient(app) as client:
            response = client.post("/api/agents/fin/input", json={"text": "/encerrar", "idempotency_key": "fim"})
    assert response.status_code == 200, response.text
    texto = send.call_args.args[1]
    assert "Só o Financeiro." in texto
    assert "Adendo de outro agente." not in texto


@pytest.mark.parametrize("declarado", [None, ".claude/inexistente.md"])
def test_sem_adendo_entrega_so_ritual(tmp_path: Path, declarado):
    workspace = tmp_path / "workspace"
    if declarado:
        padrao = workspace / ".claude/encerrar-adendo.md"
        padrao.parent.mkdir(parents=True)
        padrao.write_text("Não usar o padrão quando há declaração.")
    texto = expandir_encerrar("/encerrar", str(workspace), declarado)
    assert "Salvar memória." in texto
    assert ("DECLARADO E NÃO ENCONTRADO" if declarado else "Adendo do agente: ausente") in texto
    assert "Não usar o padrão" not in texto


def test_adendo_declarado_ausente_avisa_sem_travar_botao(tmp_path: Path, caplog) -> None:
    workspace = tmp_path / "workspace"
    padrao = workspace / ".claude/encerrar-adendo.md"
    padrao.parent.mkdir(parents=True)
    padrao.write_text("Adendo de outro agente: não usar.")
    declarado = ".claude/inexistente.md"
    agente = dict(slug="fin", name="Fin", tmux_session="fin", workspace_path=str(workspace),
                  encerrar_adendo_path=declarado, cli_default="claude_code", model_default="opus",
                  capabilities=[], can_review=[])
    app = _build_app(tmp_path, extra_agents=[agente])
    with patch("routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED) as send:
        with TestClient(app) as client:
            response = client.post("/api/agents/fin/input", json={"text": "/encerrar", "idempotency_key": "fim"})
    assert response.status_code == 200, response.text
    texto = send.call_args.args[1]
    aviso = (f"Adendo do agente: DECLARADO E NÃO ENCONTRADO ({workspace / declarado})"
             " — avisar o Rica no relatório e seguir só o ritual.")
    assert "Salvar memória." in texto
    assert aviso in texto
    assert "Adendo de outro agente" not in texto
    assert "Adendo do agente: ausente" not in texto
    assert any(r.name == "services.encerrar" and r.levelname == "WARNING"
               and r.getMessage() == aviso for r in caplog.records)


def test_outro_comando_continua_literal(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message",
               return_value=tmux_driver.DELIVERED) as send:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/input",
                                   json={"text": "/compact", "idempotency_key": "compact"})
    assert response.status_code == 200
    send.assert_awaited_once_with("daniel", "/compact")


def test_notebook_sem_comando_local_usa_montagem_sshfs(tmp_path: Path, ritual_da_frota) -> None:
    ritual_da_frota.unlink()
    canonical = tmp_path / "ze_claude/ze_claude/ze-shared/.claude/commands/encerrar.md"
    canonical.parent.mkdir(parents=True)
    canonical.write_text("Sessão encerrada. Ritual canônico.")
    with patch("services.encerrar.Path.home", return_value=tmp_path):
        text = expandir_encerrar("/encerrar", str(tmp_path / "Projetos/Omarchy"))
    assert "Ritual canônico." in text
    assert str(canonical) in text


@pytest.mark.parametrize("ritual_vazio", [None, "---\ndescription: vazio\n---\n"])
def test_encerrar_ausente_recusa_sem_entregar_barra(tmp_path: Path, ritual_da_frota, ritual_vazio) -> None:
    if ritual_vazio is None:
        ritual_da_frota.unlink()
    else:
        ritual_da_frota.write_text(ritual_vazio)
    workspace = tmp_path / "daniel"
    local = workspace / ".claude/commands/encerrar.md"
    local.parent.mkdir(parents=True)
    local.write_text("Cópia local não substitui a frota.")
    (workspace / ".claude/encerrar-adendo.md").write_text("Adendo sem ritual não basta.")
    app = _build_app(tmp_path)
    app.state.agents_config["agents"][0] = {**app.state.agents_config["agents"][0], "workspace_path": str(workspace)}
    app.state.db._sync_agents(app.state.agents_config["agents"])
    with patch("routers.agents.tmux_driver.send_message") as send:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/input",
                                   json={"text": "/encerrar", "idempotency_key": "ausente"})
    assert response.status_code == 409
    send.assert_not_called()


def _cli(tmp_path: Path, monkeypatch, agentes: list[dict], *args: str):
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import encerrar_adendo
    cadastro = tmp_path / "agents.yaml"
    import yaml
    cadastro.write_text(yaml.safe_dump({"version": 1, "agents": agentes}))
    monkeypatch.setenv("GB_AGENTS_YAML", str(cadastro))
    monkeypatch.setattr(encerrar_adendo, "_sessao_tmux", lambda: "sessao-x")
    return encerrar_adendo.main(["encerrar_adendo.py", *args])


def test_cli_terminal_usa_a_mesma_regra_do_cockpit(tmp_path: Path, monkeypatch, capsys) -> None:
    ws = tmp_path / "ws"
    (ws / ".claude").mkdir(parents=True)
    (ws / ".claude/encerrar-adendo.md").write_text("Só deste agente.")
    agentes = [dict(slug="a", tmux_session="a", workspace_path=str(ws)),
               dict(slug="b", tmux_session="b", workspace_path=str(ws),
                    encerrar_adendo_path=".claude/sumiu.md"),
               dict(slug="c", tmux_session="c", workspace_path=str(tmp_path / "vazio"))]
    assert _cli(tmp_path, monkeypatch, agentes, "a") == 0
    assert "Só deste agente." in capsys.readouterr().out
    assert _cli(tmp_path, monkeypatch, agentes, "b") == 2
    assert "DECLARADO E NÃO ENCONTRADO" in capsys.readouterr().out
    assert _cli(tmp_path, monkeypatch, agentes, "c") == 1
    assert "ausente" in capsys.readouterr().out
    for ordem in (("--workspace", "a"), ("a", "--workspace")):
        assert _cli(tmp_path, monkeypatch, agentes, *ordem) == 0
        assert capsys.readouterr().out.strip() == str(ws)


def test_cli_identidade_ambigua_e_erro_nao_passam_calados(tmp_path: Path, monkeypatch, capsys) -> None:
    ws = str(tmp_path)
    dois = [dict(slug="x", tmux_session="sessao-x", workspace_path=ws),
            dict(slug="sessao-x", tmux_session="y", workspace_path=ws)]
    assert _cli(tmp_path, monkeypatch, dois) == 3
    assert _cli(tmp_path, monkeypatch, dois, "nenhum") == 3
    assert "IDENTIDADE AMBÍGUA" in capsys.readouterr().err
    monkeypatch.setenv("GB_AGENTS_YAML", str(tmp_path / "nao-existe.yaml"))
    import encerrar_adendo
    assert encerrar_adendo.main(["encerrar_adendo.py", "x"]) == 4
