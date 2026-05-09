"""
JsonlWatcher — observa append-only writes em JSONLs do Claude Code.

Watcheia ~/.claude/projects/ (raiz, recursivo). Filtra por:
  - extensão .jsonl
  - encoded-cwd (subpasta) que bate com workspace_path de algum agente conhecido

Por arquivo, mantém último offset lido. Em cada Change.modified, lê só os
bytes novos, parseia linhas completas e dispara para o DB:
  - insert_task_event(kind=f"jsonl:{type}", agent_slug=slug, payload=parsed, raw_jsonl=line)
  - upsert_agent_state(slug, jsonl_path=path)

Encoded-cwd format do CC (briefing #003): / e \\ → -, : → -.
  /home/clawd/repos/ze_claude/daniel → -home-clawd-repos-ze_claude-daniel
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from watchfiles import Change, awatch

logger = logging.getLogger(__name__)


def encoded_cwd(workspace_path: str) -> str:
    return workspace_path.replace("/", "-").replace("\\", "-").replace(":", "-")


class JsonlWatcher:
    def __init__(
        self,
        *,
        claude_projects_dir: str,
        agents: list[dict],
        db,  # GrupoBorgesDB — não importamos pra evitar ciclo
    ) -> None:
        self._root = Path(claude_projects_dir)
        self._db = db
        self._slug_by_encoded: dict[str, str] = {
            encoded_cwd(a["workspace_path"]): a["slug"] for a in agents
        }
        self._offsets: dict[str, int] = {}
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="jsonl-watcher")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        if not self._root.exists():
            logger.warning(
                "JSONL watcher: %s não existe — watcher inativo", self._root
            )
            return
        try:
            async for changes in awatch(
                str(self._root),
                stop_event=self._stop,
                watch_filter=self._filter,
                recursive=True,
            ):
                for change_type, raw_path in changes:
                    if change_type != Change.modified:
                        continue
                    await self._process_jsonl(Path(raw_path))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("JSONL watcher crashed")

    def _filter(self, change: Change, path: str) -> bool:
        if not path.endswith(".jsonl"):
            return False
        return self._slug_for_path(path) is not None

    def _slug_for_path(self, path: str) -> str | None:
        try:
            rel = Path(path).resolve().relative_to(self._root.resolve())
        except ValueError:
            return None
        if not rel.parts:
            return None
        return self._slug_by_encoded.get(rel.parts[0])

    async def _process_jsonl(self, path: Path) -> None:
        slug = self._slug_for_path(str(path))
        if slug is None:
            return
        last_offset = self._offsets.get(str(path), 0)
        try:
            new_lines, new_offset = await asyncio.to_thread(
                _read_appended, path, last_offset
            )
        except FileNotFoundError:
            return
        if not new_lines:
            return
        self._offsets[str(path)] = new_offset

        for line in new_lines:
            payload: dict | None
            try:
                parsed = json.loads(line)
                payload = parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                payload = None
            event_type = (payload or {}).get("type") or "unknown"
            await self._db.insert_task_event(
                kind=f"jsonl:{event_type}",
                agent_slug=slug,
                payload=payload,
                raw_jsonl=line,
            )

        await self._db.upsert_agent_state(slug, jsonl_path=str(path))


def _read_appended(path: Path, offset: int) -> tuple[list[str], int]:
    """Lê do offset até o último \\n do arquivo. Retorna (linhas_completas, novo_offset).

    Linha incompleta no final (CC ainda escrevendo) fica pra próxima iteração.
    Se o arquivo encolheu (truncado/recriado), reinicia do zero.
    """
    with path.open("rb") as f:
        f.seek(0, 2)
        size = f.tell()
        if size == offset:
            return [], offset
        if size < offset:
            offset = 0  # truncated — reset
        f.seek(offset)
        data = f.read(size - offset)
    if not data:
        return [], size
    last_newline = data.rfind(b"\n")
    if last_newline == -1:
        return [], offset  # nada completo ainda
    consumed_bytes = data[: last_newline + 1]
    new_offset = offset + len(consumed_bytes)
    text = consumed_bytes.decode("utf-8", errors="replace")
    lines = [ln for ln in text.split("\n") if ln.strip()]
    return lines, new_offset
