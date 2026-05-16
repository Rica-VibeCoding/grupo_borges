"""JP-11 Fase 2 — SSE `GET /api/agents/{slug}/messages/stream`."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI

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


def _build_app(tmp_path: Path) -> tuple[FastAPI, GrupoBorgesDB]:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL])

    async def get_agent(slug: str) -> dict[str, Any] | None:
        return db._get_agent(slug)

    async def latest_jsonl_session_id(agent_slug: str) -> str | None:
        return db._latest_jsonl_session_id(agent_slug)

    async def list_jsonl_message_events(
        agent_slug: str,
        *,
        session_id: str | None,
        since_id: int,
        limit: int,
    ) -> list[dict[str, Any]]:
        return db._list_jsonl_message_events(agent_slug, session_id, since_id, limit)

    db.get_agent = get_agent  # type: ignore[method-assign]
    db.latest_jsonl_session_id = latest_jsonl_session_id  # type: ignore[method-assign]
    db.list_jsonl_message_events = list_jsonl_message_events  # type: ignore[method-assign]

    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app, db


def _payload(
    *,
    kind: str = "user",
    session_id: str = "sess-a",
    uuid: str = "uuid-a",
    parent_uuid: str | None = None,
    text: str = "olá",
) -> dict[str, Any]:
    role = "assistant" if kind == "assistant" else "user"
    message: dict[str, Any] = {
        "role": role,
        "content": [{"type": "text", "text": text}],
    }
    if kind == "assistant":
        message.update(
            {
                "id": f"msg-{uuid}",
                "model": "claude-opus-4-7",
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 1, "output_tokens": 2},
            }
        )
    return {
        "type": kind,
        "uuid": uuid,
        "parentUuid": parent_uuid,
        "sessionId": session_id,
        "isSidechain": False,
        "userType": "external",
        "timestamp": "2026-05-16T03:56:24.353Z",
        "message": message,
    }


def _insert_jsonl(
    db: GrupoBorgesDB,
    *,
    kind: str = "user",
    session_id: str = "sess-a",
    uuid: str = "uuid-a",
    parent_uuid: str | None = None,
    text: str = "olá",
) -> int:
    return db._insert_task_event(
        f"jsonl:{kind}",
        None,
        "daniel",
        None,
        _payload(
            kind=kind,
            session_id=session_id,
            uuid=uuid,
            parent_uuid=parent_uuid,
            text=text,
        ),
        None,
    ) or 0


def _insert_raw_event(db: GrupoBorgesDB, *, kind: str, payload: str) -> int:
    with db._connect() as conn, conn:
        cur = conn.execute(
            """
            INSERT INTO task_events (task_id, agent_slug, instance_id, kind, payload, raw_jsonl, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (None, "daniel", None, kind, payload, None, 1778905912),
        )
        return int(cur.lastrowid)


