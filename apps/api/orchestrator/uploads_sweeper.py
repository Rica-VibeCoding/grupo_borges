"""Sweep periódico de uploads/agents/<slug>/*: retenção por idade.

O timestamp de criação (ms) já está NO NOME do arquivo — `routers/agents.py`
grava `{timestamp_ms}-{uuid}{ext}` — então decidir idade nunca precisa de
`stat()`. Canário é benchmark sintético (não histórico do Rica) e tem teto
próprio, mais curto que o dos agentes reais.

Não mexe em `uploads/tasks/` — mecanismo de upload diferente, fora do escopo.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_STORED_NAME_RE = re.compile(r"^(\d{13})-[0-9a-f]{12}\.")
_CANARIO_SLUG = "canario"


def _file_age_days(name: str, *, now_ms: int) -> float | None:
    """None quando o nome não segue o padrão gravado pela `POST /file`."""
    match = _STORED_NAME_RE.match(name)
    if match is None:
        return None
    created_ms = int(match.group(1))
    return (now_ms - created_ms) / 86_400_000


def sweep_uploads_once(
    *,
    uploads_base: Path,
    retention_days: float,
    retention_days_canario: float,
) -> list[Path]:
    """Remove uploads de agente além da retenção. Retorna os paths removidos."""
    removed: list[Path] = []
    if not uploads_base.is_dir():
        return removed

    now_ms = int(time.time() * 1000)
    for slug_dir in uploads_base.iterdir():
        if not slug_dir.is_dir():
            continue
        limit = retention_days_canario if slug_dir.name == _CANARIO_SLUG else retention_days
        for file_path in slug_dir.iterdir():
            if not file_path.is_file():
                continue
            age_days = _file_age_days(file_path.name, now_ms=now_ms)
            if age_days is None or age_days <= limit:
                continue
            try:
                file_path.unlink()
                removed.append(file_path)
            except OSError:
                logger.warning("uploads_sweeper: falha ao remover %s", file_path, exc_info=True)
    return removed


class UploadsSweeper:
    """Loop asyncio periódico — mesmo padrão do `SubsessionSweeper`."""

    def __init__(
        self,
        *,
        uploads_base: Path,
        retention_days: float,
        retention_days_canario: float,
        interval_seconds: float = 3600.0,
    ) -> None:
        self._uploads_base = uploads_base
        self._retention_days = retention_days
        self._retention_days_canario = retention_days_canario
        self._interval = max(interval_seconds, 60.0)
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="uploads-sweeper")

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
                logger.exception("UploadsSweeper tick crashed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._interval)
            except TimeoutError:
                pass

    async def _tick(self) -> None:
        removed = await asyncio.to_thread(
            sweep_uploads_once,
            uploads_base=self._uploads_base,
            retention_days=self._retention_days,
            retention_days_canario=self._retention_days_canario,
        )
        if removed:
            logger.info("uploads_sweeper: removidos %d arquivos velhos", len(removed))
