"""
GrupoBorgesDB — wrapper sqlite3 async-friendly com connection-per-call.

Concorrência:
  - connection-per-call: cada operação abre/fecha sua própria connection.
    Custo ~0.1-1ms; trivial em comparação à I/O do disco. Evita o problema
    documentado da stdlib: "Threads may share the module, but not connections."
  - WAL permite múltiplos leitores concorrentes com 1 escritor; o próprio
    sqlite serializa escritas via lock interno (busy_timeout cobre wait).
  - Não há `_write_lock` aplicacional — sqlite faz o trabalho.

Pragmas:
  - journal_mode=WAL é persistente (gravado no header do DB, schema.sql aplica).
  - synchronous=NORMAL, busy_timeout, foreign_keys são per-connection — re-
    aplicados em cada `_connect()`.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import sqlite3
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

# Formato canônico do bucket horário usado pela sparkline. Compartilhado entre
# a SQL agregada (strftime) e o gap fill no router — single source of truth.
HOUR_BUCKET_FMT = "%Y-%m-%dT%H:00:00Z"

# Janela de tolerância pra considerar um agente "online" baseado no último heartbeat.
# Se nenhum hook/jsonl chega há mais que isso, derive_agent_status retorna "offline".
OFFLINE_THRESHOLD_SECONDS = 300


def hour_window(hours: int) -> tuple[datetime, int]:
    """Janela de `hours` buckets alinhada à hora corrente UTC.

    Retorna `(start_dt, hours)` onde start_dt = hora-corrente-UTC menos (hours-1).
    A série cobre `[start_dt, hora_corrente]` inclusive, totalizando `hours` itens.
    Compartilhado entre `/api/agents/{slug}/sparkline` e `/api/fleet` pra evitar
    janela deslocada quando UI consome os dois lado a lado.
    """
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return now - timedelta(hours=hours - 1), hours


def build_hour_series(
    counts: dict[str, int], start_dt: datetime, hours: int,
) -> list[dict[str, Any]]:
    """Preenche horas vazias com 0 — UI recebe array contíguo de `hours` itens."""
    out: list[dict[str, Any]] = []
    for i in range(hours):
        key = (start_dt + timedelta(hours=i)).strftime(HOUR_BUCKET_FMT)
        out.append({"bucket": key, "count": counts.get(key, 0)})
    return out


def derive_prefix(name: str) -> str:
    """Iniciais do primeiro nome + sobrenome ('Daniel Singh' → 'DS')."""
    parts = [p for p in name.split() if p]
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    if parts:
        return parts[0][:2].upper()
    return "??"


def derive_agent_status(
    last_seen: int | None,
    instances: list[dict[str, Any]] | None,
    *,
    now: int | None = None,
) -> str:
    """Deriva status do agente a partir do heartbeat + status das instâncias.

    Single source of truth pra UI: 5 estados (running, blocked, done, idle, offline).
    UI Designer assume essa derivação — não duplicar lógica no frontend.

    Ordem de precedência:
      1) sem heartbeat ou heartbeat > 5min → offline
      2) qualquer instance running → running
      3) qualquer instance blocked → blocked
      4) todas as instances done → done
      5) caso contrário → idle (inclui agente vivo sem instances)
    """
    now = now if now is not None else int(time.time())
    if last_seen is None or (now - last_seen) > OFFLINE_THRESHOLD_SECONDS:
        return "offline"
    if not instances:
        return "idle"
    statuses = {i["status"] for i in instances}
    if "running" in statuses:
        return "running"
    if "blocked" in statuses:
        return "blocked"
    if statuses == {"done"}:
        return "done"
    return "idle"


class GrupoBorgesDB:
    def __init__(self, db_path: str):
        self.db_path = db_path

    @contextlib.contextmanager
    def _connect(self):
        # isolation_level default (deferred) → `with conn:` faz BEGIN/COMMIT
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
        finally:
            conn.close()

    # ---------- lifecycle ----------

    async def startup(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(self._apply_schema)

    def _apply_schema(self) -> None:
        with self._connect() as conn:
            with SCHEMA_PATH.open("r", encoding="utf-8") as f:
                conn.executescript(f.read())
            # Migração idempotente: coluna `human_id` adicionada após o schema
            # original (CREATE TABLE IF NOT EXISTS não altera tabela existente).
            # `executescript` faz commit implícito → o ALTER abaixo roda em autocommit;
            # capturamos "duplicate column" caso dois startups concorrentes (ex: dev
            # reload) racem pra adicionar a mesma coluna.
            existing = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)")}
            if "human_id" not in existing:
                try:
                    conn.execute("ALTER TABLE tasks ADD COLUMN human_id TEXT")
                except sqlite3.OperationalError as exc:
                    if "duplicate column" not in str(exc).lower():
                        raise
                conn.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_human_id "
                    "ON tasks(human_id) WHERE human_id IS NOT NULL"
                )

    async def shutdown(self) -> None:
        # No-op: connection-per-call não mantém estado pra fechar
        return

    # ---------- agents ----------

    async def sync_agents_from_yaml(self, agents: list[dict[str, Any]]) -> None:
        await asyncio.to_thread(self._sync_agents, agents)

    def _sync_agents(self, agents: list[dict[str, Any]]) -> None:
        now = int(time.time())
        with self._connect() as conn, conn:
            for a in agents:
                conn.execute(
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
                conn.execute(
                    """
                    INSERT INTO agent_state (slug, instance_count)
                    VALUES (?, 0)
                    ON CONFLICT(slug) DO NOTHING
                    """,
                    (a["slug"],),
                )
                # Bootstrap do counter de human_id (prefix imutável após primeira gravação
                # pra não invalidar IDs já emitidos — DO NOTHING preserva o existente).
                conn.execute(
                    """
                    INSERT INTO human_id_counters (agent_slug, prefix, next_seq)
                    VALUES (?, ?, 1)
                    ON CONFLICT(agent_slug) DO NOTHING
                    """,
                    (a["slug"], derive_prefix(a["name"])),
                )

    async def list_agents(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_agents)

    def _list_agents(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            cur = conn.execute(
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
        with self._connect() as conn:
            cur = conn.execute(
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
        d["capabilities"] = json.loads(d["capabilities"] or "[]")
        return d

    # ---------- agent_state ----------

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
        await asyncio.to_thread(
            self._upsert_agent_state,
            slug, cli, model, current_task_id, jsonl_path, pane_excerpt,
        )

    def _upsert_agent_state(
        self, slug, cli, model, current_task_id, jsonl_path, pane_excerpt
    ) -> None:
        # Pre-condição: linha existe (sync_agents_from_yaml garante no startup).
        # COALESCE(?, col): NULL passado mantém o valor atual. "" ou 0 são
        # valores explícitos e sobrescrevem (consistente com o código antigo
        # que filtrava por `is not None`).
        now = int(time.time())
        with self._connect() as conn, conn:
            conn.execute(
                """
                UPDATE agent_state SET
                    last_seen = ?,
                    cli = COALESCE(?, cli),
                    model = COALESCE(?, model),
                    current_task_id = COALESCE(?, current_task_id),
                    jsonl_path = COALESCE(?, jsonl_path),
                    pane_excerpt = COALESCE(?, pane_excerpt)
                WHERE slug = ?
                """,
                (now, cli, model, current_task_id, jsonl_path, pane_excerpt, slug),
            )

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
        return await asyncio.to_thread(
            self._insert_task_event,
            kind, task_id, agent_slug, instance_id, payload, raw_jsonl,
        )

    def _insert_task_event(
        self, kind, task_id, agent_slug, instance_id, payload, raw_jsonl
    ) -> int:
        with self._connect() as conn, conn:
            cur = conn.execute(
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
        with self._connect() as conn:
            cur = conn.execute(
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
                        pass  # mantém payload cru se DB estiver corrompido
                result.append(d)
            return result

    async def max_event_id(self) -> int:
        return await asyncio.to_thread(self._max_event_id)

    def _max_event_id(self) -> int:
        with self._connect() as conn:
            return conn.execute(
                "SELECT COALESCE(MAX(id), 0) FROM task_events"
            ).fetchone()[0]

    async def list_events_latest(
        self, limit: int = 50, before_id: int | None = None
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_events_latest, limit, before_id)

    def _list_events_latest(
        self, limit: int, before_id: int | None
    ) -> list[dict[str, Any]]:
        base_sql = (
            "SELECT id, task_id, agent_slug, instance_id, kind, payload, created_at "
            "FROM task_events"
        )
        if before_id is None:
            sql = f"{base_sql} ORDER BY id DESC LIMIT ?"
            params: tuple[Any, ...] = (limit,)
        else:
            sql = f"{base_sql} WHERE id < ? ORDER BY id DESC LIMIT ?"
            params = (before_id, limit)

        with self._connect() as conn:
            result: list[dict[str, Any]] = []
            for row in conn.execute(sql, params).fetchall():
                d = dict(row)
                if d.get("payload"):
                    try:
                        d["payload"] = json.loads(d["payload"])
                    except json.JSONDecodeError:
                        pass
                result.append(d)
            return result

    # ---------- tasks ----------

    TASK_STATUSES = {"backlog", "ready", "running", "review", "blocked", "done"}
    TASK_UPDATABLE_COLUMNS = {
        "title", "body", "assignee", "instance_id",
        "skill_hint", "status", "priority",
    }

    async def create_task(
        self,
        *,
        id: str,
        title: str,
        assignee: str,
        body: str | None = None,
        instance_id: str | None = None,
        origin_agent: str | None = None,
        skill_hint: str | None = None,
        status: str = "backlog",
        priority: int = 0,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._create_task,
            id=id, title=title, assignee=assignee, body=body,
            instance_id=instance_id, origin_agent=origin_agent,
            skill_hint=skill_hint, status=status, priority=priority,
            idempotency_key=idempotency_key,
        )

    def _create_task(
        self, *, id, title, assignee, body, instance_id, origin_agent,
        skill_hint, status, priority, idempotency_key,
    ) -> dict[str, Any]:
        now = int(time.time())
        with self._connect() as conn, conn:
            # human_id e INSERT na mesma transação: UPDATE...RETURNING serializa
            # writers no SQLite, então a sequência por agente nunca duplica.
            # NOTA: idempotency_key duplicado causa rollback e queima 1 número
            # do counter (gap "DS-12, DS-14") — aceitável; humano não estranha gap.
            human_id = self._next_human_id(conn, assignee)
            conn.execute(
                """
                INSERT INTO tasks (id, human_id, title, body, assignee, instance_id, origin_agent,
                                   skill_hint, status, priority, created_at, idempotency_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (id, human_id, title, body, assignee, instance_id, origin_agent,
                 skill_hint, status, priority, now, idempotency_key),
            )
        task = self._get_task(id)
        assert task is not None  # acabou de ser inserida
        return task

    @staticmethod
    def _next_human_id(conn: sqlite3.Connection, agent_slug: str) -> str:
        """Incrementa o counter e retorna o ID consumido (`DS-12`).

        Atomicidade: UPDATE...RETURNING numa única statement. Sem race entre
        leitura e increment. Requer SQLite 3.35+ (RETURNING) — Python 3.11
        embarca 3.40+.

        Levanta `RuntimeError` se o counter do agente não existe — invariante de
        bootstrap (sync_agents_from_yaml insere row pra todo agente conhecido).
        """
        cur = conn.execute(
            """
            UPDATE human_id_counters
            SET next_seq = next_seq + 1
            WHERE agent_slug = ?
            RETURNING prefix, next_seq - 1 AS used_seq
            """,
            (agent_slug,),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError(
                f"human_id_counter ausente pra agent_slug={agent_slug!r}; "
                "rodou sync_agents_from_yaml?"
            )
        return f"{row['prefix']}-{row['used_seq']}"

    async def list_tasks(
        self,
        *,
        assignee: str | None = None,
        status: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_tasks, assignee, status, limit)

    def _list_tasks(
        self, assignee: str | None, status: str | None, limit: int,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if assignee:
            clauses.append("assignee = ?")
            params.append(assignee)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        with self._connect() as conn:
            cur = conn.execute(
                f"""
                SELECT * FROM tasks
                {where}
                ORDER BY priority DESC, created_at ASC
                LIMIT ?
                """,
                params,
            )
            return [dict(row) for row in cur.fetchall()]

    async def get_task(self, task_id: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_task, task_id)

    def _get_task(self, task_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            cur = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
            row = cur.fetchone()
            return dict(row) if row is not None else None

    async def get_task_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_task_by_idempotency_key, key)

    def _get_task_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            cur = conn.execute("SELECT * FROM tasks WHERE idempotency_key = ?", (key,))
            row = cur.fetchone()
            return dict(row) if row is not None else None

    async def update_task(
        self, task_id: str, fields: dict[str, Any],
    ) -> dict[str, Any] | None:
        # `fields` carrega só os campos enviados pelo cliente (model_dump exclude_unset);
        # whitelist em TASK_UPDATABLE_COLUMNS impede coluna inválida virar SQL.
        return await asyncio.to_thread(self._update_task, task_id, fields)

    def _update_task(
        self, task_id: str, fields: dict[str, Any],
    ) -> dict[str, Any] | None:
        sets: list[str] = []
        params: list[Any] = []
        for col, val in fields.items():
            if col not in self.TASK_UPDATABLE_COLUMNS:
                continue
            sets.append(f"{col} = ?")
            params.append(val)

        # started_at/completed_at derivados da transição de status (semântica unidirecional).
        new_status = fields.get("status")
        if new_status == "running":
            sets.append("started_at = COALESCE(started_at, ?)")
            params.append(int(time.time()))
        if new_status == "done":
            sets.append("completed_at = ?")
            params.append(int(time.time()))

        if not sets:
            return self._get_task(task_id)

        params.append(task_id)
        with self._connect() as conn, conn:
            cur = conn.execute(
                f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?",
                params,
            )
            if cur.rowcount == 0:
                return None
        return self._get_task(task_id)

    async def delete_task(self, task_id: str) -> bool:
        return await asyncio.to_thread(self._delete_task, task_id)

    def _delete_task(self, task_id: str) -> bool:
        with self._connect() as conn, conn:
            cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            return cur.rowcount > 0

    # ---------- agent_instances ----------

    async def list_agent_instances(
        self,
        agent_slug: str,
        *,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_agent_instances, agent_slug, status)

    def _list_agent_instances(
        self, agent_slug: str, status: str | None,
    ) -> list[dict[str, Any]]:
        clauses = ["agent_slug = ?"]
        params: list[Any] = [agent_slug]
        if status:
            clauses.append("status = ?")
            params.append(status)
        with self._connect() as conn:
            cur = conn.execute(
                f"""
                SELECT * FROM agent_instances
                WHERE {' AND '.join(clauses)}
                ORDER BY instance_num ASC
                """,
                params,
            )
            return [self._row_to_instance(row) for row in cur.fetchall()]

    @staticmethod
    def _row_to_instance(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        # SQLite armazena bool como INTEGER 0/1 — converter pra UI consumir direto.
        d["is_subagent"] = bool(d["is_subagent"])
        return d

    # ---------- task_events: sparkline ----------

    async def event_counts_per_hour(
        self,
        agent_slug: str,
        *,
        since_unix: int,
    ) -> dict[str, int]:
        """COUNT por hora UTC pros eventos de um agente desde `since_unix`.

        Retorna dict ISO `YYYY-MM-DDTHH:00:00Z` → contagem. Buckets vazios NÃO
        entram no dict — gap filling é responsabilidade do caller.
        """
        return await asyncio.to_thread(self._event_counts_per_hour, agent_slug, since_unix)

    def _event_counts_per_hour(
        self, agent_slug: str, since_unix: int,
    ) -> dict[str, int]:
        # strftime aqui é parametrizado pra forçar match exato com o formato que
        # o caller usa no gap fill — divergência viraria contagem 0 silenciosa.
        with self._connect() as conn:
            cur = conn.execute(
                """
                SELECT
                    strftime(?, created_at, 'unixepoch') AS hour_bucket,
                    COUNT(*) AS cnt
                FROM task_events
                WHERE agent_slug = ? AND created_at >= ?
                GROUP BY hour_bucket
                """,
                (HOUR_BUCKET_FMT, agent_slug, since_unix),
            )
            return {row["hour_bucket"]: row["cnt"] for row in cur.fetchall()}

    # ---------- fleet snapshot (agregado pra UI) ----------

    async def fleet_snapshot(
        self, *, sparkline_hours: int = 24,
    ) -> dict[str, Any]:
        """Snapshot atômico da frota: 6 agents + state + instances + sparkline + KPIs.

        Implementação prefere ler tudo numa única conexão (4 queries) a expor
        N+1 pro caller. Resposta serve a /api/fleet sem mais round-trips.
        """
        return await asyncio.to_thread(self._fleet_snapshot, sparkline_hours)

    def _fleet_snapshot(self, sparkline_hours: int) -> dict[str, Any]:
        now = int(time.time())
        start_dt, _ = hour_window(sparkline_hours)
        since_unix = int(start_dt.timestamp())
        with self._connect() as conn:
            agent_rows = conn.execute(
                """
                SELECT a.*, s.cli AS state_cli, s.model AS state_model,
                       s.current_task_id, s.last_seen, s.pane_excerpt, s.instance_count
                FROM agents a
                LEFT JOIN agent_state s ON s.slug = a.slug
                ORDER BY a.slug
                """
            ).fetchall()
            agents = [self._row_to_agent(r) for r in agent_rows]

            instance_rows = conn.execute(
                """
                SELECT * FROM agent_instances
                WHERE ended_at IS NULL
                ORDER BY agent_slug, instance_num
                """
            ).fetchall()
            by_slug: dict[str, list[dict[str, Any]]] = {}
            for row in instance_rows:
                inst = self._row_to_instance(row)
                by_slug.setdefault(inst["agent_slug"], []).append(inst)

            spark_rows = conn.execute(
                """
                SELECT agent_slug,
                       strftime(?, created_at, 'unixepoch') AS hour_bucket,
                       COUNT(*) AS cnt
                FROM task_events
                WHERE agent_slug IS NOT NULL AND created_at >= ?
                GROUP BY agent_slug, hour_bucket
                """,
                (HOUR_BUCKET_FMT, since_unix),
            ).fetchall()
            spark_by_slug: dict[str, dict[str, int]] = {}
            for row in spark_rows:
                spark_by_slug.setdefault(row["agent_slug"], {})[row["hour_bucket"]] = row["cnt"]

            task_counts = {
                row["status"]: row["cnt"]
                for row in conn.execute(
                    "SELECT status, COUNT(*) AS cnt FROM tasks GROUP BY status"
                ).fetchall()
            }

        # Hidrata cada agente com instances ativas, status derivado e buckets gap-filled.
        for agent in agents:
            slug = agent["slug"]
            agent_instances = by_slug.get(slug, [])
            agent["instances"] = agent_instances
            agent["status"] = derive_agent_status(
                agent["last_seen"], agent_instances, now=now,
            )
            agent["sparkline"] = build_hour_series(
                spark_by_slug.get(slug, {}), start_dt, sparkline_hours,
            )

        status_counts = Counter(a["status"] for a in agents)
        kpis = {
            "total": len(agents),
            "running": status_counts.get("running", 0),
            "blocked": status_counts.get("blocked", 0),
            "idle": status_counts.get("idle", 0),
            "done": status_counts.get("done", 0),
            "offline": status_counts.get("offline", 0),
            "tasks_active": sum(
                task_counts.get(s, 0)
                for s in ("backlog", "ready", "running", "review", "blocked")
            ),
            "tasks_running": task_counts.get("running", 0),
            "tasks_blocked": task_counts.get("blocked", 0),
            "tasks_done": task_counts.get("done", 0),
        }
        last_sync = max((a["last_seen"] for a in agents if a["last_seen"]), default=None)
        return {
            "agents": agents,
            "kpis": kpis,
            "health": {
                "last_sync": last_sync,
                "server_now": now,
                "offline_threshold_seconds": OFFLINE_THRESHOLD_SECONDS,
            },
        }
