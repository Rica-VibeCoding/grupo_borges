"""DS-54 — TDD pytest pro endpoint `POST /api/agents/{slug}/voice`.

Cobre 404 (slug inexistente), 422 (mime/size), 200 (caminho feliz com mocks
de subprocess.run + tmux send_message) e 502 (STT exit≠0). Patches no módulo
`routers.agents` (não no `subprocess` global) pra mexer só nas chamadas
importadas pelo router.
"""
from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import GrupoBorgesDB
from routers import agents as agents_router
from services import tmux_driver


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
        "routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED
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


def test_transcription_returns_draft_without_delivery(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    fake = _fake_completed(stdout="texto para revisar\n")

    with patch("routers.agents.subprocess.run", return_value=fake), patch(
        "routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED
    ) as mock_send:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/transcription",
                files={"audio": ("voice.webm", b"fakebytes", "audio/webm")},
            )

    assert response.status_code == 200, response.text
    assert response.json()["text"] == "texto para revisar"
    assert isinstance(response.json()["duration_ms"], int)
    mock_send.assert_not_awaited()


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
    ), patch("routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED):
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
    with patch("routers.agents._probe_audio_duration_ms", return_value=250), patch(
        "routers.agents.subprocess.run", return_value=fake
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/voice",
                files={"audio": ("voice.webm", b"x", "audio/webm")},
            )
            assert response.status_code == 502
            assert "stt_failed" in response.json()["detail"]
            assert "key inválida" in response.json()["detail"]


def test_voice_logs_stt_failure_diagnostics(tmp_path: Path, caplog) -> None:
    """Falha registra stderr, exit code e metadados do áudio no logger da API."""
    app = _build_app(tmp_path)
    fake = _fake_completed(stdout="", stderr="erro detalhado\n", returncode=7)
    caplog.set_level(logging.INFO, logger="uvicorn.error")

    with patch("routers.agents._probe_audio_duration_ms", return_value=1250), patch(
        "routers.agents.subprocess.run", return_value=fake
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/voice",
                files={"audio": ("iphone.oga", b"123456", "audio/ogg")},
            )

    assert response.status_code == 502
    log_text = caplog.text
    assert "voice_stt_failed" in log_text
    assert "filename='iphone.oga'" in log_text
    assert "mime=audio/ogg" in log_text
    assert "size_bytes=6" in log_text
    assert "audio_duration_ms=1250" in log_text
    assert "stt_duration_ms=" in log_text
    assert "exit_code=7" in log_text
    assert "stderr='erro detalhado'" in log_text


def test_audio_duration_probe_is_best_effort(caplog) -> None:
    """Falha operacional ou duração inválida no ffprobe nunca bloqueia o STT."""
    caplog.set_level(logging.WARNING, logger="uvicorn.error")

    with patch("routers.agents.subprocess.run", side_effect=OSError("sem processo")):
        assert agents_router._probe_audio_duration_ms("/tmp/audio.oga") is None

    invalid = _fake_completed(stdout="inf\n", stderr="", returncode=0)
    with patch("routers.agents.subprocess.run", return_value=invalid):
        assert agents_router._probe_audio_duration_ms("/tmp/audio.oga") is None

    assert caplog.text.count("voice_audio_probe_failed") == 2


def test_audio_duration_probe_decodes_frames_when_header_has_no_duration() -> None:
    header = _fake_completed(stdout="N/A\n")
    frames = _fake_completed(
        stdout="-0.007000,0.020000\n0.014000,0.020000\n1.974000,0.016000,\n"
    )

    with patch(
        "routers.agents.subprocess.run", side_effect=[header, frames]
    ) as ffprobe:
        assert agents_router._probe_audio_duration_ms("/tmp/live.webm") == 1997

    assert ffprobe.call_count == 2
    header_call, frames_call = ffprobe.call_args_list
    assert "format=duration" in header_call.args[0]
    assert "-show_frames" in frames_call.args[0]
    assert "frame=pts_time,duration_time" in frames_call.args[0]
    assert 0 < frames_call.kwargs["timeout"] <= header_call.kwargs["timeout"] <= 5


def test_voice_log_tail_is_bounded() -> None:
    stderr = "prefixo-sensivel\n" + ("x" * (agents_router._VOICE_LOG_TAIL_CHARS + 10))

    tail = agents_router._voice_log_tail(stderr)

    assert tail.startswith("<truncated>...")
    assert "prefixo-sensivel" not in tail
    assert tail.endswith("x" * agents_router._VOICE_LOG_TAIL_CHARS)


def test_voice_logs_timeout_diagnostics(tmp_path: Path, caplog) -> None:
    app = _build_app(tmp_path)
    timeout = subprocess.TimeoutExpired(
        cmd=["stt"], timeout=30, stderr=b"tempo limite detalhado\n"
    )
    caplog.set_level(logging.INFO, logger="uvicorn.error")

    with patch("routers.agents._probe_audio_duration_ms", return_value=900), patch(
        "routers.agents.subprocess.run", side_effect=timeout
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/voice",
                files={"audio": ("timeout.oga", b"123", "audio/ogg")},
            )

    assert response.status_code == 504
    assert response.json()["detail"] == "stt_timeout"
    assert "voice_stt_timeout" in caplog.text
    assert "timeout_s=30" in caplog.text
    assert "stderr='tempo limite detalhado'" in caplog.text


def test_voice_logs_script_exec_failure(tmp_path: Path, caplog) -> None:
    app = _build_app(tmp_path)
    caplog.set_level(logging.INFO, logger="uvicorn.error")

    with patch("routers.agents._probe_audio_duration_ms", return_value=700), patch(
        "routers.agents.subprocess.run", side_effect=FileNotFoundError("script sumiu")
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/voice",
                files={"audio": ("exec.oga", b"123", "audio/ogg")},
            )

    assert response.status_code == 502
    assert response.json()["detail"].startswith("stt_script_not_found:")
    assert "voice_stt_exec_failed" in caplog.text
    assert "script sumiu" in caplog.text


def test_voice_logs_empty_transcription(tmp_path: Path, caplog) -> None:
    app = _build_app(tmp_path)
    empty = _fake_completed(stdout="\n", stderr="modelo não retornou texto\n")
    caplog.set_level(logging.INFO, logger="uvicorn.error")

    with patch("routers.agents._probe_audio_duration_ms", return_value=600), patch(
        "routers.agents.subprocess.run", return_value=empty
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/voice",
                files={"audio": ("empty.oga", b"123", "audio/ogg")},
            )

    assert response.status_code == 502
    assert response.json()["detail"] == "stt_empty"
    assert "voice_stt_empty" in caplog.text
    assert "stderr='modelo não retornou texto'" in caplog.text
