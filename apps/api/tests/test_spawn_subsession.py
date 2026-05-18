"""Testes para mcp_tools/spawn_subsession.py e register_spawned_subagent."""
from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_tools.spawn_subsession import (
    SpawnSubsessionInput,
    _check_no_dirty_index,
    spawn_subsession,
)
from orchestrator import jsonl_watcher
from orchestrator.jsonl_watcher import (
    register_spawned_subagent,
    reset_subagent_state_for_tests,
    subagent_active_snapshot,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_db(*, insert_ok: bool = True) -> Any:
    db = AsyncMock()
    db.insert_task_event = AsyncMock(return_value=1 if insert_ok else None)
    return db


def _valid_payload(**overrides) -> SpawnSubsessionInput:
    defaults = dict(
        task_id="task-abc-123",
        agent_slug="daniel",
        prompt="faz o refactor do módulo X",
        visibility=True,
    )
    return SpawnSubsessionInput(**(defaults | overrides))


# ---------------------------------------------------------------------------
# _check_no_dirty_index
# ---------------------------------------------------------------------------


def test_check_dirty_raises_on_tracked_changes():
    # returncode=1 = git diff HEAD found differences
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1, stdout=b"", stderr=b"")
        with pytest.raises(ValueError, match="mudanças não-commitadas"):
            _check_no_dirty_index("/some/workspace")


def test_check_dirty_ok_on_clean():
    # returncode=0 = no differences
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout=b"", stderr=b"")
        _check_no_dirty_index("/some/workspace")  # não deve lançar


def test_check_dirty_raises_on_git_failure():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=128, stdout=b"", stderr=b"not a git repo")
        with pytest.raises(ValueError, match="git diff HEAD falhou"):
            _check_no_dirty_index("/some/workspace")


# ---------------------------------------------------------------------------
# register_spawned_subagent
# ---------------------------------------------------------------------------


def test_register_spawned_subagent_adds_to_state():
    reset_subagent_state_for_tests()

    register_spawned_subagent(
        "daniel",
        "sub-id-1234",
        task_id="task-99",
        session_name="sub-daniel-sub-id12",
        worktree_path="/tmp/subsession-sub-id-1234",
        workspace_path="/home/clawd/repos/ze_claude/daniel",
        visibility=True,
        agent_slug="daniel",
    )

    snapshot = subagent_active_snapshot("daniel")
    assert len(snapshot) == 1
    entry = snapshot[0]
    assert entry["parent_uuid"] == "sub-id-1234"
    assert entry["task_id"] == "task-99"
    assert entry["visibility"] is True
    assert entry["spawned_by_tool"] is True


def test_register_spawned_subagent_emits_status_event():
    reset_subagent_state_for_tests()

    register_spawned_subagent(
        "pavan",
        "sub-pavan-9999",
        task_id="task-00",
        session_name="sub-pavan-aaaabbbb",
        worktree_path="/tmp/subsession-9999",
        workspace_path="/home/clawd/repos/ze_claude/pavan",
        visibility=False,
        agent_slug="pavan",
    )

    events, _ = jsonl_watcher.subagent_status_events_since("pavan", after_seq=0)
    assert len(events) == 1
    assert events[0]["status"] == "starting"
    assert events[0]["spawned_by_tool"] is True
    assert events[0]["visibility"] is False


# ---------------------------------------------------------------------------
# spawn_subsession
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_spawn_subsession_happy_path():
    reset_subagent_state_for_tests()
    db = _make_db()
    payload = _valid_payload()

    with (
        patch("mcp_tools.spawn_subsession._check_no_dirty_index"),
        patch("mcp_tools.spawn_subsession._create_worktree_sync"),
        patch("mcp_tools.spawn_subsession._launch_in_tmux_sync"),
        patch(
            "mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True
        ),
    ):
        result = await spawn_subsession(
            "daniel",
            "/home/clawd/repos/ze_claude/daniel",
            payload,
            db,
        )

    assert result["status"] == "starting"
    assert "subsession_id" in result
    assert result["session_name"].startswith("sub-daniel-")

    # Estado registrado
    snapshot = subagent_active_snapshot("daniel")
    assert len(snapshot) == 1
    assert snapshot[0]["task_id"] == "task-abc-123"
    assert snapshot[0]["visibility"] is True

    # DB gravado
    db.insert_task_event.assert_awaited_once()
    call_kwargs = db.insert_task_event.call_args
    assert call_kwargs.args[0] == "subagent_started"
    assert call_kwargs.kwargs["agent_slug"] == "daniel"


@pytest.mark.asyncio
async def test_spawn_subsession_dirty_workspace_raises_409_equivalent():
    reset_subagent_state_for_tests()
    db = _make_db()
    payload = _valid_payload()

    def _dirty(*_a, **_kw):
        raise ValueError("Workspace pai tem mudanças não-commitadas — commita antes de spawnar")

    with (
        patch("mcp_tools.spawn_subsession._check_no_dirty_index", side_effect=_dirty),
        patch("mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True),
    ):
        with pytest.raises(ValueError, match="mudanças não-commitadas"):
            await spawn_subsession(
                "daniel",
                "/home/clawd/repos/ze_claude/daniel",
                payload,
                db,
            )

    # Worktree NÃO deve ter sido criado
    snapshot = subagent_active_snapshot("daniel")
    assert len(snapshot) == 0


@pytest.mark.asyncio
async def test_spawn_subsession_unsafe_workspace_raises():
    reset_subagent_state_for_tests()
    db = _make_db()
    payload = _valid_payload()

    with pytest.raises(ValueError, match="inseguros"):
        await spawn_subsession("daniel", "/home/clawd/repos/; rm -rf /", payload, db)


@pytest.mark.asyncio
async def test_spawn_subsession_cleans_worktree_on_tmux_failure():
    reset_subagent_state_for_tests()
    db = _make_db()
    payload = _valid_payload()

    import libtmux.exc as ltexc

    with (
        patch("mcp_tools.spawn_subsession._check_no_dirty_index"),
        patch("mcp_tools.spawn_subsession._create_worktree_sync"),
        patch(
            "mcp_tools.spawn_subsession._launch_in_tmux_sync",
            side_effect=ltexc.LibTmuxException("session already exists"),
        ),
        patch("mcp_tools.spawn_subsession._cleanup_worktree_sync") as mock_cleanup,
        patch("mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True),
    ):
        with pytest.raises(ltexc.LibTmuxException):
            await spawn_subsession(
                "daniel",
                "/home/clawd/repos/ze_claude/daniel",
                payload,
                db,
            )

    mock_cleanup.assert_called_once()
    # Nenhum estado registrado
    assert len(subagent_active_snapshot("daniel")) == 0
