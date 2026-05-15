"""DS-2 / SubB — TDD pytest pro endpoint `POST /api/agents/{slug}/model`.

Stubs cobrem 422 (whitelist + Codex). Testes `xfail` marcam comportamento que
depende da impl real (gate `agent_busy_confirm_required`, persistência condicional,
emissão de `task_event` `agent.model_change`, detecção via regex no pane).
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
        # Marca Tara como executor codex no agent_state — necessário pro gate 422.
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


def test_model_rejects_invalid_slug(tmp_path: Path) -> None:
    """Slug fora do whitelist `opus|sonnet|haiku` → 422 (Pydantic Literal)."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/model",
            json={"model": "gpt-4"},
        )
        assert response.status_code == 422


def test_model_codex_returns_422_no_runtime_switch(tmp_path: Path) -> None:
    """`executor_kind=codex` → 422 `codex_no_runtime_model_switch` (DS-2.1 cuida)."""
    app = _build_app(tmp_path, codex_for_tara=True)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/tara/model",
            json={"model": "sonnet"},
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "codex_no_runtime_model_switch"


@pytest.mark.xfail(strict=False, reason="stub: gate `agent_busy_confirm_required` entra com impl real")
def test_model_busy_without_force_returns_409(tmp_path: Path) -> None:
    """Agente `trabalhando` sem `force=true` → 409 `agent_busy_confirm_required`."""
    app = _build_app(tmp_path)
    # Coloca daniel em status `trabalhando` — caminho exato depende de fixture do DB
    app.state.db._update_agent_lifecycle(
        "daniel", status="trabalhando", detail=None, event="test.setup"
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/model",
            json={"model": "sonnet"},
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "agent_busy_confirm_required"


@pytest.mark.xfail(strict=False, reason="stub: caminho feliz com force=true entra com impl real")
def test_model_busy_with_force_passes(tmp_path: Path) -> None:
    """Agente `trabalhando` com `force=true` → 200 (assume risco)."""
    app = _build_app(tmp_path)
    app.state.db._update_agent_lifecycle(
        "daniel", status="trabalhando", detail=None, event="test.setup"
    )
    with patch("routers.agents.tmux_driver.send_message", return_value=True), \
         patch("routers.agents.tmux_driver.capture_pane_excerpt", return_value="Sonnet 4.6 - 00:01 - [...] 1%"):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/model",
                json={"model": "sonnet", "force": True},
            )
            assert response.status_code == 200


@pytest.mark.xfail(strict=False, reason="stub: persistência só após delivered=True entra com impl real")
def test_model_persists_state_only_when_delivered(tmp_path: Path) -> None:
    """`tmux_delivered=False` → NÃO escreve `state_model` (inversão cravada no plano v2)."""
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message", return_value=False):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/model",
                json={"model": "sonnet"},
            )
            assert response.status_code == 200
            body = response.json()
            assert body["tmux_delivered"] is False
            assert body["state_persisted"] is False
    # state_model do agente continua None/default — não foi escrito
    import asyncio
    agent = asyncio.get_event_loop().run_until_complete(app.state.db.get_agent("daniel"))
    assert agent["state_model"] in (None, "opus"), "state_model não pode ter sido persistido sem delivered"


@pytest.mark.xfail(strict=False, reason="stub: task_event agent.model_change entra com impl real")
def test_model_emits_task_event_on_change(tmp_path: Path) -> None:
    """Troca confirmada deve emitir `task_event` kind=`agent.model_change` com `{from, to, actor}`."""
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message", return_value=True), \
         patch("routers.agents.tmux_driver.capture_pane_excerpt", return_value="Sonnet 4.6 - 00:01 - [...] 1%"):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/model",
                json={"model": "sonnet"},
            )
            assert response.status_code == 200
    # Busca o evento no histórico do agente
    import asyncio
    events = asyncio.get_event_loop().run_until_complete(
        app.state.db.event_counts_per_hour("daniel", since_unix=0)
    )
    # Sanity: pelo menos 1 evento foi gravado
    assert sum(events.values()) >= 1


@pytest.mark.xfail(strict=False, reason="stub: regex parser pra confirmar troca entra com impl real")
def test_model_detects_confirmation_via_pane_regex(tmp_path: Path) -> None:
    """Statusline do pane bate com slug → `confirmed=True`. Não bate → `confirmed=False`
    mas `tmux_delivered=True` (UI mostra warning).
    """
    app = _build_app(tmp_path)
    # Caso "match": statusline mostra Sonnet → confirmed True
    with patch("routers.agents.tmux_driver.send_message", return_value=True), \
         patch("routers.agents.tmux_driver.capture_pane_excerpt", return_value="Sonnet 4.6 - 00:01 - [...] 1%"):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/model",
                json={"model": "sonnet"},
            )
            assert response.status_code == 200
            assert response.json()["confirmed"] is True

    # Caso "no match": statusline ainda mostra Opus → confirmed False, delivered True
    with patch("routers.agents.tmux_driver.send_message", return_value=True), \
         patch("routers.agents.tmux_driver.capture_pane_excerpt", return_value="Opus 4.7 - 00:01 - [...] 1%"):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/model",
                json={"model": "sonnet"},
            )
            assert response.status_code == 200
            body = response.json()
            assert body["tmux_delivered"] is True
            assert body["confirmed"] is False
