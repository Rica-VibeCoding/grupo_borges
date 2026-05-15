"""DS-2 / SubB — TDD pytest pro endpoint `POST /api/agents/{slug}/input`.

Stubs cobrem 404 + validações Pydantic (422). Testes `xfail` marcam comportamento
que depende da impl real (`tmux_driver.send_message`, 409 pane offline).
"""
from __future__ import annotations

import sys
from pathlib import Path
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


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL]}
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
