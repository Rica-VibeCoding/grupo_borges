"""
GrupoBorgesDB — wrapper sqlite3 async-friendly.

sqlite3 é síncrono — todo IO via asyncio.to_thread.
WAL + busy_timeout via PRAGMAs aplicados pelo schema.sql.
Idempotente (CREATE TABLE IF NOT EXISTS).

Concorrência:
  - WAL permite leitores concorrentes
  - 1 escritor de cada vez via asyncio.Lock (write queue MVP)
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


class GrupoBorgesDB:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._write_lock = asyncio.Lock()
        self._conn: sqlite3.Connection | None = None

    # ---------- lifecycle ----------

    async def startup(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(self._connect_and_apply_schema)

    def _connect_and_apply_schema(self) -> None:
        # check_same_thread=False: chamadas vêm de várias threads via to_thread
        # isolation_level=None: autocommit; transações explícitas via `with conn`
        conn = sqlite3.connect(
            self.db_path, check_same_thread=False, isolation_level=None
        )
        conn.row_factory = sqlite3.Row
        with SCHEMA_PATH.open("r", encoding="utf-8") as f:
            conn.executescript(f.read())
        self._conn = conn

    async def shutdown(self) -> None:
        if self._conn is not None:
            await asyncio.to_thread(self._conn.close)
            self._conn = None

    # ---------- agents ----------

    async def sync_agents_from_yaml(self, agents: list[dict[str, Any]]) -> None:
        async with self._write_lock:
            await asyncio.to_thread(self._sync_agents, agents)

    def _sync_agents(self, agents: list[dict[str, Any]]) -> None:
        now = int(time.time())
        with self._conn:
            for a in agents:
                self._conn.execute(
                    """
                    INSERT INTO agents (slug, name, role, emoji, tmux_session, workspace_path,
                                        cli_default, model_default, capabilities, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(slug) DO UPDATE SET
                        name           = excluded.name,
                        role           = excluded.role,
                        emoji          = excluded.emoji,
                        tmux_session   = excluded.tmux_session,
                        workspace_path = excluded.workspace_path,
                        cli_default    = excluded.cli_default,
                        model_default  = excluded.model_default,
                        capabilities   = excluded.capabilities,
                        updated_at     = excluded.updated_at
                    """,
                    (
                        a["slug"],
                        a["name"],
                        a.get("role"),
                        a.get("emoji"),
                        a["tmux_session"],
                        a["workspace_path"],
                        a.get("cli_default", "claude_code"),
                        a["model_default"],
                        json.dumps(a.get("capabilities", []), ensure_ascii=False),
                        now,
                        now,
                    ),
                )
                self._conn.execute(
                    """
                    INSERT INTO agent_state (slug, instance_count)
                    VALUES (?, 0)
                    ON CONFLICT(slug) DO NOTHING
                    """,
                    (a["slug"],),
                )

    async def list_agents(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_agents)

    def _list_agents(self) -> list[dict[str, Any]]:
        cur = self._conn.execute(
            """
            SELECT a.*, s.cli AS state_cli, s.model AS state_model,
                   s.current_task_id, s.last_seen, s.pane_excerpt, s.instance_count
            FROM agents a
            LEFT JOIN agent_state s ON s.slug = a.slug
            ORDER BY a.slug
            """
        )
        return [self._row_to_agent(row) for row in cur.fetchall()]

    async def get_agent(self, slug: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_agent, slug)

    def _get_agent(self, slug: str) -> dict[str, Any] | None:
        cur = self._conn.execute(
            """
            SELECT a.*, s.cli AS state_cli, s.model AS state_model,
                   s.current_task_id, s.last_seen, s.pane_excerpt, s.instance_count
            FROM agents a
            LEFT JOIN agent_state s ON s.slug = a.slug
            WHERE a.slug = ?
            """,
            (slug,),
        )
        row = cur.fetchone()
        return self._row_to_agent(row) if row is not None else None

    @staticmethod
    def _row_to_agent(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        raw = d.get("capabilities")
        if raw:
            try:
                d["capabilities"] = json.loads(raw)
            except json.JSONDecodeError:
                d["capabilities"] = []
        else:
            d["capabilities"] = []
        return d

    # ---------- agent_state (heartbeat / pane excerpt) ----------

    async def upsert_agent_state(
        self,
        slug: str,
        *,
        cli: str | None = None,
        model: str | None = None,
        current_task_id: str | None = None,
        jsonl_path: str | None = None,
        pane_excerpt: str | None = None,
    ) -> None:
        async with self._write_lock:
            await asyncio.to_thread(
                self._upsert_agent_state,
                slug, cli, model, current_task_id, jsonl_path, pane_excerpt,
            )

    def _upsert_agent_state(
        self, slug, cli, model, current_task_id, jsonl_path, pane_excerpt
    ) -> None:
        # Pre-condição: linha existe (sync_agents_from_yaml garante no startup)
        now = int(time.time())
        sets = ["last_seen = ?"]
        vals: list[Any] = [now]
        if cli is not None:
            sets.append("cli = ?")
            vals.append(cli)
        if model is not None:
            sets.append("model = ?")
            vals.append(model)
        if current_task_id is not None:
            sets.append("current_task_id = ?")
            vals.append(current_task_id)
        if jsonl_path is not None:
            sets.append("jsonl_path = ?")
            vals.append(jsonl_path)
        if pane_excerpt is not None:
            sets.append("pane_excerpt = ?")
            vals.append(pane_excerpt)
        sql = f"UPDATE agent_state SET {', '.join(sets)} WHERE slug = ?"
        vals.append(slug)
        with self._conn:
            self._conn.execute(sql, vals)

    # ---------- task_events ----------

    async def insert_task_event(
        self,
        kind: str,
        *,
        task_id: str | None = None,
        agent_slug: str | None = None,
        instance_id: str | None = None,
        payload: dict[str, Any] | None = None,
        raw_jsonl: str | None = None,
    ) -> int:
        async with self._write_lock:
            return await asyncio.to_thread(
                self._insert_task_event,
                kind, task_id, agent_slug, instance_id, payload, raw_jsonl,
            )

    def _insert_task_event(
        self, kind, task_id, agent_slug, instance_id, payload, raw_jsonl
    ) -> int:
        cur = self._conn.execute(
            """
            INSERT INTO task_events (task_id, agent_slug, instance_id, kind, payload, raw_jsonl, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                agent_slug,
                instance_id,
                kind,
                json.dumps(payload, ensure_ascii=False) if payload is not None else None,
                raw_jsonl,
                int(time.time()),
            ),
        )
        return cur.lastrowid

    async def list_events_after(self, after_id: int, limit: int = 200) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_events_after, after_id, limit)

    def _list_events_after(self, after_id: int, limit: int) -> list[dict[str, Any]]:
        cur = self._conn.execute(
            """
            SELECT id, task_id, agent_slug, instance_id, kind, payload, created_at
            FROM task_events
            WHERE id > ?
            ORDER BY id ASC
            LIMIT ?
            """,
            (after_id, limit),
        )
        result: list[dict[str, Any]] = []
        for row in cur.fetchall():
            d = dict(row)
            if d.get("payload"):
                try:
                    d["payload"] = json.loads(d["payload"])
                except json.JSONDecodeError:
                    pass
            result.append(d)
        return result

    async def max_event_id(self) -> int:
        return await asyncio.to_thread(self._max_event_id)

    def _max_event_id(self) -> int:
        cur = self._conn.execute("SELECT COALESCE(MAX(id), 0) AS max_id FROM task_events")
        row = cur.fetchone()
        return int(row["max_id"]) if row is not None else 0
