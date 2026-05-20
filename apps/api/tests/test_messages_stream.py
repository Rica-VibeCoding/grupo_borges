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
from orchestrator import jsonl_watcher
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
    jsonl_watcher.reset_subagent_state_for_tests()
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
    is_sidechain: bool = False,
    content: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    role = "assistant" if kind == "assistant" else "user"
    message: dict[str, Any] = {
        "role": role,
        "content": content if content is not None else [{"type": "text", "text": text}],
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
        "isSidechain": is_sidechain,
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
    is_sidechain: bool = False,
    content: list[dict[str, Any]] | None = None,
) -> int:
    payload = _payload(
        kind=kind,
        session_id=session_id,
        uuid=uuid,
        parent_uuid=parent_uuid,
        text=text,
        is_sidechain=is_sidechain,
        content=content,
    )
    jsonl_watcher.update_subagent_state_from_jsonl("daniel", payload, kind)
    return db._insert_task_event(
        f"jsonl:{kind}",
        None,
        "daniel",
        None,
        payload,
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
    stop_after_status: str | None = None,
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

    def should_stop(event_name: str, data: dict[str, Any]) -> bool:
        if event_name != stop_after:
            return False
        return stop_after_status is None or data.get("status") == stop_after_status

    try:
        async def collect() -> None:
            async for chunk in response.body_iterator:
                if isinstance(chunk, dict):
                    event_name = str(chunk["event"])
                    data = json.loads(chunk["data"])
                    direct_events.append((event_name, data))
                    if should_stop(event_name, data):
                        break
                else:
                    body = chunk if isinstance(chunk, bytes) else chunk.encode()
                    body_chunks.append(body)
                    parsed = _parse_sse(
                        b"".join(body_chunks).decode("utf-8", errors="replace")
                    )
                    if any(should_stop(name, payload) for name, payload in parsed):
                        break

        await asyncio.wait_for(collect(), timeout=max_wait_s)
    finally:
        disconnected = True
        await response.body_iterator.aclose()

    headers = {k.decode(): v.decode() for k, v in response.raw_headers}
    blob = b"".join(body_chunks).decode("utf-8", errors="replace")
    return response.status_code, headers, direct_events + _parse_sse(blob)


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
    assert headers["cache-control"] == "no-cache"
    assert headers["connection"] == "keep-alive"
    assert headers["x-accel-buffering"] == "no"
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
async def test_messages_stream_tags_synthetic_wakeup_dynamic(
    tmp_path: Path,
) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(
        db,
        session_id="sess-a",
        uuid="uuid-wakeup",
        text="<<autonomous-loop-dynamic>>",
    )

    _, _, events = await _drive_stream(
        app,
        session_id="sess-a",
        stop_after="replay-end",
    )

    messages = [payload for name, payload in events if name == "message"]
    assert messages[0]["meta"]["kind"] == "wakeup-dynamic"
    assert messages[0]["meta"]["raw_text"] == "<<autonomous-loop-dynamic>>"


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


@pytest.mark.asyncio
async def test_messages_stream_emits_subagent_active_status(tmp_path: Path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(
        db,
        kind="assistant",
        session_id="sess-a",
        uuid="sidechain-1",
        parent_uuid="toolu-parent-1",
        is_sidechain=True,
        text="subagent rodando",
    )

    _, _, events = await _drive_stream(
        app,
        session_id="sess-a",
        stop_after="subagent_status",
    )

    event_name, payload = events[-1]
    assert event_name == "subagent_status"
    assert payload["parent_uuid"] == "toolu-parent-1"
    assert payload["status"] == "active"
    assert isinstance(payload["started_at_ms"], int)
    assert isinstance(payload["last_seen_ms"], int)


@pytest.mark.asyncio
async def test_messages_stream_emits_subagent_completed_status(tmp_path: Path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(
        db,
        kind="assistant",
        session_id="sess-a",
        uuid="sidechain-1",
        parent_uuid="toolu-parent-1",
        is_sidechain=True,
    )
    _insert_jsonl(
        db,
        kind="user",
        session_id="sess-a",
        uuid="tool-result-1",
        content=[
            {
                "type": "tool_result",
                "tool_use_id": "toolu-parent-1",
                "content": "done",
            }
        ],
    )

    _, _, events = await _drive_stream(
        app,
        session_id="sess-a",
        stop_after="subagent_status",
        stop_after_status="completed",
    )

    status_events = [payload for name, payload in events if name == "subagent_status"]
    assert status_events[-1]["parent_uuid"] == "toolu-parent-1"
    assert status_events[-1]["status"] == "completed"
    assert status_events[-1]["duration_ms"] >= 0
    assert isinstance(status_events[-1]["started_at_ms"], int)


@pytest.mark.asyncio
async def test_messages_stream_emits_subagent_stalled_after_30s(tmp_path: Path) -> None:
    app, _ = _build_app(tmp_path)
    jsonl_watcher.update_subagent_state_from_jsonl(
        "daniel",
        {
            "type": "assistant",
            "uuid": "sidechain-1",
            "parentUuid": "toolu-parent-1",
            "sessionId": "sess-a",
            "isSidechain": True,
            "message": {"role": "assistant", "content": []},
        },
        "assistant",
        now_ms=1_000,
    )

    with patch("routers.agents._MESSAGES_STREAM_SUBAGENT_STALL_SCAN_S", 0.01), patch(
        "routers.agents._MESSAGES_STREAM_POLL_S", 0.01
    ), patch("orchestrator.jsonl_watcher._now_ms", return_value=32_000):
        _, _, events = await _drive_stream(
            app,
            session_id="sess-a",
            stop_after="subagent_status",
            stop_after_status="stalled",
            max_wait_s=3.0,
        )

    stalled = [
        payload
        for name, payload in events
        if name == "subagent_status" and payload["status"] == "stalled"
    ]
    assert stalled[-1]["parent_uuid"] == "toolu-parent-1"
    assert stalled[-1]["started_at_ms"] == 1_000
    assert stalled[-1]["last_seen_ms"] == 1_000
    assert stalled[-1]["duration_ms"] == 31_000


def test_subagent_completed_uses_real_jsonl_shape() -> None:
    # Regressão pós-E2E vivo 2026-05-16: no JSONL real do Claude Code, o
    # tool_result.tool_use_id é o ID da Anthropic (toolu_xxx), NÃO o
    # parentUuid da msg. _subagent_state é indexado por parentUuid (uuid
    # de msg). Sem o mapa _subagent_task_tool_use, nunca casaria → chip
    # ficava em "active" pra sempre na UI. Esse teste reproduz o fluxo
    # real: assistant Task → sidechain → tool_result → completed.
    jsonl_watcher.reset_subagent_state_for_tests()

    assistant_uuid = "msg-uuid-task"
    tool_use_id = "toolu_real_01"

    # 1. Assistant principal emite tool_use Task
    jsonl_watcher.update_subagent_state_from_jsonl(
        "pavan",
        {
            "type": "assistant",
            "uuid": assistant_uuid,
            "sessionId": "sess-real",
            "isSidechain": False,
            "message": {
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "id": tool_use_id,
                    "name": "Task",
                    "input": {
                        "subagent_type": "general-purpose",
                        "description": "revisar UI",
                        "prompt": "checar pílula de subagente",
                    },
                }],
            },
        },
        "assistant",
        now_ms=1_000,
    )

    # 2. Subagent começa (sidechain com parentUuid = uuid da msg do assistant)
    jsonl_watcher.update_subagent_state_from_jsonl(
        "pavan",
        {
            "type": "assistant",
            "uuid": "sidechain-msg-1",
            "parentUuid": assistant_uuid,
            "sessionId": "sess-real",
            "isSidechain": True,
            "message": {"role": "assistant", "content": [{"type": "text", "text": "trabalhando"}]},
        },
        "assistant",
        now_ms=2_000,
    )

    assert assistant_uuid in jsonl_watcher._subagent_state.get("pavan", {})
    assert jsonl_watcher._subagent_state["pavan"][assistant_uuid]["agent_type"] == "general-purpose"

    # 3. Tool_result vem referenciando tool_use_id (NÃO parentUuid).
    #    Esse é o shape real do CC — antes do fix, mismatch silencioso.
    jsonl_watcher.update_subagent_state_from_jsonl(
        "pavan",
        {
            "type": "user",
            "uuid": "user-result",
            "parentUuid": "prev-msg",
            "sessionId": "sess-real",
            "isSidechain": False,
            "message": {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": tool_use_id, "content": "..."}],
            },
        },
        "user",
        now_ms=5_000,
    )

    # Estado limpo, evento completed emitido
    assert assistant_uuid not in jsonl_watcher._subagent_state.get("pavan", {})
    events = jsonl_watcher._subagent_status_events.get("pavan", [])
    completed = [e for e in events if e["status"] == "completed"]
    assert len(completed) == 1
    assert completed[-1]["parent_uuid"] == assistant_uuid
    assert completed[-1]["duration_ms"] == 3_000
    assert completed[-1]["agent_type"] == "general-purpose"
    assert completed[-1]["description"] == "revisar UI"
    assert completed[-1]["prompt"] == "checar pílula de subagente"


def test_subagent_state_uses_agent_id_as_stable_identity() -> None:
    jsonl_watcher.reset_subagent_state_for_tests()

    prompt = "analisar pílula"
    agent_id = "agent-stable-1"
    jsonl_watcher.update_subagent_state_from_jsonl(
        "lucas",
        {
            "type": "assistant",
            "uuid": "task-msg-1",
            "isSidechain": False,
            "message": {
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "id": "toolu-agent-1",
                    "name": "Agent",
                    "input": {
                        "subagent_type": "code-reviewer",
                        "description": "revisar pílula",
                        "prompt": prompt,
                    },
                }],
            },
        },
        "assistant",
        now_ms=1_000,
    )
    jsonl_watcher.update_subagent_state_from_jsonl(
        "lucas",
        {
            "type": "user",
            "uuid": "side-user-1",
            "parentUuid": None,
            "isSidechain": True,
            "agentId": agent_id,
            "message": {"role": "user", "content": prompt},
        },
        "user",
        now_ms=2_000,
    )
    jsonl_watcher.update_subagent_state_from_jsonl(
        "lucas",
        {
            "type": "assistant",
            "uuid": "side-tool-1",
            "parentUuid": "different-parent",
            "isSidechain": True,
            "agentId": agent_id,
            "message": {
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "id": "toolu-bash",
                    "name": "Bash",
                    "input": {"description": "rodando validação"},
                }],
            },
        },
        "assistant",
        now_ms=3_000,
    )

    snapshot = jsonl_watcher.subagent_active_snapshot("lucas")
    assert len(snapshot) == 1
    assert snapshot[0]["parent_uuid"] == "side-user-1"
    assert snapshot[0]["agent_id"] == agent_id
    assert snapshot[0]["agent_type"] == "code-reviewer"
    assert snapshot[0]["description"] == "revisar pílula"
    assert snapshot[0]["current_tool"] == "Bash"
    assert snapshot[0]["current_tool_summary"] == "rodando validação"

    jsonl_watcher.update_subagent_state_from_jsonl(
        "lucas",
        {
            "type": "user",
            "uuid": "tool-result-1",
            "isSidechain": False,
            "message": {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "toolu-agent-1", "content": "..."}],
            },
            "toolUseResult": {
                "status": "completed",
                "agentId": agent_id,
                "agentType": "code-reviewer",
                "totalDurationMs": 12_345,
                "totalTokens": 9876,
                "totalToolUseCount": 2,
            },
        },
        "user",
        now_ms=20_000,
    )

    assert jsonl_watcher.subagent_active_snapshot("lucas") == []
    completed = [
        e for e in jsonl_watcher._subagent_status_events.get("lucas", [])
        if e["status"] == "completed"
    ]
    assert completed[-1]["duration_ms"] == 12_345
    assert completed[-1]["total_tokens"] == 9876
    assert completed[-1]["total_tool_use_count"] == 2


