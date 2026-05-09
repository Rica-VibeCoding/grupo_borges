"""
JsonlWatcher — observa append-only writes em JSONLs do Claude Code.

Watcheia ~/.claude/projects/ (raiz, recursivo). Filtra por:
  - extensão .jsonl
  - encoded-cwd (subpasta) que bate com workspace_path de algum agente conhecido

Inicialização (start):
  - Pré-popula `_offsets` com o tamanho atual de cada JSONL conhecido.
    Isso evita o cenário de OOM onde o watcher acabou de subir e o primeiro
    Change.modified faria leitura de 0 → tail num arquivo de centenas de MB,
    com replay de todo histórico no DB.

Por arquivo, mantém último offset lido. Em cada Change.modified, lê só os
bytes novos, parseia linhas completas e dispara para o DB:
  - insert_task_event(kind=f"jsonl:{type}", agent_slug=slug, payload=parsed, raw_jsonl=line)
  - upsert_agent_state(slug, jsonl_path=path)

Encoded-cwd format do CC (validado contra ~/.claude/projects/ real em PC e VPS):
  todo char fora de [A-Za-z0-9-] vira '-', sem consolidar consecutivos.
    /home/clawd/repos/ze_claude/daniel       → -home-clawd-repos-ze-claude-daniel
    C:\\...\\projetos\\ze claude\\daniel     → C--Users-...-projetos-ze-claude-daniel
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path

from watchfiles import Change, awatch

from util import parse_dict_or_none

logger = logging.getLogger(__name__)

_NON_ENCODED_CHAR = re.compile(r"[^A-Za-z0-9-]")


def encoded_cwd(workspace_path: str) -> str:
    return _NON_ENCODED_CHAR.sub("-", workspace_path)


class JsonlWatcher:
    def __init__(
        self,
        *,
        claude_projects_dir: str,
        agents: list[dict],
        db,  # GrupoBorgesDB — não importamos pra evitar ciclo
    ) -> None:
        self._root = Path(claude_projects_dir)
        self._root_resolved = self._root.resolve() if self._root.exists() else self._root
        self._db = db
        self._slug_by_encoded: dict[str, str] = {
            encoded_cwd(a["workspace_path"]): a["slug"] for a in agents
        }
        self._offsets: dict[str, int] = {}
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        await asyncio.to_thread(self._prepopulate_offsets)
        self._task = asyncio.create_task(self._run(), name="jsonl-watcher")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # ---------- internals ----------

    def _prepopulate_offsets(self) -> None:
        """Marca cada JSONL existente como 'já lido até o tamanho atual'.

        Sem isso, no primeiro Change.modified leríamos do byte 0 — replay
        gigante e potencial OOM. Também loga warning se nenhum dos slugs
        configurados tem pasta correspondente (config provavelmente errada).
        """
        if not self._root.exists():
            logger.warning("JSONL watcher: %s não existe — watcher inativo", self._root)
            return

        found_slugs: set[str] = set()
        for encoded, slug in self._slug_by_encoded.items():
            agent_dir = self._root / encoded
            if not agent_dir.is_dir():
                continue
            found_slugs.add(slug)
            for jsonl in agent_dir.rglob("*.jsonl"):
                try:
                    self._offsets[str(jsonl)] = jsonl.stat().st_size
                except OSError:
                    continue

        missing = set(self._slug_by_encoded.values()) - found_slugs
        if missing:
            logger.warning(
                "JSONL watcher: nenhuma pasta encoded-cwd encontrada em %s pros agentes: %s",
                self._root,
                sorted(missing),
            )

    async def _run(self) -> None:
        if not self._root.exists():
            return  # já avisado em _prepopulate_offsets
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
            rel = Path(path).resolve().relative_to(self._root_resolved)
        except ValueError:
            return None
        return self._slug_by_encoded.get(rel.parts[0]) if rel.parts else None

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
            payload = parse_dict_or_none(line)
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
