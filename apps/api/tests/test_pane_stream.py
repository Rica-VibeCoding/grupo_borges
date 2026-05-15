"""DS-2 / SubB — testes pro endpoint SSE `GET /api/agents/{slug}/pane/stream`.

Migrado de `TestClient` síncrono pra invocação ASGI direta com `asyncio` +
mocks de `tmux_driver`. Justificativa: o stream é infinito (loop 1 Hz com
`is_disconnected` cooperativo). Tanto `TestClient` quanto `httpx.AsyncClient
+ ASGITransport` pendurariam — o segundo bufferiza o body antes de retornar
o `Response` (ver `httpx/_transports/asgi.py` 0.28.1 linhas 169-187: `await
self.app(...)` precisa terminar antes de devolver controle ao cliente).

Estratégia:
- 404 / content-type / payload do primeiro evento: invocar `app(scope,
  receive, send)` numa task, coletar mensagens via `send` controlado, e
  enviar `http.disconnect` por `receive` quando já temos o que queremos.
- Mock `capture_pane_excerpt` retorna string fixa → loop emite no 1º tick.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
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

# Excerpt fixo: garante que o loop SSE emita 1 `event: pane` no 1º tick
# (hash sha1 vira != None pela primeira vez).
_FAKE_EXCERPT = "$ claude --version\nclaude code 1.0.0\n$"


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


def _http_scope(path: str) -> dict[str, Any]:
    return {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }


async def _drive_asgi(
    app: FastAPI,
    path: str,
    *,
    stop_after_event: bool = False,
    max_wait_s: float = 3.0,
) -> tuple[int, dict[str, str], list[bytes]]:
    """Invoca o ASGI app manualmente e controla o lifecycle.

    - `stop_after_event=True`: ao detectar um body chunk com `event: pane`,
      manda `http.disconnect` via `receive` e cancela a task do app. Sem
      isso, o loop SSE infinito nunca retorna.
    - Caso contrário (ex: 404): roda até `more_body=False` ou timeout.

    Retorna `(status, headers_dict, body_chunks)`.
    """
    scope = _http_scope(path)
    status_code: int | None = None
    headers: dict[str, str] = {}
    body_chunks: list[bytes] = []
    response_done = asyncio.Event()
    pane_event_seen = asyncio.Event()
    disconnect = asyncio.Event()

    async def receive() -> dict[str, Any]:
        # 1ª chamada: body do request (vazio, sem more_body).
        # Demais chamadas: bloqueia até `disconnect` ser setado.
        if not receive._sent_request:  # type: ignore[attr-defined]
            receive._sent_request = True  # type: ignore[attr-defined]
            return {"type": "http.request", "body": b"", "more_body": False}
        await disconnect.wait()
        return {"type": "http.disconnect"}

    receive._sent_request = False  # type: ignore[attr-defined]

    async def send(message: dict[str, Any]) -> None:
        nonlocal status_code
        msg_type = message["type"]
        if msg_type == "http.response.start":
            status_code = message["status"]
            for k, v in message.get("headers", []):
                headers[k.decode()] = v.decode()
        elif msg_type == "http.response.body":
            body = message.get("body", b"")
            if body:
                body_chunks.append(body)
                if stop_after_event and b"event: pane" in body:
                    pane_event_seen.set()
            if not message.get("more_body", False):
                response_done.set()

    task = asyncio.create_task(app(scope, receive, send))

    try:
        if stop_after_event:
            # Espera 1 `event: pane` (ou timeout) e desconecta o cliente.
            try:
                await asyncio.wait_for(pane_event_seen.wait(), timeout=max_wait_s)
            except asyncio.TimeoutError:
                pass
            disconnect.set()
            # Dá um instante pro generator do SSE observar is_disconnected.
            try:
                await asyncio.wait_for(task, timeout=max_wait_s)
            except asyncio.TimeoutError:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, BaseException):
                    pass
        else:
            try:
                await asyncio.wait_for(response_done.wait(), timeout=max_wait_s)
            except asyncio.TimeoutError:
                disconnect.set()
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, BaseException):
                    pass
            else:
                await task
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except BaseException:
                pass

    assert status_code is not None, "ASGI app não enviou http.response.start"
    return status_code, headers, body_chunks


@pytest.mark.asyncio
async def test_stream_returns_sse_content_type(tmp_path: Path) -> None:
    """SSE response deve carregar Content-Type `text/event-stream`."""
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.capture_pane_excerpt",
        return_value=_FAKE_EXCERPT,
    ):
        status, headers, _ = await _drive_asgi(
            app, "/api/agents/daniel/pane/stream", stop_after_event=True
        )
    assert status == 200
    ctype = headers.get("content-type", "")
    assert ctype.startswith("text/event-stream"), f"content-type inesperado: {ctype!r}"


@pytest.mark.asyncio
async def test_stream_404_agent_not_found(tmp_path: Path) -> None:
    """Slug inexistente → 404 antes de abrir o stream."""
    app = _build_app(tmp_path)
    status, _, _ = await _drive_asgi(app, "/api/agents/nao-existe/pane/stream")
    assert status == 404


@pytest.mark.asyncio
@pytest.mark.xfail(
    strict=False,
    reason="stub: impl real emite pane event com excerpt/captured_at/executor_kind",
)
async def test_stream_emits_pane_event_with_expected_fields(tmp_path: Path) -> None:
    """Lê 1 evento `event: pane` com payload `{excerpt, captured_at, executor_kind}`.

    Mocka `capture_pane_excerpt` pra retornar excerpt fixo: garante que o
    loop emita no primeiro tick (hash novo != None) sem depender de tmux real.
    """
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.capture_pane_excerpt",
        return_value=_FAKE_EXCERPT,
    ):
        status, _, body_chunks = await _drive_asgi(
            app, "/api/agents/daniel/pane/stream", stop_after_event=True
        )
    assert status == 200

    # Concatena chunks num blob e parseia linhas SSE.
    blob = b"".join(body_chunks).decode("utf-8", errors="replace")
    lines = blob.splitlines()

    # Acha o bloco `event: pane` + `data:` correspondente.
    event_idx: int | None = None
    for i, line in enumerate(lines):
        if line.startswith("event:") and "pane" in line:
            event_idx = i
            break
    assert event_idx is not None, f"esperado `event: pane` no body, got: {lines!r}"

    data_line: str | None = None
    for line in lines[event_idx + 1 : event_idx + 5]:
        if line.startswith("data:"):
            data_line = line
            break
    assert data_line is not None, "esperado `data:` após `event: pane`"

    payload = json.loads(data_line.removeprefix("data:").strip())
    assert "excerpt" in payload
    assert "captured_at" in payload
    assert "executor_kind" in payload
    assert "stub" not in payload, "impl real não deve emitir flag stub"