def test_mark_stalled_subagents_emits_once_and_clears_state() -> None:
    # Regressão pós-review: stalled deve ser emitido UMA VEZ por parent_uuid
    # e o parent removido do state in-memory, senão (1) cada scan de 10s
    # re-emite o mesmo stalled e (2) o dict cresce monotônico em produção.
    jsonl_watcher.reset_subagent_state_for_tests()
    jsonl_watcher.update_subagent_state_from_jsonl(
        "daniel",
        {
            "type": "assistant",
            "uuid": "sidechain-once",
            "parentUuid": "toolu-once",
            "sessionId": "sess-once",
            "isSidechain": True,
            "message": {"role": "assistant", "content": []},
        },
        "assistant",
        now_ms=1_000,
    )

    first = jsonl_watcher.mark_stalled_subagents("daniel", now_ms=32_000)
    second = jsonl_watcher.mark_stalled_subagents("daniel", now_ms=42_000)
    third = jsonl_watcher.mark_stalled_subagents("daniel", now_ms=120_000)

    assert len(first) == 1
    assert first[0]["parent_uuid"] == "toolu-once"
    assert second == []
    assert third == []
    assert "toolu-once" not in jsonl_watcher._subagent_state.get("daniel", {})


def test_mark_stalled_keeps_native_subagent_inside_long_tool() -> None:
    jsonl_watcher.reset_subagent_state_for_tests()
    jsonl_watcher._subagent_state.setdefault("felipe", {})["subagent-long-tool"] = {
        "started_at_ms": 1_000,
        "last_seen_ms": 1_000,
        "current_tool": "Bash",
        "current_tool_summary": "until-loop",
    }

    stalled = jsonl_watcher.mark_stalled_subagents("felipe", now_ms=61_000)

    assert stalled == []
    assert "subagent-long-tool" in jsonl_watcher._subagent_state.get("felipe", {})
