"""Worktree lifecycle helpers para subsessões spawned_by_tool (LB-9 Bloco 5).

cleanup_worktree_sync  — chamado ao stallar/finalizar subsessão tool-spawned.
sweep_orphan_worktrees_sync — chamado no boot pra limpar /tmp/subsession-* sem estado.
SubsessionSweeper — loop asyncio periódico que drena stalled + chama cleanup.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import shutil
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Prefixo obrigatório de worktrees de subsessão (segurança: nunca remover outros /tmp/*).
_SUBSESSION_PREFIX = "subsession-"


def cleanup_worktree_sync(
    *,
    workspace_path: str,
    worktree_path: str,
    subsession_id: str,
) -> None:
    """Remove worktree de subsessão concluída ou stalled.

    Branch com commits à frente do workspace pai → log warning, preserva.
    Branch sem commits extras → git worktree remove --force.
    Worktree inexistente → no-op silencioso.
    """
    wt = Path(worktree_path)
    if not wt.exists():
        return

    try:
        parent_head_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=workspace_path,
            capture_output=True,
            timeout=5,
        )
        if parent_head_result.returncode != 0:
            logger.warning("Falha ao resolver HEAD do workspace %s — preservando worktree %s", workspace_path, worktree_path)
            return
        parent_head = parent_head_result.stdout.strip().decode(errors="replace")

        ahead_result = subprocess.run(
            ["git", "rev-list", "--count", "HEAD", f"^{parent_head}"],
            cwd=worktree_path,
            capture_output=True,
            timeout=5,
        )
        if ahead_result.returncode == 0:
            count = int(ahead_result.stdout.strip() or "0")
            if count > 0:
                logger.warning(
                    "subsessão %s tem %d commit(s) não-merged em %s — worktree preservado",
                    subsession_id,
                    count,
                    worktree_path,
                )
                return
    except Exception:
        logger.warning(
            "Falha ao verificar commits em %s — preservando por precaução", worktree_path, exc_info=True
        )
        return

    result = subprocess.run(
        ["git", "worktree", "remove", "--force", worktree_path],
        cwd=workspace_path,
        capture_output=True,
        timeout=10,
    )
    if result.returncode != 0:
        logger.warning(
            "git worktree remove falhou para %s (rc=%d): %s",
            worktree_path,
            result.returncode,
            result.stderr.decode(errors="replace").strip(),
        )
    else:
        logger.debug("Worktree %s removido (subsessão %s)", worktree_path, subsession_id)


def _tmux_subsession_worktrees() -> set[str]:
    """Reconcilia worktrees /tmp/subsession-* com tmux sessions sub-* vivas.

    Em hot-reload da API (dev) ou restart com sessões legítimas em curso,
    _subagent_state nasce vazio mas o tmux ainda hospeda claude --bg em
    /tmp/subsession-<id>. Sem esse check o boot sweep apagaria o cwd do
    processo vivo. Best-effort: falha silenciosa preserva tudo.
    """
    paths: set[str] = set()
    try:
        result = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, text=True, timeout=5,
        )
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return paths
    for name in (line.strip() for line in result.stdout.splitlines()):
        if not name.startswith("sub-"):
            continue
        try:
            cwd_result = subprocess.run(
                ["tmux", "display-message", "-t", name, "-p", "#{pane_current_path}"],
                capture_output=True, text=True, timeout=5,
            )
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            continue
        cwd = cwd_result.stdout.strip()
        if cwd.startswith(f"/tmp/{_SUBSESSION_PREFIX}"):
            paths.add(cwd)
    return paths


def sweep_orphan_worktrees_sync(
    workspace_paths: list[str],
    active_worktree_paths: set[str],
) -> int:
    """Remove /tmp/subsession-* sem entrada ativa em _subagent_state nem em tmux.

    Chamado no boot da API após reboot. Reconcilia com tmux pra não apagar
    worktrees de subsessões legítimas em curso (cenário hot-reload em dev).
    Retorna quantidade de diretórios removidos.
    """
    protected = set(active_worktree_paths) | _tmux_subsession_worktrees()
    removed = 0
    with contextlib.suppress(OSError):
        for entry in Path("/tmp").iterdir():
            if not entry.name.startswith(_SUBSESSION_PREFIX):
                continue
            if str(entry) in protected:
                continue
            shutil.rmtree(str(entry), ignore_errors=True)
            removed += 1
            logger.info("Boot sweep: removido worktree órfão %s", entry)

    for ws in workspace_paths:
        with contextlib.suppress(Exception):
            subprocess.run(
                ["git", "worktree", "prune"],
                cwd=ws,
                capture_output=True,
                timeout=10,
            )

    return removed


class SubsessionSweeper:
    """Sweep periódico: stall detection com TTL 10min + worktree cleanup.

    Complementa mark_stalled_subagents (chamado no SSE tick por slug) cobrindo
    subsessões tool-spawned que nunca atualizam last_seen_ms via JSONL.
    """

    def __init__(self, *, interval_seconds: float = 300.0) -> None:
        self._interval = max(interval_seconds, 60.0)
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="subsession-sweeper")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("SubsessionSweeper tick crashed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._interval)
            except TimeoutError:
                pass

    async def _tick(self) -> None:
        from orchestrator.jsonl_watcher import mark_stalled_all_slugs

        stalled: list[dict[str, Any]] = await asyncio.to_thread(mark_stalled_all_slugs)
        for entry in stalled:
            if not entry.get("spawned_by_tool"):
                continue
            worktree_path = entry.get("worktree_path", "")
            workspace_path = entry.get("workspace_path", "")
            subsession_id = entry.get("parent_uuid", "")
            session_name = entry.get("session_name", "")

            if session_name:
                await _kill_tmux(session_name)

            if worktree_path and workspace_path and subsession_id:
                await asyncio.to_thread(
                    cleanup_worktree_sync,
                    workspace_path=workspace_path,
                    worktree_path=worktree_path,
                    subsession_id=subsession_id,
                )


async def _kill_tmux(session_name: str) -> None:
    from services import tmux_driver

    await tmux_driver.kill_session_if_exists(session_name)
