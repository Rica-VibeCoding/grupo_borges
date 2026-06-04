"""DS-2 / SubB — TDD pytest pro endpoint `POST /api/agents/{slug}/input`.

Stubs cobrem 404 + validações Pydantic (422). Testes `xfail` marcam comportamento
que depende da impl real (`tmux_driver.send_message`, 409 pane offline).
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import agents as agents_router


DANIEL = {
    "slug": "daniel",
    "name": "Daniel Singh",
    "role": "reviewer",
    "emoji": "DS",
    "tmux_session": "daniel",
    "workspace_path": "/tmp/daniel",
    "cli_default": "claude_code",
    "model_default": "opus",
    "capabilities": [],
    "can_review": [],
}


TARA = {
    "slug": "tara",
    "name": "Tara Kaur",
    "role": "codex",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "codex",
    "model_default": "codex-gpt-5-5",
    "capabilities": [],
    "can_review": [],
}


def _build_app(tmp_path: Path, *, codex_for_tara: bool = False) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL, TARA])
    if codex_for_tara:
        db._update_agent_codex_state(
            "tara",
            executor_kind="codex",
            status_line="ocioso",
        )
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL, TARA]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


def test_input_validates_max_length(tmp_path: Path) -> None:
    """`text` > 8192 chars → 422 (Pydantic, antes da impl real)."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/input",
            json={"text": "x" * 8193, "idempotency_key": "k1"},
        )
        assert response.status_code == 422


def test_input_rejects_empty_text(tmp_path: Path) -> None:
    """`text` vazio (min_length=1) → 422 já no stub."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/input",
            json={"text": "", "idempotency_key": "k1"},
        )
        assert response.status_code == 422


def test_input_requires_idempotency_key(tmp_path: Path) -> None:
    """Falta `idempotency_key` → 422 (Pydantic obriga o campo)."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/input",
            json={"text": "oi"},
        )
        assert response.status_code == 422


def test_input_codex_with_thread_spawns_resume_wrapper(tmp_path: Path) -> None:
    """Tara Codex retoma a thread atual e retorna imediatamente."""
    app = _build_app(tmp_path, codex_for_tara=True)
    thread = SimpleNamespace(thread_id="019e9077-ccf1-7ee1-b8bb-25202f1ed3e2")
    with patch("routers.agents.codex_reader.find_latest_thread", return_value=thread) as find_thread, \
         patch("routers.agents.subprocess.Popen") as popen, \
         patch("routers.agents.tmux_driver.send_message") as send_message:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/input",
                json={"text": "oi Tara", "idempotency_key": "k1"},
            )

    assert response.status_code == 200
    assert response.json()["tmux_delivered"] is True
    find_thread.assert_called_once_with("/tmp/tara")
    send_message.assert_not_called()
    popen.assert_called_once()
    cmd = popen.call_args.args[0]
    # Invocado via `bash <script>` — robusto a perda do bit +x em edição/linter.
    assert cmd[:4] == [
        "bash",
        str(Path(__file__).resolve().parents[3] / "scripts" / "tara-codex"),
        "--delegator",
        "cockpit",
    ]
    assert "--resume-thread" in cmd
    assert "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2" in cmd
    assert cmd[-4:] == ["-C", "/tmp/tara", "--", "oi Tara"]


def test_input_codex_turn_in_flight_returns_409(tmp_path: Path) -> None:
    """Tara trabalhando não aceita outro turno concorrente."""
    app = _build_app(tmp_path, codex_for_tara=True)
    app.state.db._update_agent_lifecycle(
        "tara", status="trabalhando", detail="turno iniciado", event="test.setup"
    )
    with patch("routers.agents.codex_reader.find_latest_thread") as find_thread, \
         patch("routers.agents.subprocess.Popen") as popen:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/input",
                json={"text": "oi Tara", "idempotency_key": "k1"},
            )

    assert response.status_code == 409
    assert response.json()["detail"] == "codex_turn_in_flight"
    find_thread.assert_not_called()
    popen.assert_not_called()


def test_input_claude_still_uses_tmux_not_codex(tmp_path: Path) -> None:
    """Agente Claude Code preserva caminho tmux original."""
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message", return_value=True) as send_message, \
         patch("routers.agents.subprocess.Popen") as popen:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi Daniel", "idempotency_key": "k1"},
            )

    assert response.status_code == 200
    send_message.assert_called_once_with("daniel", "oi Daniel")
    popen.assert_not_called()


@pytest.mark.xfail(strict=False, reason="stub retorna 501; impl real retorna 409 quando pane offline")
def test_input_returns_409_when_pane_offline(tmp_path: Path) -> None:
    """Quando `tmux_driver.send_message` retorna False (pane fora do CLI esperado),
    endpoint deve devolver 409 — não 200/500.
    """
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message", return_value=False):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi", "idempotency_key": "k1"},
            )
            assert response.status_code == 409


@pytest.mark.xfail(strict=False, reason="stub retorna 501; impl real retorna 200 + tmux_delivered=True")
def test_input_returns_tmux_delivered_true(tmp_path: Path) -> None:
    """Caminho feliz: send_message=True → 200 + `tmux_delivered: True` + `sent_at` int."""
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message", return_value=True):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi", "idempotency_key": "k1"},
            )
            assert response.status_code == 200
            body = response.json()
            assert body["tmux_delivered"] is True
            assert isinstance(body["sent_at"], int)
