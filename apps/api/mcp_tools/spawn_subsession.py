"""Tool MCP spawn_subsession — cria subsessão filho com worktree isolado.

Schema de input (MCP spec 2025-11-25):
    { task_id, agent_slug, prompt, visibility, metadata? }

Retorno imediato (não síncrono):
    { subsession_id, session_name, status: "starting" }

Side effects:
    - git worktree add /tmp/subsession-<id> HEAD (worktree sempre, sem regex Edit/Write)
    - tmux session sub-<slug>-<short_id> com claude --bg
    - _subagent_state[slug][subsession_id] atualizado
    - task_event kind=subagent_started gravado no DB
"""
from __future__ import annotations

import asyncio
import re
import shlex
import subprocess
import uuid
from pathlib import Path
from typing import Any

import libtmux
from libtmux import exc as libtmux_exc
from pydantic import BaseModel, Field

from orchestrator.jsonl_watcher import register_spawned_subagent

_REPOS_ROOT = Path("/home/clawd/repos").resolve()
_UNSAFE_WORKSPACE_CHARS = re.compile(r"[;&|\n\r\0]")
_PROMPT_MAX = 8_192


class SpawnSubsessionInput(BaseModel):
    task_id: str = Field(min_length=1, max_length=128)
    agent_slug: str = Field(min_length=1, max_length=64)
    prompt: str = Field(min_length=1, max_length=_PROMPT_MAX)
    visibility: bool
    metadata: dict[str, Any] | None = None


def _check_no_dirty_index(workspace_path: str) -> None:
    """Falha se há mudanças não-commitadas (staged ou unstaged) em arquivos rastreados.

    Usa `git diff HEAD --quiet` em vez de --porcelain: ignora untracked files (como
    .claude/ gerado pelo CC em runtime) que não afetam o worktree de HEAD.
    """
    result = subprocess.run(
        ["git", "diff", "HEAD", "--quiet"],
        cwd=workspace_path,
        capture_output=True,
        timeout=5,
    )
    if result.returncode == 1:
        raise ValueError(
            "Workspace pai tem mudanças não-commitadas — commita antes de spawnar"
        )
    if result.returncode != 0:
        raise ValueError(
            f"git diff HEAD falhou em {workspace_path}: {result.stderr.decode(errors='replace').strip()}"
        )


def _create_worktree_sync(workspace_path: str, worktree_path: str) -> None:
    subprocess.run(
        ["git", "worktree", "add", worktree_path, "HEAD"],
        cwd=workspace_path,
        check=True,
        capture_output=True,
        timeout=15,
    )


def _launch_in_tmux_sync(session_name: str, worktree_path: str, prompt: str) -> None:
    server = libtmux.Server()
    session = server.new_session(session_name=session_name, detached=True, kill_session=False)
    pane = session.active_pane
    cmd = (
        f"cd {shlex.quote(worktree_path)} && "
        f"claude --dangerously-skip-permissions --bg {shlex.quote(prompt)}"
    )
    pane.send_keys(cmd)


def _cleanup_worktree_sync(workspace_path: str, worktree_path: str) -> None:
    """Remove worktree com força — chamado em rollback e cleanup de stalled."""
    subprocess.run(
        ["git", "worktree", "remove", "--force", worktree_path],
        cwd=workspace_path,
        capture_output=True,
        timeout=10,
    )


def _kill_tmux_session_sync(session_name: str) -> None:
    """Remove sessão tmux se existir — chamado em rollback."""
    server = libtmux.Server()
    if server.has_session(session_name):
        server.kill_session(session_name)


async def spawn_subsession(
    slug: str,
    workspace_path: str,
    payload: SpawnSubsessionInput,
    db: Any,
) -> dict[str, Any]:
    """Cria worktree isolado + tmux session + registra subsessão.

    Raises ValueError com mensagem descritiva em caso de pré-condição falha.
    Raises libtmux_exc.LibTmuxException se tmux falhar.
    """
    if _UNSAFE_WORKSPACE_CHARS.search(workspace_path):
        raise ValueError("workspace_path contém caracteres inseguros")

    resolved = Path(workspace_path).resolve()
    if not resolved.is_relative_to(_REPOS_ROOT):
        raise ValueError(f"workspace_path fora de {_REPOS_ROOT}: {workspace_path}")

    subsession_id = str(uuid.uuid4())
    short_id = subsession_id[:8]
    session_name = f"sub-{slug}-{short_id}"
    worktree_path = f"/tmp/subsession-{subsession_id}"

    # 1. Dirty index check — falha rápido antes de criar worktree
    await asyncio.to_thread(_check_no_dirty_index, workspace_path)

    # 2. Worktree isolado (worktree sempre — regra cardinal v2)
    try:
        await asyncio.to_thread(_create_worktree_sync, workspace_path, worktree_path)
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode(errors="replace").strip()
        raise ValueError(f"git worktree add falhou: {stderr}") from exc

    # 3. Tmux session + claude --bg
    try:
        await asyncio.to_thread(_launch_in_tmux_sync, session_name, worktree_path, payload.prompt)
    except libtmux_exc.LibTmuxException:
        # Cleanup worktree se tmux falhou
        await asyncio.to_thread(_cleanup_worktree_sync, workspace_path, worktree_path)
        raise

    # Steps 4-5 com cleanup de fallback: worktree + tmux session já existem aqui.
    # Se qualquer etapa falhar, removemos para não deixar recursos órfãos.
    try:
        # 4. Registra em _subagent_state + emite evento SSE
        register_spawned_subagent(
            slug,
            subsession_id,
            task_id=payload.task_id,
            session_name=session_name,
            worktree_path=worktree_path,
            workspace_path=workspace_path,
            visibility=payload.visibility,
            agent_slug=payload.agent_slug,
        )

        # 5. Persiste evento no DB
        await db.insert_task_event(
            "subagent_started",
            task_id=payload.task_id,
            agent_slug=slug,
            payload={
                "subsession_id": subsession_id,
                "session_name": session_name,
                "worktree_path": worktree_path,
                "visibility": payload.visibility,
                "agent_slug": payload.agent_slug,
                "prompt_preview": payload.prompt[:200],
            },
        )
    except Exception:
        # Cleanup best-effort: worktree + tmux session criados nos steps 2-3
        await asyncio.to_thread(_cleanup_worktree_sync, workspace_path, worktree_path)
        await asyncio.to_thread(_kill_tmux_session_sync, session_name)
        raise

    return {
        "subsession_id": subsession_id,
        "session_name": session_name,
        "status": "starting",
    }
