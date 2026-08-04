"""Canal in-memory de reset da conversa por agente."""
from __future__ import annotations

from typing import Any


_session_reset_events: dict[str, list[dict[str, Any]]] = {}
_session_reset_seq = 0


def publish_session_reset(slug: str, payload: dict[str, Any]) -> None:
    global _session_reset_seq
    _session_reset_seq += 1
    _session_reset_events.setdefault(slug, []).append(
        {"seq": _session_reset_seq, **payload}
    )


def session_reset_events_since(
    slug: str,
    after_seq: int,
) -> tuple[list[dict[str, Any]], int]:
    events = [
        event
        for event in _session_reset_events.get(slug, [])
        if int(event.get("seq", 0)) > after_seq
    ]
    latest_seq = after_seq
    if events:
        latest_seq = max(int(event["seq"]) for event in events)
    return events, latest_seq
