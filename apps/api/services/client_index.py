"""Checkpoint por arquivo para indexar histórico completo sem reler tudo no boot."""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path

from orchestrator.jsonl_watcher import JsonlWatcher, jsonl_source_key


def _read_batch(path: Path, offset: int) -> tuple[list[tuple[str, int]], int]:
    lines = []
    end = offset
    with path.open("rb") as handle:
        handle.seek(offset)
        for _ in range(256):
            raw = handle.readline()
            if not raw or not raw.endswith(b"\n"):
                break
            end = handle.tell()
            if raw.strip():
                lines.append((raw.decode("utf-8", errors="replace").rstrip("\n"), end))
    return lines, end


class ClientIndex:
    def __init__(self, path: Path):
        self.path = path
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            self.state = data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            self.state = {}

    def offset(self, path: Path) -> int:
        try:
            stat = path.stat()
        except OSError:
            return 0
        previous = self.state.get(str(path), {})
        saved = previous.get("offset") if isinstance(previous, dict) else None
        if isinstance(previous, dict) and previous.get("inode") == stat.st_ino and isinstance(saved, int) and 0 <= saved <= stat.st_size:
            return saved
        return 0

    async def save(self, path: Path, offset: int) -> None:
        await asyncio.to_thread(self._save, path, offset)

    def _save(self, path: Path, offset: int) -> None:
        self.state[str(path)] = {"inode": path.stat().st_ino, "offset": offset}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=self.path.parent,
                                         prefix=".offsets-", delete=False, encoding="utf-8") as handle:
            json.dump(self.state, handle, separators=(",", ":"))
            temp = handle.name
        os.chmod(temp, 0o600)
        os.replace(temp, self.path)

    async def backfill(self, watcher: JsonlWatcher, slug: str, paths: list[Path]) -> None:
        for path in paths:
            offset = self.offset(path)
            watcher._offsets[str(path)] = offset
            while True:
                try:
                    batch, end = await asyncio.to_thread(_read_batch, path, offset)
                except FileNotFoundError:
                    break
                if end == offset:
                    break
                for line, line_end in batch:
                    await watcher._processar_linha(
                        slug, line, source_key=jsonl_source_key(path, line_end, line)
                    )
                offset = end
                watcher._offsets[str(path)] = offset
                await watcher._db.upsert_agent_state(slug, jsonl_path=str(path))
                await self.save(path, offset)
