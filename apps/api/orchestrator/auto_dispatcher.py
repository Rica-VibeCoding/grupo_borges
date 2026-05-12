"""Dispatcher automatico opt-in para tasks `ready`.

Contrato Fase 4.5:
  - `ready` = autorizada para dispatch automatico.
  - `backlog` = controle manual/rascunho, nunca consumido pelo loop.
  - claim atomico no SQLite continua sendo a fronteira contra corrida.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from services import tmux_driver

logger = logging.getLogger(__name__)


class AutoDispatcher:
    def __init__(
        self,
        *,
        db,
        interval_seconds: float,
        batch_size: int,
    ) -> None:
        self._db = db
        self._interval_seconds = max(interval_seconds, 1.0)
        self._batch_size = max(batch_size, 1)
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="auto-dispatcher")

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
                logger.exception("AutoDispatcher tick crashed")

            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=self._interval_seconds,
                )
            except TimeoutError:
                pass

    async def _tick(self) -> None:
        await self._db.mark_stale_runs()
        for _ in range(self._batch_size):
            claimed = await self._db.claim_next_ready_dispatch(
                note="auto-dispatch"
            )
            if claimed is None:
                return
            await self._deliver_claim(claimed)

    async def _deliver_claim(self, claimed: dict[str, Any]) -> None:
        task = claimed["task"]
        run_id = claimed["run_id"]
        tmux_session = claimed["tmux_session"]
        dispatch_text = _format_dispatch_message(task=task, note=claimed.get("note"))

        try:
            delivered = await tmux_driver.send_message(tmux_session, dispatch_text)
        except Exception:
            await self._db.record_task_dispatch_failed(
                task["id"],
                run_id=run_id,
                tmux_session=tmux_session,
                reason="tmux_exception",
                source="auto",
            )
            logger.exception(
                "AutoDispatcher failed to send task %s to tmux session %s",
                task["id"],
                tmux_session,
            )
            return

        if not delivered:
            await self._db.record_task_dispatch_failed(
                task["id"],
                run_id=run_id,
                tmux_session=tmux_session,
                reason="tmux_session_not_found",
                source="auto",
            )
            logger.warning(
                "AutoDispatcher tmux session not found: %s for task %s",
                tmux_session,
                task["id"],
            )
            return

        await self._db.record_task_dispatch_delivered(
            task["id"],
            run_id=run_id,
            tmux_session=tmux_session,
            note=claimed.get("note"),
            source="auto",
        )


def _format_dispatch_message(*, task: dict[str, Any], note: str | None) -> str:
    note_text = (note or "").strip()
    display_id = task.get("human_id") or task["id"]
    lines = [
        "Nova missão via cockpit",
        f"Task: {display_id} ({task['id']})",
        f"Título: {task['title']}",
    ]
    body = (task.get("body") or "").strip()
    if body:
        lines.append(f"Body: {body}")
    if note_text:
        lines.append(f"Nota: {note_text}")
    lines.append("Ao iniciar, mantenha esta task como referência no retorno.")
    return "\n".join(lines)
