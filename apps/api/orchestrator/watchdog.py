"""
Watchdog — verifica timeout de tasks e detecta STATE: via capture-pane.

Roda como background task no lifespan (opt-in via GB_WATCHDOG_ENABLED).
Tick a cada GB_WATCHDOG_INTERVAL_SECONDS (default 30s):
  1. mark_stale_runs — move tasks running > heartbeat_timeout_seconds pra blocked
  2. capture-pane — lê output de cada agente com task running e detecta STATE:
     Idempotência via content_hash garante que o mesmo checkpoint não é gravado 2×.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import subprocess
from typing import Any

from orchestrator.checkpoint_parser import checkpoint_hash, parse_checkpoint

logger = logging.getLogger(__name__)


class Watchdog:
    def __init__(
        self,
        *,
        db,
        interval_seconds: float,
    ) -> None:
        self._db = db
        self._interval_seconds = max(interval_seconds, 5.0)
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="watchdog")

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
                logger.exception("Watchdog tick crashed")

            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=self._interval_seconds,
                )
            except TimeoutError:
                pass

    async def _tick(self) -> None:
        # 1. Timeout: move tasks running > per-task heartbeat_timeout_seconds → blocked
        stale = await self._db.mark_stale_runs()
        if stale:
            logger.info("Watchdog: %d task(s) marcadas como timed_out", len(stale))

        # 2. Capture-pane: detecta STATE: nos panes de agentes com tasks running
        running = await self._db.list_tasks(status="running", limit=50)
        if not running:
            return

        # Agrupa por assignee pra não capturar o mesmo pane várias vezes
        seen_sessions: dict[str, str] = {}  # tmux_session → task_id
        for task in running:
            agent = await self._db.get_agent(task["assignee"])
            if agent is None or not agent.get("tmux_session"):
                continue
            session = agent["tmux_session"]
            if session in seen_sessions:
                continue
            seen_sessions[session] = task["id"]

        for session, task_id in seen_sessions.items():
            await self._check_pane(session, task_id)

    async def _check_pane(self, tmux_session: str, task_id: str) -> None:
        pane_text = await asyncio.to_thread(_capture_pane, tmux_session)
        if not pane_text:
            return

        cp = parse_checkpoint(pane_text)
        if cp is None:
            return

        chash = checkpoint_hash(
            state=cp["state"],
            summary=cp.get("summary"),
            files_changed=cp.get("files_changed"),
            next_step=cp.get("next_step"),
        )
        result = await self._db.record_checkpoint(
            task_id=task_id,
            agent_slug=None,
            state=cp["state"],
            summary=cp.get("summary"),
            files_changed=cp.get("files_changed"),
            next_step=cp.get("next_step"),
            handoff_to=cp.get("handoff_to"),
            content_hash=chash,
            source="capture_pane",
        )
        if result:
            logger.info(
                "Watchdog capture-pane: task %s → STATE:%s", task_id, cp["state"]
            )


def _capture_pane(tmux_session: str) -> str | None:
    """Captura últimas ~200 linhas do pane tmux. Retorna None se sessão não existe."""
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-p", "-t", tmux_session, "-S", "-200"],
            capture_output=True,
            text=True,
            timeout=3.0,
        )
        if result.returncode != 0:
            return None
        return result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
