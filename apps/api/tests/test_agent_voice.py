"""DS-54 — TDD pytest pro endpoint `POST /api/agents/{slug}/voice`.

Cobre 404 (slug inexistente), 422 (mime/size), 200 (caminho feliz com mocks
de subprocess.run + tmux send_message) e 502 (STT exit≠0). Patches no módulo
`routers.agents` (não no `subprocess` global) pra mexer só nas chamadas
importadas pelo router.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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


def _fake_completed(stdout: str = "", stderr: str = "", returncode: int = 0):
    return subprocess.CompletedProcess(
        args=["stt"], returncode=returncode, stdout=stdout, stderr=stderr
    )


def test_voice_404_agent_not_found(tmp_path: Path) -> None:
    """Slug inexistente → 404 antes de tocar no STT."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/ghost/voice",
            files={"audio": ("voice.webm", b"abc", "audio/webm")},
        )
        assert response.status_code == 404


def test_voice_validates_mime(tmp_path: Path) -> None:
    """Mime fora do whitelist (text/plain) → 422."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/voice",
            files={"audio": ("voice.txt", b"oi", "text/plain")},
        )
        assert response.status_code == 422
        assert "mime" in response.json()["detail"].lower()


def test_voice_validates_size(tmp_path: Path) -> None:
    """Áudio > 10MB → 422 antes do STT."""
    app = _build_app(tmp_path)
    big = b"x" * (10 * 1024 * 1024 + 1)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/voice",
            files={"audio": ("voice.webm", big, "audio/webm")},
        )
        assert response.status_code == 422
        assert "10MB" in response.json()["detail"]


def test_voice_returns_transcribed_and_delivered(tmp_path: Path) -> None:
    """Caminho feliz: STT devolve texto + tmux entrega → 200 com payload completo."""
    app = _build_app(tmp_path)
    event_before_stt = app.state.db._insert_task_event(
        "test.before_voice", None, "daniel", None, None, None
    )
    assert event_before_stt is not None
    fake = _fake_completed(stdout="olá mundo\n", stderr="", returncode=0)
    with patch("routers.agents.subprocess.run", return_value=fake), patch(
        "routers.agents.tmux_driver.send_message", return_value=True
    ) as mock_send:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/voice",
                files={"audio": ("voice.webm", b"fakebytes", "audio/webm")},
            )
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["transcribed"] == "olá mundo"
            assert body["tmux_delivered"] is True
            assert isinstance(body["duration_ms"], int)
            assert body["event_boundary_id"] == event_before_stt
            mock_send.assert_awaited_once()
            args, _ = mock_send.call_args
            assert args[0] == "daniel"
            assert args[1] == "🎙 olá mundo"


def test_voice_reads_event_boundary_before_stt(tmp_path: Path) -> None:
    """Evento inserido durante o STT fica acima da fronteira devolvida."""
    app = _build_app(tmp_path)
    db = app.state.db
    event_during_stt: list[int] = []

    def stt_with_concurrent_event(*_args, **_kwargs):
        event_id = db._insert_task_event(
            "test.during_stt", None, "daniel", None, None, None
        )
        assert event_id is not None
        event_during_stt.append(event_id)
        return _fake_completed(stdout="áudio confirmado\n")

    with patch(
        "routers.agents.subprocess.run", side_effect=stt_with_concurrent_event
    ), patch("routers.agents.tmux_driver.send_message", return_value=True):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/voice",
                files={"audio": ("voice.webm", b"fakebytes", "audio/webm")},
            )

    assert response.status_code == 200, response.text
    assert event_during_stt
    assert response.json()["event_boundary_id"] < event_during_stt[0]


def test_voice_handles_stt_failure_502(tmp_path: Path) -> None:
    """STT exit≠0 → 502 com motivo da última linha do stderr."""
    app = _build_app(tmp_path)
    fake = _fake_completed(stdout="", stderr="key inválida\n", returncode=1)
    with patch("routers.agents.subprocess.run", return_value=fake):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/voice",
                files={"audio": ("voice.webm", b"x", "audio/webm")},
            )
            assert response.status_code == 502
            assert "stt_failed" in response.json()["detail"]
            assert "key inválida" in response.json()["detail"]
