"""DS-2 / SubB — TDD pytest pro endpoint SSE `GET /api/agents/{slug}/pane/stream`.

Stubs cobrem 404 + content-type. Testes `xfail` marcam comportamento que entra
com a impl real do loop `capture_pane_excerpt` (1 Hz, dedupe por hash).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

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
    """App mínimo: monta só o router de agents + db. Sem middleware Tailscale."""
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


def test_stream_returns_sse_content_type(tmp_path: Path) -> None:
    """SSE response deve carregar Content-Type `text/event-stream`."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        # `stream=True` + curto para não pendurar no keepalive
        with client.stream("GET", "/api/agents/daniel/pane/stream") as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")


def test_stream_404_agent_not_found(tmp_path: Path) -> None:
    """Slug inexistente → 404 antes de abrir o stream."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/agents/nao-existe/pane/stream")
        assert response.status_code == 404


@pytest.mark.xfail(strict=False, reason="stub: impl real emite pane event com excerpt/captured_at/executor_kind")
def test_stream_emits_pane_event_with_expected_fields(tmp_path: Path) -> None:
    """Vermelho até Daniel implementar o loop real de capture_pane_excerpt.

    Quando real: ler 1 evento `event: pane` com payload `{excerpt, captured_at, executor_kind}`,
    todos presentes e tipados — sem flag `stub: True`.
    """
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        with client.stream("GET", "/api/agents/daniel/pane/stream") as response:
            assert response.status_code == 200
            # Lê linhas brutas até achar o primeiro event/data ou esgotar 8 linhas
            lines: list[str] = []
            for raw in response.iter_lines():
                if raw:
                    lines.append(raw)
                if len(lines) >= 8:
                    break
            # Espera evento `pane` (não stub)
            assert any("event: pane" in line for line in lines)
            data_line = next(line for line in lines if line.startswith("data:"))
            payload = json.loads(data_line.removeprefix("data:").strip())
            assert "excerpt" in payload
            assert "captured_at" in payload
            assert "executor_kind" in payload
            assert "stub" not in payload, "impl real não deve emitir flag stub"
