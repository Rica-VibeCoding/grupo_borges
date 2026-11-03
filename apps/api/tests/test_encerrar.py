"""O mesmo botão entrega o ritual a Claude Code e Codex, nos dois hosts."""
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from test_agent_input import _build_app

from services import tmux_driver
from services.encerrar import expandir_encerrar


@pytest.mark.parametrize("family", [None, "codex-proxy", "opencode"])
def test_botao_encerrar_entrega_corpo_sem_barra(tmp_path: Path, family: str | None) -> None:
    workspace = tmp_path / "workspace"
    command = workspace / ".claude/commands/encerrar.md"
    command.parent.mkdir(parents=True)
    command.write_text("---\ndescription: Faxina\n---\n\nSessão encerrada. Salvar memória.\n")
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


def test_outro_comando_continua_literal(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message",
               return_value=tmux_driver.DELIVERED) as send:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/input",
                                   json={"text": "/compact", "idempotency_key": "compact"})
    assert response.status_code == 200
    send.assert_awaited_once_with("daniel", "/compact")


def test_notebook_sem_comando_local_usa_montagem_sshfs(tmp_path: Path) -> None:
    canonical = tmp_path / "ze_claude/ze_claude/ze-shared/.claude/commands/encerrar.md"
    canonical.parent.mkdir(parents=True)
    canonical.write_text("Sessão encerrada. Ritual canônico.")
    with patch("services.encerrar.Path.home", return_value=tmp_path):
        text = expandir_encerrar("/encerrar", str(tmp_path / "Projetos/Omarchy"))
    assert "Ritual canônico." in text
    assert str(canonical) in text


def test_encerrar_ausente_recusa_sem_entregar_barra(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with patch("routers.agents.expandir_encerrar", side_effect=FileNotFoundError), patch(
        "routers.agents.tmux_driver.send_message"
    ) as send:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/input",
                                   json={"text": "/encerrar", "idempotency_key": "ausente"})
    assert response.status_code == 409
    send.assert_not_called()
