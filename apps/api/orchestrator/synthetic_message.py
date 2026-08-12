from __future__ import annotations

from typing import Literal, TypedDict

WAKEUP_DYNAMIC = "<<autonomous-loop-dynamic>>"
WAKEUP_CRON = "<<autonomous-loop>>"

SyntheticKind = Literal["wakeup-dynamic", "wakeup-cron", "stt"]


class SyntheticMeta(TypedDict):
    kind: SyntheticKind
    raw_text: str


def explicit_synthetic_meta(value: object) -> SyntheticMeta | None:
    """Valida meta que já veio da origem, sem classificar texto de usuário."""
    if not isinstance(value, dict):
        return None
    kind = value.get("kind")
    raw_text = value.get("raw_text")
    if kind not in {"wakeup-dynamic", "wakeup-cron", "stt"}:
        return None
    if not isinstance(raw_text, str):
        return None
    return {"kind": kind, "raw_text": raw_text}


def _first_text_content(content: object) -> str | None:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None
    for part in content:
        if (
            isinstance(part, dict)
            and part.get("type") == "text"
            and isinstance(part.get("text"), str)
        ):
            return part["text"]
    return None


def detect_synthetic_kind(message: dict | None) -> SyntheticMeta | None:
    """Retorna {'kind': '<kind>', 'raw_text': '<texto original>'} ou None.

    Aceita o objeto `message` interno do payload JSONL (mesmo dict que
    `_canonical_jsonl_message_event` repassa em `message`). Inspeciona
    `message.content` se string, ou primeiro bloco text se list.
    """
    if message is None:
        return None

    raw_text = _first_text_content(message.get("content"))
    if raw_text is None or raw_text == "":
        return None

    stripped = raw_text.strip()
    if stripped == WAKEUP_DYNAMIC:
        return {"kind": "wakeup-dynamic", "raw_text": raw_text}
    if stripped == WAKEUP_CRON:
        return {"kind": "wakeup-cron", "raw_text": raw_text}
    return None
