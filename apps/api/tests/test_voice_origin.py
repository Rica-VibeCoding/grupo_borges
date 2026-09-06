"""Contrato de proveniência explícita de entrada de voz."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import MESSAGE_ORIGIN_MATCH_WINDOW_MS, GrupoBorgesDB
from orchestrator.jsonl_watcher import JsonlWatcher, encoded_cwd
from routers import agents as agents_router


TARA = {
    "slug": "tara",
    "name": "Tara Kaur",
    "role": "executor",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "claude_code",
    "model_default": "gpt-5.6-sol[1m]",
    "model_family": "codex-proxy",
    "capabilities": [],
    "can_review": [],
}


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([TARA])
    db._update_agent_runtime_state("tara", status_line="ocioso")

    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [TARA]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


async def test_voice_tmux_persists_explicit_meta_for_canonical_event(tmp_path: Path) -> None:
    """O eco tmux recebe a origem persistida, sem reclassificar seu prefixo."""
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    tmux_agent = {**TARA, "slug": "daniel", "tmux_session": "daniel", "cli_default": "claude_code"}
    db._sync_agents([tmux_agent])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [tmux_agent]}
    app.include_router(agents_router.router, prefix="/api/agents")
    text = "🎙 abre o relatório"
    stt = SimpleNamespace(returncode=0, stdout="abre o relatório\n", stderr="")
    with patch("routers.agents._probe_audio_duration_ms", return_value=None), patch(
        "routers.agents.subprocess.run", return_value=stt
    ), patch(
        "routers.agents.tmux_driver.send_message",
        return_value=SimpleNamespace(delivered=True),
    ):
        with TestClient(app) as client:
            accepted = client.post(
                "/api/agents/daniel/voice",
                files={"audio": ("voice.webm", b"fakebytes", "audio/webm")},
            )
    assert accepted.status_code == 200, accepted.text

    projects = tmp_path / "projects"
    jsonl_path = projects / encoded_cwd(tmux_agent["workspace_path"]) / "session.jsonl"
    jsonl_path.parent.mkdir(parents=True)
    jsonl_path.write_text(
        json.dumps(
            {
                "type": "user",
                "uuid": "tmux-voice-1",
                "sessionId": "session-1",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": {"role": "user", "content": text},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    watcher = JsonlWatcher(
        claude_projects_dir=str(projects),
        agents=[tmux_agent],
        db=db,
    )
    await watcher._process_jsonl(jsonl_path)

    events = await db.list_events_after(0)
    canonical = agents_router._canonical_jsonl_message_event(events[-1])
    assert canonical is not None
    assert canonical["meta"] == {"kind": "stt", "raw_text": text}


async def test_claim_message_origin_keeps_queued_echo_for_ten_minutes(tmp_path: Path) -> None:
    """A janela cobre o eco de uma voz que Claude Code só processa após a fila."""
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([TARA])
    chosen_window_ms = 10 * 60 * 1000
    assert MESSAGE_ORIGIN_MATCH_WINDOW_MS == chosen_window_ms
    observed_at_ms = 1_800_000_000_000
    queued_at_ms = observed_at_ms - chosen_window_ms

    with patch("db.store.time.time", return_value=queued_at_ms / 1000):
        await db.create_message_origin(
            agent_slug="tara",
            executor_kind="claude_code",
            expected_text="pode subir",
            meta={"kind": "stt", "raw_text": "🎙 pode subir"},
        )

    claimed = await db.claim_message_origin(
        agent_slug="tara",
        executor_kind="claude_code",
        expected_text="pode subir",
        message_key="thread:queued-voice",
        observed_at_ms=observed_at_ms,
    )

    assert claimed == {"kind": "stt", "raw_text": "🎙 pode subir"}


async def test_claim_message_origin_prunes_old_orphan_without_claiming_it(tmp_path: Path) -> None:
    """Um eco repetido não pode ressuscitar uma origem STT órfã de dias atrás."""
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([TARA])
    observed_at_ms = 1_800_000_000_000
    orphaned_at_ms = observed_at_ms - 3 * 24 * 60 * 60 * 1000

    with patch("db.store.time.time", return_value=orphaned_at_ms / 1000):
        origin_id = await db.create_message_origin(
            agent_slug="tara",
            executor_kind="claude_code",
            expected_text="pode subir",
            meta={"kind": "stt", "raw_text": "🎙 pode subir"},
        )

    claimed = await db.claim_message_origin(
        agent_slug="tara",
        executor_kind="claude_code",
        expected_text="pode subir",
        message_key="thread:typed-message",
        observed_at_ms=observed_at_ms,
    )

    assert claimed is None
    with db._connect() as conn:
        still_pending = conn.execute(
            "SELECT id FROM message_origins WHERE id = ?", (origin_id,)
        ).fetchone()
    assert still_pending is None