def _parse_sse(blob: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    for block in blob.replace("\r\n", "\n").split("\n\n"):
        event_name: str | None = None
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event_name = line.removeprefix("event:").strip()
            elif line.startswith("data:"):
                data_lines.append(line.removeprefix("data:").strip())
        if event_name and data_lines:
            events.append((event_name, json.loads("\n".join(data_lines))))
    return events


async def _drive_stream(
    app: FastAPI,
    *,
    session_id: str | None = None,
    limit: int = 200,
    since_id: int = 0,
    stop_after: str,
    max_wait_s: float = 3.0,
) -> tuple[int, dict[str, str], list[tuple[str, dict[str, Any]]]]:
    disconnected = False

    async def is_disconnected() -> bool:
        return disconnected

    request = SimpleNamespace(app=app, is_disconnected=is_disconnected)
    response = await agents_router.stream_agent_messages(
        "daniel",
        request,  # type: ignore[arg-type]
        session_id=session_id,
        limit=limit,
        since_id=since_id,
    )
    body_chunks: list[bytes] = []
    direct_events: list[tuple[str, dict[str, Any]]] = []
    try:
        async def collect() -> None:
            async for chunk in response.body_iterator:
                if isinstance(chunk, dict):
                    event_name = str(chunk["event"])
                    data = json.loads(chunk["data"])
                    direct_events.append((event_name, data))
                    if event_name == stop_after:
                        break
                else:
                    body = chunk if isinstance(chunk, bytes) else chunk.encode()
                    body_chunks.append(body)
                    if f"event: {stop_after}".encode() in body:
                        break

        await asyncio.wait_for(collect(), timeout=max_wait_s)
    finally:
        disconnected = True
        await response.body_iterator.aclose()

    headers = {k.decode(): v.decode() for k, v in response.raw_headers}
    blob = b"".join(body_chunks).decode("utf-8", errors="replace")
    return response.status_code, headers, direct_events or _parse_sse(blob)


@pytest.mark.asyncio
async def test_messages_stream_replay_and_schema_are_canonical(tmp_path: Path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(
        db,
        kind="user",
        session_id="sess-a",
        uuid="uuid-1",
        parent_uuid="parent-1",
        text="primeira",
    )
    _insert_jsonl(db, kind="assistant", session_id="sess-a", uuid="uuid-2", text="segunda")

    status, headers, events = await _drive_stream(
        app,
        session_id="sess-a",
        stop_after="replay-end",
    )

    assert status == 200
    assert headers["content-type"].startswith("text/event-stream")
    assert [name for name, _ in events] == [
        "replay-start",
        "message",
        "message",
        "replay-end",
    ]
    assert events[0][1] == {"session_id": "sess-a", "total": 2}

    message = events[1][1]
    assert message["kind"] == "user"
    assert message["parent_uuid"] == "parent-1"
    assert message["session_id"] == "sess-a"
    assert message["is_sidechain"] is False
    assert message["user_type"] == "external"
    assert message["timestamp"] == "2026-05-16T03:56:24.353Z"
    assert "parentUuid" not in message
    assert "sessionId" not in message
    assert message["message"]["content"] == [{"type": "text", "text": "primeira"}]
    assert events[-1][1]["last_id"] == events[2][1]["id"]


@pytest.mark.asyncio
async def test_messages_stream_since_id_returns_only_newer_events(tmp_path: Path) -> None:
    app, db = _build_app(tmp_path)
    first_id = _insert_jsonl(db, session_id="sess-a", uuid="uuid-1")
    _insert_jsonl(db, session_id="sess-a", uuid="uuid-2")

    _, _, events = await _drive_stream(
        app,
        session_id="sess-a",
        since_id=first_id,
        stop_after="replay-end",
    )

    messages = [payload for name, payload in events if name == "message"]
    assert [m["uuid"] for m in messages] == ["uuid-2"]
    assert events[0][1]["total"] == 1


@pytest.mark.asyncio
async def test_messages_stream_since_id_greater_than_max_returns_empty_replay(
    tmp_path: Path,
) -> None:
    app, db = _build_app(tmp_path)
    last_id = _insert_jsonl(db, session_id="sess-a", uuid="uuid-1")

    _, _, events = await _drive_stream(
        app,
        session_id="sess-a",
        since_id=last_id + 100,
        stop_after="replay-end",
    )

    assert [name for name, _ in events] == ["replay-start", "replay-end"]
    assert events[0][1] == {"session_id": "sess-a", "total": 0}
    assert events[-1][1]["last_id"] == last_id + 100


@pytest.mark.asyncio
async def test_messages_stream_agent_without_sessions_returns_null_session_id(
    tmp_path: Path,
) -> None:
    app, _ = _build_app(tmp_path)

    _, _, events = await _drive_stream(app, stop_after="replay-end")

    assert [name for name, _ in events] == ["replay-start", "replay-end"]
    assert events[0][1] == {"session_id": None, "total": 0}


@pytest.mark.asyncio
async def test_messages_stream_corrupt_payload_does_not_break_stream(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    app, db = _build_app(tmp_path)
    caplog.set_level("WARNING", logger="db.store")
    _insert_raw_event(db, kind="jsonl:user", payload="{not-json")

    _, _, events = await _drive_stream(app, stop_after="replay-end")

    assert [name for name, _ in events] == ["replay-start", "replay-end"]
    assert events[0][1] == {"session_id": None, "total": 0}
    assert "payload JSON inválido em task_events.id=" in caplog.text


@pytest.mark.asyncio
async def test_messages_stream_filters_by_session_id(tmp_path: Path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="uuid-a")
    _insert_jsonl(db, session_id="sess-b", uuid="uuid-b")

    _, _, events = await _drive_stream(
        app,
        session_id="sess-b",
        stop_after="replay-end",
    )

    messages = [payload for name, payload in events if name == "message"]
    assert [m["session_id"] for m in messages] == ["sess-b"]
    assert [m["uuid"] for m in messages] == ["uuid-b"]


@pytest.mark.asyncio
async def test_messages_stream_default_session_is_latest(tmp_path: Path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="uuid-a")
    _insert_jsonl(db, session_id="sess-b", uuid="uuid-b")

    _, _, events = await _drive_stream(
        app,
        stop_after="replay-end",
    )

    messages = [payload for name, payload in events if name == "message"]
    assert events[0][1]["session_id"] == "sess-b"
    assert [m["uuid"] for m in messages] == ["uuid-b"]


@pytest.mark.asyncio
async def test_messages_stream_limit_is_capped_at_500(tmp_path: Path) -> None:
    app, db = _build_app(tmp_path)
    for index in range(505):
        _insert_jsonl(db, session_id="sess-a", uuid=f"uuid-{index:03d}")

    _, _, events = await _drive_stream(
        app,
        session_id="sess-a",
        limit=999,
        stop_after="replay-end",
    )

    messages = [payload for name, payload in events if name == "message"]
    assert events[0][1]["total"] == 500
    assert len(messages) == 500
    assert messages[0]["uuid"] == "uuid-000"
    assert messages[-1]["uuid"] == "uuid-499"


@pytest.mark.asyncio
async def test_messages_stream_heartbeat_after_replay(tmp_path: Path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="uuid-a")

    with patch("routers.agents._MESSAGES_STREAM_HEARTBEAT_S", 0.01), patch(
        "routers.agents._MESSAGES_STREAM_POLL_S", 0.01
    ):
        _, _, events = await _drive_stream(
            app,
            session_id="sess-a",
            stop_after="heartbeat",
        )

    assert [name for name, _ in events][:3] == ["replay-start", "message", "replay-end"]
    assert events[-1][0] == "heartbeat"
    assert isinstance(events[-1][1]["ts"], int)
