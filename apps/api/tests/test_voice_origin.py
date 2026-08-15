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
from services import codex_reader


@pytest.fixture(autouse=True)
def _telecodex_control_fora(monkeypatch):
    monkeypatch.setattr(
        agents_router.telecodex_client,
        "send_prompt",
        AsyncMock(return_value={"contextKey": "7262275215", "threadId": "thread-test"}),
    )

TARA = {
    "slug": "tara",
    "name": "Tara Kaur",
    "role": "codex",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "codex",
    "model_default": "codex-gpt-5-6-sol",
    "capabilities": [],
    "can_review": [],
}


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([TARA])
    db._update_agent_codex_state("tara", executor_kind="codex", status_line="ocioso")

    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [TARA]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


def test_voice_codex_produces_canonical_stt_meta(tmp_path: Path) -> None:
    """A transcrição da rota /voice chega ao feed Codex como STT explícito.

    A proveniência continua nascendo no POST — nunca de prefixo INTERPRETADO no
    texto. É o que `test_typed_microphone_prefix_does_not_create_codex_stt_meta`
    guarda: `🎙` digitado não vira voz, porque `/input` não cria origem nenhuma.

    O que mudou em 14/08 é o outro lado: o rollout deixou de guardar o texto cru
    e passa a guardar o texto MARCADO, porque é ele que a Tara lê. Sem isso ela
    não distinguia fala de teclado. Como o `expected_text` é casado contra o
    texto saneado do rollout, os dois lados carregam a marca — marcar um só
    quebraria o vínculo da origem.
    """
    app = _build_app(tmp_path)
    transcript = "abre o relatório"
    thread = SimpleNamespace(
        thread_id="thread-voice",
        rollout_path="/tmp/thread-voice.jsonl",
        cwd="/tmp/tara",
        title="voz",
        model="gpt-5.6-sol",
        reasoning_effort=None,
        tokens_used=0,
        updated_at_ms=None,
        created_at_ms=None,
    )
    rollout_message = codex_reader.CodexMessage(
        id="thread-voice:17",
        role="user",
        text=f"🎙 {transcript}",
        timestamp=(datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat(),
        item_type="message",
        visible=True,
        parts=[{"type": "text", "text": f"🎙 {transcript}"}],
    )
    stt = SimpleNamespace(returncode=0, stdout=f"{transcript}\n", stderr="")

    try:
        with patch("routers.agents._probe_audio_duration_ms", return_value=None), \
             patch("routers.agents.subprocess.run", return_value=stt), \
             patch(
                 "routers.agents.codex_reader.read_cockpit_thread_id",
                 return_value=thread.thread_id,
             ), \
             patch("routers.agents.codex_reader.resolve_thread", return_value=thread), \
             patch("routers.agents.subprocess.Popen"), \
             patch(
                 "routers.agents.codex_reader.read_latest_conversation",
                 return_value=(thread, [rollout_message]),
             ):
            with TestClient(app) as client:
                accepted = client.post(
                    "/api/agents/tara/voice",
                    files={"audio": ("voice.webm", b"fakebytes", "audio/webm")},
                )
                assert accepted.status_code == 200, accepted.text

                canonical = client.get("/api/agents/tara/codex/messages")

        assert canonical.status_code == 200, canonical.text
        message = canonical.json()["messages"][0]
        assert message["meta"] == {
            "kind": "stt",
            "raw_text": f"🎙 {transcript}",
        }
        assert message["parts"] == [{"type": "text", "text": f"🎙 {transcript}"}]
    finally:
        agents_router._CODEX_RUN_PROCS.pop("tara", None)


def test_typed_microphone_prefix_does_not_create_codex_stt_meta(tmp_path: Path) -> None:
    """`🎙` digitado não é voz, e Pydantic omite o campo em vez de serializar null."""
    app = _build_app(tmp_path)
    thread = SimpleNamespace(
        thread_id="thread-typed",
        rollout_path="/tmp/thread-typed.jsonl",
        cwd="/tmp/tara",
        title="digitado",
        model=None,
        reasoning_effort=None,
        tokens_used=0,
        updated_at_ms=None,
        created_at_ms=None,
    )
    typed = codex_reader.CodexMessage(
        id="thread-typed:5",
        role="user",
        text="🎙 texto digitado",
        timestamp=datetime.now(timezone.utc).isoformat(),
        item_type="message",
        visible=True,
    )

    with patch(
        "routers.agents.codex_reader.read_cockpit_thread_id", return_value=thread.thread_id
    ), patch(
        "routers.agents.codex_reader.read_latest_conversation",
        return_value=(thread, [typed]),
    ):
        with TestClient(app) as client:
            response = client.get("/api/agents/tara/codex/messages")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["model"] is None
    assert "meta" not in body["messages"][0]


def test_codex_messages_exposes_input_image_data_url_part(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    image_url = "data:image/jpeg;base64,ZmFrZS1pbWFnZQ=="
    thread = SimpleNamespace(
        thread_id="thread-image",
        rollout_path="/tmp/thread-image.jsonl",
        cwd="/tmp/tara",
        title="foto",
        model=None,
        reasoning_effort=None,
        tokens_used=0,
        updated_at_ms=None,
        created_at_ms=None,
    )
    image_message = codex_reader.CodexMessage(
        id="thread-image:5",
        role="user",
        text="",
        timestamp=datetime.now(timezone.utc).isoformat(),
        item_type="message",
        visible=True,
        parts=[{"type": "image", "image_url": image_url}],
    )

    with patch(
        "routers.agents.codex_reader.read_cockpit_thread_id", return_value=thread.thread_id
    ), patch(
        "routers.agents.codex_reader.read_latest_conversation",
        return_value=(thread, [image_message]),
    ):
        with TestClient(app) as client:
            response = client.get("/api/agents/tara/codex/messages")

    assert response.status_code == 200, response.text
    assert response.json()["messages"] == [
        {
            "id": "thread-image:5",
            "role": "user",
            "text": "",
            "timestamp": image_message.timestamp,
            "item_type": "message",
            "visible": True,
            "parts": [{"type": "image", "image_url": image_url}],
        }
    ]


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
            executor_kind="codex",
            expected_text="pode subir",
            meta={"kind": "stt", "raw_text": "🎙 pode subir"},
        )

    claimed = await db.claim_message_origin(
        agent_slug="tara",
        executor_kind="codex",
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
            executor_kind="codex",
            expected_text="pode subir",
            meta={"kind": "stt", "raw_text": "🎙 pode subir"},
        )

    claimed = await db.claim_message_origin(
        agent_slug="tara",
        executor_kind="codex",
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
