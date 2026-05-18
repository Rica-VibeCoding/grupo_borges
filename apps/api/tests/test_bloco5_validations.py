"""Testes LB-9 Bloco 5 — validações, TTL e worktree helpers."""
from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

from mcp_tools.spawn_subsession import (
    SkillNotFoundError,
    SpawnSubsessionInput,
    TooManySubsessionsError,
    spawn_subsession,
)
from orchestrator import jsonl_watcher
from orchestrator.jsonl_watcher import (
    count_active_subsessions_for_task,
    mark_stalled_all_slugs,
    mark_stalled_subagents,
    register_spawned_subagent,
    reset_subagent_state_for_tests,
)
from orchestrator.worktree import cleanup_worktree_sync, sweep_orphan_worktrees_sync


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_db(*, insert_ok: bool = True) -> Any:
    from unittest.mock import AsyncMock

    db = AsyncMock()
    db.insert_task_event = AsyncMock(return_value=1 if insert_ok else None)
    return db


def _valid_payload(**overrides) -> SpawnSubsessionInput:
    defaults = dict(
        task_id="task-bloco5",
        agent_slug="daniel",
        prompt="faz o refactor",
        visibility=True,
    )
    return SpawnSubsessionInput(**(defaults | overrides))


def _register(slug: str, subsession_id: str, task_id: str = "task-bloco5", **kw) -> None:
    register_spawned_subagent(
        slug,
        subsession_id,
        task_id=task_id,
        session_name=f"sub-{slug}-{subsession_id[:8]}",
        worktree_path=f"/tmp/subsession-{subsession_id}",
        workspace_path=f"/home/clawd/repos/ze_claude/{slug}",
        visibility=True,
        agent_slug=slug,
        **kw,
    )


