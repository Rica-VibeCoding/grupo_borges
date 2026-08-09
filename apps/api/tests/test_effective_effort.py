"""Testes do leitor de esforço efetivo, sem tocar no endpoint do painel."""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import effective_effort


def _make_codex_db(tmp_path: Path, *, effort: str | None) -> Path:
    db_path = tmp_path / "state_5.sqlite"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL,
                cwd TEXT NOT NULL,
                title TEXT NOT NULL,
                model TEXT,
                reasoning_effort TEXT,
                tokens_used INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                updated_at_ms INTEGER,
                created_at_ms INTEGER
            )
            """
        )
        conn.execute(
            """
            INSERT INTO threads (
                id, rollout_path, cwd, title, model, reasoning_effort,
                tokens_used, archived, updated_at_ms, created_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "codex-live",
                "/tmp/codex-live.jsonl",
                "/workspace",
                "live",
                "gpt-5.6",
                effort,
                0,
                0,
                2,
                1,
            ),
        )
    return db_path


def _write_status(tmp_path: Path, session_id: str, payload: object) -> Path:
    path = tmp_path / f"cc-status-{session_id}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_codex_reads_effective_thread_effort_not_requested_state(tmp_path: Path) -> None:
    db_path = _make_codex_db(tmp_path, effort="medium")
    result = effective_effort.read_effective_effort(
        {
            "executor_kind": "codex",
            "codex_thread_id": "codex-live",
            "workspace_path": "/workspace",
            "codex_reasoning_effort": "high",
        },
        codex_db_path=db_path,
    )

    assert result.value == "medium"
    assert result.source == str(db_path)


def test_claude_family_reads_live_statusline_effort_not_requested_state(tmp_path: Path) -> None:
    status_path = _write_status(
        tmp_path,
        "kimi-live",
        {"session_id": "kimi-live", "effort": {"level": "max"}},
    )
    result = effective_effort.read_effective_effort(
        {
            "model_family": "kimi",
            "kimi_reasoning_effort": "low",
        },
        session_id="kimi-live",
        status_dir=tmp_path,
    )

    assert result.value == "max"
    assert result.source == str(status_path)


def test_canario_uses_statusline_even_without_model_family(tmp_path: Path) -> None:
    status_path = _write_status(
        tmp_path,
        "canario-live",
        {"session_id": "canario-live", "effort": {"level": "xhigh"}},
    )
    result = effective_effort.read_effective_effort(
        {
            "cli_default": "claude_code",
            "model_default": "deepseek-v4-flash",
            "codex_reasoning_effort": "low",
        },
        session_id="canario-live",
        status_dir=tmp_path,
    )

    assert result.value == "xhigh"
    assert result.source == str(status_path)


def test_missing_statusline_does_not_fallback_to_requested_effort(tmp_path: Path) -> None:
    result = effective_effort.read_effective_effort(
        {"model_family": "kimi", "kimi_reasoning_effort": "high"},
        session_id="dead-session",
        status_dir=tmp_path,
    )

    assert result.value is None
    assert result.source == str(tmp_path / "cc-status-dead-session.json")


def test_missing_effort_level_is_unknown_not_an_exception(tmp_path: Path) -> None:
    _write_status(tmp_path, "unsupported", {"session_id": "unsupported"})

    result = effective_effort.read_effective_effort(
        {"model_family": "kimi", "kimi_reasoning_effort": "high"},
        session_id="unsupported",
        status_dir=tmp_path,
    )

    assert result.value is None


def test_unreadable_codex_state_returns_none(tmp_path: Path) -> None:
    result = effective_effort.read_effective_effort(
        {
            "executor_kind": "codex",
            "codex_thread_id": "codex-live",
            "codex_reasoning_effort": "high",
        },
        codex_db_path=tmp_path / "missing-state.sqlite",
    )

    assert result.value is None
    assert result.source == str(tmp_path / "missing-state.sqlite")
