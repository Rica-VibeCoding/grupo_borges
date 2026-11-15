"""Contrato de proveniência explícita de entrada de voz."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import MESSAGE_ORIGIN_MATCH_WINDOW_MS, GrupoBorgesDB
from orchestrator.jsonl_watcher import JsonlWatcher, encoded_cwd
from routers import agents as agents_router
from routers.stream import _event_generator


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


async def test_voice_tmux_persists_explicit_meta_for_canonical_event(tmp_path: Path) -> None:
    """O eco tmux recebe a origem persistida, sem reclassificar seu prefixo."""
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    tmux_agent = {
        **TARA,
        "slug": "daniel",
        "tmux_session": "daniel",
        "cli_default": "claude_code",
        "model_family": None,
    }
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


@pytest.mark.parametrize("backfill", [False, True])
@pytest.mark.parametrize("via", ["turno", "fila", "absorvida"])
async def test_delivery_confirmation_matches_concatenated_text_and_replays_once(
    tmp_path: Path, via: str, backfill: bool,
) -> None:
    db = GrupoBorgesDB(str(tmp_path / "delivery.db"), jsonl_backfill_current=backfill)
    db._apply_schema()
    db._sync_agents([TARA])
    for delivery_id, text in [("d1", "  café\r\ncom  leite  "), ("d2", "depois encerre")]:
        await db.create_message_origin(
            agent_slug="tara", executor_kind="tmux", expected_text=text,
            meta={"delivery_id": delivery_id},
        )
    text = "antes\n cafe\u0301  com\t leite\n\ndepois encerre\nfim"
    payload = {"sessionId": "sessao", "timestamp": datetime.now(timezone.utc).isoformat()}
    if via == "turno":
        payload.update(type="user", uuid="user-1", message={
            "role": "user", "content": [{"type": "text", "text": text}],
        })
    elif via == "fila":
        payload.update(type="attachment", uuid="attachment-1", attachment={
            "type": "queued_command", "prompt": text,
        })
    else:
        # queue-operation real não precisa ter uuid.
        payload.update(type="queue-operation", operation="remove", reason="absorbed_mid_turn", content=text)
    line = json.dumps(payload, ensure_ascii=False)
    for _ in range(2):
        watcher = JsonlWatcher(claude_projects_dir=str(tmp_path), agents=[TARA], db=db,
                               backfill_current=backfill)
        await watcher._processar_linha("tara", line)

    events = [event for event in await db.list_events_after(0) if event["kind"] == "entrega.confirmada"]
    assert len(events) == 2
    assert {event["payload"]["delivery_id"] for event in events} == {"d1", "d2"}
    for event in events:
        assert event["agent_slug"] == "tara"
        assert event["payload"] == {
            "agent_slug": "tara", "delivery_id": event["payload"]["delivery_id"], "via": via,
        }
    with db._connect() as conn:
        claimed = conn.execute("SELECT message_key FROM message_origins").fetchall()
    assert len({row["message_key"] for row in claimed}) == 2
    assert all(row["message_key"] for row in claimed)


async def test_delivery_confirmation_consumes_one_occurrence_and_preserves_message_key(tmp_path: Path) -> None:
    db = GrupoBorgesDB(str(tmp_path / "delivery.db"))
    db._apply_schema()
    db._sync_agents([TARA])
    for delivery_id in ["d1", "d2"]:
        await db.create_message_origin(
            agent_slug="tara", executor_kind="tmux", expected_text="ok", meta={"delivery_id": delivery_id},
        )
    args = dict(agent_slug="tara", executor_kind="tmux", expected_text="ok", message_key="user-1",
                observed_at_ms=int(datetime.now(timezone.utc).timestamp() * 1000))
    first = await db.claim_message_origin(**args)
    assert await db.claim_message_origin(**args) == first
    events = await db.list_events_after(0)
    assert len(events) == 1
    assert events[0]["payload"]["delivery_id"] == "d1"
    with db._connect() as conn:
        assert conn.execute("SELECT count(*) FROM message_origins WHERE message_key IS NULL").fetchone()[0] == 1


async def test_delivery_confirmation_does_not_match_unrelated_or_old_text(tmp_path: Path) -> None:
    db = GrupoBorgesDB(str(tmp_path / "delivery.db"))
    db._apply_schema()
    db._sync_agents([TARA])
    for text in ["outro texto", "   "]:
        await db.create_message_origin(
            agent_slug="tara", executor_kind="tmux", expected_text=text, meta={"delivery_id": text},
        )
    await db.claim_message_origin(
        agent_slug="tara", executor_kind="tmux", expected_text="texto observado",
        message_key="observado", observed_at_ms=int(datetime.now(timezone.utc).timestamp() * 1000),
    )
    assert not await db.list_events_after(0)


async def test_delivery_stream_replays_confirmation_created_before_http_response(tmp_path: Path) -> None:
    db = GrupoBorgesDB(str(tmp_path / "delivery.db"))
    db._apply_schema()
    db._sync_agents([TARA])
    boundary = await db.max_event_id()
    event_id = await db.insert_task_event("entrega.confirmada", agent_slug="tara", payload={
        "agent_slug": "tara", "delivery_id": "d1", "via": "turno",
    })
    disconnected = False

    async def is_disconnected():
        nonlocal disconnected
        previous, disconnected = disconnected, True
        return previous

    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(db=db, settings=SimpleNamespace(poll_interval_ms=0))),
        headers={}, query_params={"since_id": str(boundary)}, is_disconnected=is_disconnected,
    )
    events = [event async for event in _event_generator(request)]
    assert len(events) == 1
    assert events[0]["event"] == "entrega.confirmada"
    assert json.loads(events[0]["data"])["id"] == event_id


async def test_delivery_confirmation_short_text_needs_exact_match(tmp_path: Path) -> None:
    db = GrupoBorgesDB(str(tmp_path / "delivery.db"))
    db._apply_schema()
    db._sync_agents([TARA])
    await db.create_message_origin(
        agent_slug="tara", executor_kind="tmux", expected_text="ok", meta={"delivery_id": "d1"},
    )
    agora = int(datetime.now(timezone.utc).timestamp() * 1000)
    assert await db.claim_message_origin(
        agent_slug="tara", executor_kind="tmux", expected_text="ok, agora faz o deploy",
        message_key="outra", observed_at_ms=agora,
    ) is None
    assert await db.claim_message_origin(
        agent_slug="tara", executor_kind="tmux", expected_text=" ok ",
        message_key="essa", observed_at_ms=agora,
    ) == {"delivery_id": "d1"}