# ---------------------------------------------------------------------------
# Validação 1 — permissão: agent_slug != slug → PermissionError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_spawn_permission_denied_wrong_agent_slug():
    reset_subagent_state_for_tests()
    db = _make_db()
    payload = _valid_payload(agent_slug="pavan")  # slug da rota será "daniel"

    with (
        patch("mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True),
    ):
        with pytest.raises(PermissionError, match="Permissão negada"):
            await spawn_subsession("daniel", "/home/clawd/repos/ze_claude/daniel", payload, db)


@pytest.mark.asyncio
async def test_spawn_permission_ok_matching_slug():
    reset_subagent_state_for_tests()
    db = _make_db()
    payload = _valid_payload(agent_slug="daniel")

    with (
        patch("mcp_tools.spawn_subsession._check_no_dirty_index"),
        patch("mcp_tools.spawn_subsession._create_worktree_sync"),
        patch("mcp_tools.spawn_subsession._launch_in_tmux_sync"),
        patch("mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True),
    ):
        result = await spawn_subsession("daniel", "/home/clawd/repos/ze_claude/daniel", payload, db)
    assert result["status"] == "starting"


# ---------------------------------------------------------------------------
# Validação 2 — limite 3 subsessões por task
# ---------------------------------------------------------------------------


def test_count_active_subsessions_for_task():
    reset_subagent_state_for_tests()
    _register("daniel", "aaa111", task_id="task-x")
    _register("daniel", "aaa222", task_id="task-x")
    _register("pavan", "aaa333", task_id="task-x")  # outro slug, mesma task
    _register("daniel", "aaa444", task_id="task-y")  # outra task

    assert count_active_subsessions_for_task("task-x") == 3
    assert count_active_subsessions_for_task("task-y") == 1
    assert count_active_subsessions_for_task("task-z") == 0


@pytest.mark.asyncio
async def test_spawn_limit_exceeded_raises_429():
    reset_subagent_state_for_tests()
    db = _make_db()
    # Preenche até o limite
    for i in range(3):
        _register("daniel", f"subsid-{i}", task_id="task-bloco5")

    payload = _valid_payload(agent_slug="daniel")

    with (
        patch("mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True),
    ):
        with pytest.raises(TooManySubsessionsError, match="Limite de 3"):
            await spawn_subsession("daniel", "/home/clawd/repos/ze_claude/daniel", payload, db)


@pytest.mark.asyncio
async def test_spawn_limit_not_exceeded_with_2_active():
    reset_subagent_state_for_tests()
    db = _make_db()
    for i in range(2):
        _register("daniel", f"subsid-{i}", task_id="task-bloco5")

    payload = _valid_payload(agent_slug="daniel")

    with (
        patch("mcp_tools.spawn_subsession._check_no_dirty_index"),
        patch("mcp_tools.spawn_subsession._create_worktree_sync"),
        patch("mcp_tools.spawn_subsession._launch_in_tmux_sync"),
        patch("mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True),
    ):
        result = await spawn_subsession("daniel", "/home/clawd/repos/ze_claude/daniel", payload, db)
    assert result["status"] == "starting"


# ---------------------------------------------------------------------------
# Validação 3 — skill deve existir no workspace
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_spawn_skill_not_found_raises_400():
    reset_subagent_state_for_tests()
    db = _make_db()
    payload = _valid_payload(agent_slug="daniel", skill="skill-inexistente")

    with (
        patch("mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True),
        patch(
            "mcp_tools.spawn_subsession.workspace_reader.read_skills_cached",
            return_value=[{"name": "checkpoint"}, {"name": "memoria"}],
        ),
    ):
        with pytest.raises(SkillNotFoundError, match="skill-inexistente"):
            await spawn_subsession("daniel", "/home/clawd/repos/ze_claude/daniel", payload, db)


@pytest.mark.asyncio
async def test_spawn_skill_found_ok():
    reset_subagent_state_for_tests()
    db = _make_db()
    payload = _valid_payload(agent_slug="daniel", skill="checkpoint")

    with (
        patch("mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True),
        patch(
            "mcp_tools.spawn_subsession.workspace_reader.read_skills_cached",
            return_value=[{"name": "checkpoint"}, {"name": "memoria"}],
        ),
        patch("mcp_tools.spawn_subsession._check_no_dirty_index"),
        patch("mcp_tools.spawn_subsession._create_worktree_sync"),
        patch("mcp_tools.spawn_subsession._launch_in_tmux_sync"),
    ):
        result = await spawn_subsession("daniel", "/home/clawd/repos/ze_claude/daniel", payload, db)
    assert result["status"] == "starting"


@pytest.mark.asyncio
async def test_spawn_no_skill_field_skips_validation():
    """skill=None não dispara validação mesmo com workspace vazio."""
    reset_subagent_state_for_tests()
    db = _make_db()
    payload = _valid_payload(agent_slug="daniel", skill=None)

    with (
        patch("mcp_tools.spawn_subsession.Path.is_relative_to", return_value=True),
        patch("mcp_tools.spawn_subsession._check_no_dirty_index"),
        patch("mcp_tools.spawn_subsession._create_worktree_sync"),
        patch("mcp_tools.spawn_subsession._launch_in_tmux_sync"),
        patch(
            "mcp_tools.spawn_subsession.workspace_reader.read_skills_cached",
            return_value=[],
        ) as mock_skills,
    ):
        result = await spawn_subsession("daniel", "/home/clawd/repos/ze_claude/daniel", payload, db)
    mock_skills.assert_not_called()
    assert result["status"] == "starting"


# ---------------------------------------------------------------------------
# TTL diferenciado — spawned_by_tool = 600s, nativo = 30s
# ---------------------------------------------------------------------------


def test_mark_stalled_tool_spawned_uses_600s_ttl():
    reset_subagent_state_for_tests()
    _register("daniel", "ttl-tool-id")

    # 31s depois — não deve stallar (TTL é 600s)
    now_ms = int(time.time() * 1000) + 31_000
    stalled = mark_stalled_subagents("daniel", now_ms=now_ms)
    assert stalled == []


def test_mark_stalled_tool_spawned_stalls_after_600s():
    reset_subagent_state_for_tests()
    _register("daniel", "ttl-tool-id-2")

    # 601s depois — deve stallar
    now_ms = int(time.time() * 1000) + 601_000
    stalled = mark_stalled_subagents("daniel", now_ms=now_ms)
    assert len(stalled) == 1
    entry = stalled[0]
    assert entry["parent_uuid"] == "ttl-tool-id-2"
    assert entry["status"] == "stalled"
    assert entry.get("spawned_by_tool") is True
    assert "worktree_path" in entry
    assert "workspace_path" in entry
    assert "session_name" in entry


def test_mark_stalled_native_still_uses_30s_ttl():
    """Subagents nativos (spawned_by_tool=False) continuam com TTL 30s."""
    reset_subagent_state_for_tests()
    # Registrar diretamente no state como nativo (sem spawned_by_tool)
    jsonl_watcher._subagent_state.setdefault("pavan", {})["native-id"] = {
        "started_at_ms": int(time.time() * 1000),
        "last_seen_ms": int(time.time() * 1000),
    }

    # 31s depois → stallar (TTL 30s)
    now_ms = int(time.time() * 1000) + 31_000
    stalled = mark_stalled_subagents("pavan", now_ms=now_ms)
    assert len(stalled) == 1
    assert stalled[0]["parent_uuid"] == "native-id"


def test_mark_stalled_all_slugs_sweeps_all():
    reset_subagent_state_for_tests()
    _register("daniel", "slug-a-1")
    _register("pavan", "slug-b-1")

    now_ms = int(time.time() * 1000) + 601_000
    all_stalled = mark_stalled_all_slugs(now_ms=now_ms)
    assert len(all_stalled) == 2
    parent_uuids = {e["parent_uuid"] for e in all_stalled}
    assert "slug-a-1" in parent_uuids
    assert "slug-b-1" in parent_uuids


# ---------------------------------------------------------------------------
# cleanup_worktree_sync
# ---------------------------------------------------------------------------


def test_cleanup_worktree_removes_clean_branch(tmp_path):
    fake_wt = tmp_path / "worktree"
    fake_wt.mkdir()

    with (
        patch("orchestrator.worktree.subprocess.run") as mock_run,
    ):
        # rev-parse HEAD → sucesso com hash
        # rev-list --count → 0 commits ahead
        # worktree remove → sucesso
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout=b"abc123\n"),  # rev-parse
            MagicMock(returncode=0, stdout=b"0\n"),       # rev-list
            MagicMock(returncode=0, stdout=b""),           # worktree remove
        ]
        cleanup_worktree_sync(
            workspace_path="/fake/workspace",
            worktree_path=str(fake_wt),
            subsession_id="clean-sub",
        )

    assert mock_run.call_count == 3
    remove_call = mock_run.call_args_list[2]
    assert "worktree" in remove_call.args[0]
    assert "remove" in remove_call.args[0]


def test_cleanup_worktree_preserves_branch_with_commits(tmp_path):
    fake_wt = tmp_path / "worktree"
    fake_wt.mkdir()

    with patch("orchestrator.worktree.subprocess.run") as mock_run:
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout=b"abc123\n"),  # rev-parse
            MagicMock(returncode=0, stdout=b"2\n"),       # 2 commits ahead
        ]
        cleanup_worktree_sync(
            workspace_path="/fake/workspace",
            worktree_path=str(fake_wt),
            subsession_id="dirty-sub",
        )

    # worktree remove NÃO deve ter sido chamado
    assert mock_run.call_count == 2


def test_cleanup_worktree_noop_when_path_missing():
    with patch("orchestrator.worktree.subprocess.run") as mock_run:
        cleanup_worktree_sync(
            workspace_path="/fake/ws",
            worktree_path="/tmp/subsession-inexistente-xyz",
            subsession_id="ghost-sub",
        )
    mock_run.assert_not_called()


# ---------------------------------------------------------------------------
# sweep_orphan_worktrees_sync
# ---------------------------------------------------------------------------


def test_sweep_orphan_worktrees_removes_unlisted(tmp_path):
    fake_tmp = tmp_path
    orphan = fake_tmp / "subsession-orphan-1234"
    orphan.mkdir()
    active = fake_tmp / "subsession-active-5678"
    active.mkdir()
    unrelated = fake_tmp / "other-dir"
    unrelated.mkdir()

    with (
        patch("orchestrator.worktree.Path") as mock_path_cls,
        patch("orchestrator.worktree.shutil.rmtree") as mock_rmtree,
        patch("orchestrator.worktree.subprocess.run"),
    ):
        mock_path_cls.return_value.iterdir.return_value = [orphan, active, unrelated]
        mock_path_cls.return_value.__str__ = lambda s: "/tmp"

        # Simular Path("/tmp").iterdir() corretamente
        from pathlib import Path as RealPath

        def fake_path(arg):
            if arg == "/tmp":
                m = MagicMock()
                m.iterdir.return_value = [orphan, active, unrelated]
                return m
            return RealPath(arg)

        mock_path_cls.side_effect = fake_path

        removed = sweep_orphan_worktrees_sync(
            workspace_paths=["/fake/ws"],
            active_worktree_paths={str(active)},
        )

    mock_rmtree.assert_called_once_with(str(orphan), ignore_errors=True)
    assert removed == 1
