"""Cliente do dono persistente da conversa Codex da Tara."""
from __future__ import annotations

import os
from typing import Any

import httpx

_CONTROL_URL = os.getenv("TELECODEX_CONTROL_URL", "http://127.0.0.1:8787").rstrip("/")
_CONTROL_TIMEOUT_SECONDS = 5.0


class TeleCodexUnavailable(RuntimeError):
    pass


class TeleCodexControlError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def send_prompt(
    *,
    text: str,
    fresh: bool = False,
    image_path: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"text": text, "fresh": fresh}
    if image_path is not None:
        body["imagePaths"] = [image_path]
    return await _post("/control/prompt", body)


async def get_status() -> dict[str, Any]:
    return await _request("GET", "/control/status")


async def start_fresh_thread() -> dict[str, Any]:
    return await _post("/control/new-thread", {})


async def abort() -> dict[str, Any]:
    return await _post("/control/abort", {})


async def close_session() -> dict[str, Any]:
    return await _post("/control/session/close", {})


async def reopen_session() -> dict[str, Any]:
    return await _post("/control/session/reopen", {})


async def reconfigure_session(
    *,
    model: str,
    reasoning_effort: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"model": model}
    if reasoning_effort is not None:
        body["reasoningEffort"] = reasoning_effort
    return await _post("/control/session/reconfigure", body)


async def _post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", path, body)


async def _request(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=_CONTROL_TIMEOUT_SECONDS) as client:
            if body is None:
                response = await client.request(method, f"{_CONTROL_URL}{path}")
            else:
                response = await client.request(method, f"{_CONTROL_URL}{path}", json=body)
    except httpx.HTTPError as exc:
        raise TeleCodexUnavailable("telecodex_control_unavailable") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.status_code >= 400:
        detail = payload.get("error") if isinstance(payload, dict) else None
        raise TeleCodexControlError(response.status_code, str(detail or "telecodex_control_failed"))
    if not isinstance(payload, dict):
        raise TeleCodexControlError(502, "telecodex_invalid_response")
    return payload
