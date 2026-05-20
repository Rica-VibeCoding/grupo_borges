from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orchestrator.synthetic_message import detect_synthetic_kind


@pytest.mark.parametrize(
    ("content", "kind", "raw_text"),
    [
        ("<<autonomous-loop-dynamic>>", "wakeup-dynamic", "<<autonomous-loop-dynamic>>"),
        ("<<autonomous-loop>>", "wakeup-cron", "<<autonomous-loop>>"),
        ("🎙 abrir relatório", "stt", "🎙 abrir relatório"),
    ],
)
def test_detects_synthetic_kind_from_string_content(
    content: str,
    kind: str,
    raw_text: str,
) -> None:
    assert detect_synthetic_kind({"content": content}) == {
        "kind": kind,
        "raw_text": raw_text,
    }


def test_detects_synthetic_kind_from_first_text_content_part() -> None:
    assert detect_synthetic_kind(
        {
            "content": [
                {"type": "thinking", "thinking": "skip"},
                {"type": "text", "text": "<<autonomous-loop>>"},
            ]
        }
    ) == {"kind": "wakeup-cron", "raw_text": "<<autonomous-loop>>"}


@pytest.mark.parametrize(
    "message",
    [
        None,
        {"content": None},
        {"content": ""},
        {"content": "mensagem comum"},
        {"content": []},
        {"content": [{"type": "thinking", "thinking": "sem texto"}]},
    ],
)
def test_returns_none_for_non_synthetic_messages(message: dict | None) -> None:
    assert detect_synthetic_kind(message) is None


@pytest.mark.parametrize(
    ("content", "kind"),
    [
        ("  <<autonomous-loop-dynamic>>\n", "wakeup-dynamic"),
        ("\t<<autonomous-loop>>  ", "wakeup-cron"),
    ],
)
def test_wakeup_matching_ignores_surrounding_whitespace(
    content: str,
    kind: str,
) -> None:
    assert detect_synthetic_kind({"content": content}) == {
        "kind": kind,
        "raw_text": content,
    }


def test_stt_prefix_without_transcribed_text_still_matches() -> None:
    assert detect_synthetic_kind({"content": "🎙 "}) == {
        "kind": "stt",
        "raw_text": "🎙 ",
    }
