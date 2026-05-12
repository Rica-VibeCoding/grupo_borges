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
import uuid
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

# Uma task em execução sem hook/jsonl por 10 minutos deixa de ser "verde".
# A margem é maior que o offline do agente para evitar falso positivo em ações longas.
RUN_STALE_THRESHOLD_SECONDS = 600

REVIEW_MODES = {"human", "agent_advisory", "agent_autonomous"}
REVIEW_ACTIONS = {
    "accept": ("review.accepted", "done"),
    "accepted": ("review.accepted", "done"),
    "reject": ("review.rejected", "running"),
    "rejected": ("review.rejected", "running"),
    "requeue": ("review.requeued", "ready"),
    "requeued": ("review.requeued", "ready"),
}
_UNSET = object()


def _parse_csv_statuses(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


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


def _json_array_or_none(value: list[Any] | tuple[Any, ...] | None) -> str | None:
    if value is None:
        return None
    return json.dumps(list(value), ensure_ascii=False)


def derive_agent_status(
    last_seen: int | None,
    instances: list[dict[str, Any]] | None,
    *,
    lifecycle_status: str | None = None,
    lifecycle_updated_at: int | None = None,
    current_task_id: str | None = None,
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
    lifecycle_is_fresh = (
        lifecycle_updated_at is not None
        and now - lifecycle_updated_at <= OFFLINE_THRESHOLD_SECONDS
    )
    if last_seen is None or (now - last_seen) > OFFLINE_THRESHOLD_SECONDS:
        return "offline"
    if lifecycle_status == "error":
        return "blocked"
    if lifecycle_is_fresh and lifecycle_status in {
        "session",
        "prompt",
        "tool",
        "tool_done",
        "subagent",
        "subagent_done",
    }:
        return "running"
    if not instances:
        return "running" if current_task_id else "idle"
    statuses = {i["status"] for i in instances}
    if "running" in statuses:
        return "running"
    if "blocked" in statuses:
        return "blocked"
    if statuses == {"done"}:
        return "done"
    return "idle"


def derive_lifecycle_from_event(
    kind: str | None,
    payload: dict[str, Any] | None,
) -> tuple[str | None, str | None]:
    """Microestado defensivo a partir do último evento salvo.

    Usado como fallback para bancos já populados antes das colunas lifecycle.
    Os routers continuam gravando o estado explícito para eventos novos.
    """
    if not kind:
        return None, None
    clean_kind = kind.removeprefix("hook:")
    data = payload or {}

    if clean_kind == "SessionStart":
        return "session", "sessao iniciada"
    if clean_kind == "UserPromptSubmit":
        return "prompt", "prompt recebido"
    if clean_kind == "PreToolUse":
        return "tool", data.get("tool_name") if isinstance(data.get("tool_name"), str) else None
    if clean_kind == "PostToolUse":
        return "tool_done", data.get("tool_name") if isinstance(data.get("tool_name"), str) else None
    if clean_kind == "PostToolUseFailure":
        return "error", data.get("tool_name") if isinstance(data.get("tool_name"), str) else None
    if clean_kind == "SubagentStart":
        return "subagent", data.get("agent_type") if isinstance(data.get("agent_type"), str) else None
    if clean_kind == "SubagentStop":
        return "subagent_done", data.get("agent_type") if isinstance(data.get("agent_type"), str) else None
    if clean_kind == "Stop":
        return "idle", "turno finalizado"
    if clean_kind == "StopFailure":
        return "error", "turno falhou"

    if kind == "tara.exec.started":
        return "session", "tara-codex iniciado"
    if kind == "tara.exec.completed":
        return "idle", "tara-codex concluido"
    if kind == "tara.exec.failed":
        return "error", "tara-codex falhou"
    if kind == "codex.turn.started":
        return "prompt", "turno iniciado"
    if kind in {"codex.item.started", "codex.item.updated"}:
        body = data.get("body") if isinstance(data.get("body"), dict) else data
        detail = body.get("label") or body.get("name") or body.get("type")
        return "tool", detail if isinstance(detail, str) else "item em execucao"
    if kind == "codex.item.completed":
        return "tool_done", "item concluido"
    if kind == "codex.turn.completed":
        return "idle", "turno concluido"
    if kind in {"codex.turn.failed", "codex.error"}:
        return "error", "erro codex"

    if kind == "jsonl:user":
        return "prompt", "mensagem do usuario"
    if kind == "jsonl:assistant":
        message = data.get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        name = block.get("name")
                        return "tool", name if isinstance(name, str) else "tool em execucao"
            if message.get("stop_reason") == "end_turn":
                return "idle", "turno finalizado"
        return "event", "assistant"
    if kind == "jsonl:result":
        return "idle", "sessao finalizada"

    return "event", clean_kind


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
            # Migrações idempotentes: `executescript` fez commit implícito → ALTERs abaixo
            # rodam em autocommit. `_add_column_if_missing` engole "duplicate column" caso
            # dois startups concorrentes (ex: dev reload) racem na mesma coluna.
            if self._add_column_if_missing(conn, "tasks", "human_id", "TEXT"):
                conn.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_human_id "
                    "ON tasks(human_id) WHERE human_id IS NOT NULL"
                )
            for col, definition in (
                ("lifecycle_status", "TEXT"),
                ("lifecycle_detail", "TEXT"),
                ("lifecycle_event", "TEXT"),
                ("lifecycle_updated_at", "INTEGER"),
            ):
                self._add_column_if_missing(conn, "agent_state", col, definition)

            # S2: colunas de watchdog/checkpoint/review
            for col, definition in (
                ("heartbeat_timeout_seconds", "INTEGER DEFAULT 900"),
                ("max_hops", "INTEGER DEFAULT 5"),
                ("reviewer_assignee", "TEXT"),
                ("review_mode", "TEXT NOT NULL DEFAULT 'human'"),
                ("tags", "TEXT"),
            ):
                self._add_column_if_missing(conn, "tasks", col, definition)

            self._add_column_if_missing(conn, "agents", "can_review", "TEXT")

            if self._add_column_if_missing(conn, "task_events", "content_hash", "TEXT"):
                conn.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_events_idempotency "
                    "ON task_events(task_id, content_hash) WHERE content_hash IS NOT NULL"
                )

    @staticmethod
    def _add_column_if_missing(
        conn: sqlite3.Connection, table: str, column: str, definition: str
    ) -> bool:
        """ALTER TABLE idempotente. Retorna True se a coluna foi adicionada agora."""
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column in existing:
            return False
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        except sqlite3.OperationalError as exc:
            if "duplicate column" not in str(exc).lower():
                raise
            return False
        return True

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
                                        cli_default, model_default, capabilities, can_review,
                                        created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(slug) DO UPDATE SET
                        name           = excluded.name,
                        role           = excluded.role,
                        emoji          = excluded.emoji,
                        tmux_session   = excluded.tmux_session,
                        workspace_path = excluded.workspace_path,
                        cli_default    = excluded.cli_default,
                        model_default  = excluded.model_default,
                        capabilities   = excluded.capabilities,
                        can_review     = excluded.can_review,
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
                        json.dumps(a.get("can_review", []), ensure_ascii=False),
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
                       s.current_task_id, s.last_seen, s.pane_excerpt,
                       s.lifecycle_status, s.lifecycle_detail, s.lifecycle_event,
                       s.lifecycle_updated_at, s.instance_count
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
                       s.current_task_id, s.last_seen, s.pane_excerpt,
                       s.lifecycle_status, s.lifecycle_detail, s.lifecycle_event,
                       s.lifecycle_updated_at, s.instance_count
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
        d["can_review"] = json.loads(d["can_review"] or "[]")
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

    async def update_agent_lifecycle(
        self,
        slug: str,
        *,
        status: str,
        detail: str | None,
        event: str,
    ) -> None:
        await asyncio.to_thread(
            self._update_agent_lifecycle,
            slug,
            status=status,
            detail=detail,
            event=event,
        )

    def _update_agent_lifecycle(
        self,
        slug: str,
        *,
        status: str,
        detail: str | None,
        event: str,
    ) -> None:
        now = int(time.time())
        clean_detail = detail.strip() if isinstance(detail, str) else None
        if clean_detail == "":
            clean_detail = None
        if clean_detail is not None and len(clean_detail) > 160:
            clean_detail = f"{clean_detail[:157]}..."
        with self._connect() as conn, conn:
            conn.execute(
                """
                UPDATE agent_state
                SET last_seen = ?,
                    lifecycle_status = ?,
                    lifecycle_detail = ?,
                    lifecycle_event = ?,
                    lifecycle_updated_at = ?
                WHERE slug = ?
                """,
                (now, status, clean_detail, event, now, slug),
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
        content_hash: str | None = None,
    ) -> int | None:
        return await asyncio.to_thread(
            self._insert_task_event,
            kind, task_id, agent_slug, instance_id, payload, raw_jsonl, content_hash,
        )

    def _insert_task_event(
        self, kind, task_id, agent_slug, instance_id, payload, raw_jsonl, content_hash=None
    ) -> int | None:
        with self._connect() as conn, conn:
            if content_hash is not None:
                # INSERT OR IGNORE funciona com índice parcial UNIQUE WHERE content_hash IS NOT NULL.
                # Verifica via rowcount (0 = ignorado, nada inserido).
                cur = conn.execute(
                    """
                    INSERT OR IGNORE INTO task_events
                        (task_id, agent_slug, instance_id, kind, payload, raw_jsonl, content_hash, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        task_id,
                        agent_slug,
                        instance_id,
                        kind,
                        json.dumps(payload, ensure_ascii=False) if payload is not None else None,
                        raw_jsonl,
                        content_hash,
                        int(time.time()),
                    ),
                )
                return cur.lastrowid if cur.rowcount > 0 else None
            else:
                cur = conn.execute(
                    """
                    INSERT INTO task_events
                        (task_id, agent_slug, instance_id, kind, payload, raw_jsonl, created_at)
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

    async def record_review_action(
        self,
        task_id: str,
        action: str,
        reviewer: str,
        payload: dict[str, Any] | None,
        content_hash: str | None,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._record_review_action,
            task_id,
            action,
            reviewer,
            payload,
            content_hash,
        )

    def _record_review_action(
        self,
        task_id: str,
        action: str,
        reviewer: str,
        payload: dict[str, Any] | None,
        content_hash: str | None,
    ) -> dict[str, Any] | None:
        action_key = action.strip().lower()
        if action_key not in REVIEW_ACTIONS:
            raise ValueError(f"review action invalida: {action!r}")
        event_kind, next_status = REVIEW_ACTIONS[action_key]
        now = int(time.time())
        event_payload = dict(payload or {})
        event_payload.update(
            {
                "action": action_key,
                "reviewer": reviewer,
                "to_status": next_status,
            }
        )

        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                task_row = conn.execute(
                    "SELECT * FROM tasks WHERE id = ?",
                    (task_id,),
                ).fetchone()
                if task_row is None:
                    conn.rollback()
                    return None
                task = dict(task_row)
                event_payload["from_status"] = task["status"]

                # task_events.agent_slug é FK pra agents(slug). Reviewer humano (Rica)
                # ou slug não-registrado vai pro payload, agent_slug fica NULL.
                agent_exists = conn.execute(
                    "SELECT 1 FROM agents WHERE slug = ?",
                    (reviewer,),
                ).fetchone()
                event_agent_slug = reviewer if agent_exists else None

                if content_hash is not None:
                    cur = conn.execute(
                        """
                        INSERT OR IGNORE INTO task_events
                            (task_id, agent_slug, instance_id, kind, payload, content_hash, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            task_id,
                            event_agent_slug,
                            task.get("instance_id"),
                            event_kind,
                            json.dumps(event_payload, ensure_ascii=False),
                            content_hash,
                            now,
                        ),
                    )
                    if cur.rowcount == 0:
                        conn.rollback()
                        return None
                    event_id = cur.lastrowid
                else:
                    cur = conn.execute(
                        """
                        INSERT INTO task_events
                            (task_id, agent_slug, instance_id, kind, payload, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            task_id,
                            event_agent_slug,
                            task.get("instance_id"),
                            event_kind,
                            json.dumps(event_payload, ensure_ascii=False),
                            now,
                        ),
                    )
                    event_id = cur.lastrowid

                if next_status == "done":
                    conn.execute(
                        """
                        UPDATE tasks
                        SET status = 'done', completed_at = ?
                        WHERE id = ?
                        """,
                        (now, task_id),
                    )
                    self._close_open_runs_for_status(
                        conn, task_id=task_id, task_status="done", ended_at=now,
                    )
                    conn.execute(
                        """
                        UPDATE agent_state
                        SET current_task_id = NULL, last_seen = ?
                        WHERE slug = ? AND current_task_id = ?
                        """,
                        (now, task["assignee"], task_id),
                    )
                elif next_status == "running":
                    conn.execute(
                        """
                        UPDATE tasks
                        SET status = 'running',
                            started_at = COALESCE(started_at, ?),
                            completed_at = NULL
                        WHERE id = ?
                        """,
                        (now, task_id),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE tasks
                        SET status = 'ready',
                            instance_id = NULL,
                            completed_at = NULL
                        WHERE id = ?
                        """,
                        (task_id,),
                    )
                    conn.execute(
                        """
                        UPDATE agent_state
                        SET current_task_id = NULL, last_seen = ?
                        WHERE slug = ? AND current_task_id = ?
                        """,
                        (now, task["assignee"], task_id),
                    )

                updated = self._get_task_from_conn(conn, task_id)
                conn.commit()
                return {
                    "event_id": event_id,
                    "task": updated,
                    "payload": event_payload,
                }
            except Exception:
                conn.rollback()
                raise

    async def record_checkpoint(
        self,
        *,
        task_id: str,
        agent_slug: str | None,
        state: str,
        summary: str | None = None,
        files_changed: str | None = None,
        next_step: str | None = None,
        handoff_to: str | None = None,
        content_hash: str | None = None,
        source: str = "unknown",
    ) -> dict[str, Any] | None:
        """Grava um checkpoint de agente e transita o status da task.

        Retorna None se o checkpoint já foi gravado (idempotência via content_hash).
        """
        return await asyncio.to_thread(
            self._record_checkpoint,
            task_id=task_id,
            agent_slug=agent_slug,
            state=state,
            summary=summary,
            files_changed=files_changed,
            next_step=next_step,
            handoff_to=handoff_to,
            content_hash=content_hash,
            source=source,
        )

    def _record_checkpoint(
        self,
        *,
        task_id: str,
        agent_slug: str | None,
        state: str,
        summary: str | None,
        files_changed: str | None,
        next_step: str | None,
        handoff_to: str | None,
        content_hash: str | None,
        source: str,
    ) -> dict[str, Any] | None:
        now = int(time.time())
        payload = {
            "state": state,
            "summary": summary,
            "files_changed": files_changed,
            "next_step": next_step,
            "handoff_to": handoff_to,
            "source": source,
        }
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                # Inserção idempotente via INSERT OR IGNORE (funciona com índice parcial)
                if content_hash is not None:
                    cur = conn.execute(
                        """
                        INSERT OR IGNORE INTO task_events
                            (task_id, agent_slug, kind, payload, content_hash, created_at)
                        VALUES (?, ?, 'checkpoint', ?, ?, ?)
                        """,
                        (
                            task_id,
                            agent_slug,
                            json.dumps(payload, ensure_ascii=False),
                            content_hash,
                            now,
                        ),
                    )
                    if cur.rowcount == 0:
                        conn.rollback()
                        return None  # duplicata — já processado
                    event_id = cur.lastrowid
                else:
                    cur = conn.execute(
                        """
                        INSERT INTO task_events
                            (task_id, agent_slug, kind, payload, created_at)
                        VALUES (?, ?, 'checkpoint', ?, ?)
                        """,
                        (
                            task_id,
                            agent_slug,
                            json.dumps(payload, ensure_ascii=False),
                            now,
                        ),
                    )
                    event_id = cur.lastrowid

                # Busca task atual pra validar que existe e está running
                task_row = conn.execute(
                    "SELECT id, status, assignee FROM tasks WHERE id = ?",
                    (task_id,),
                ).fetchone()
                if task_row is None:
                    conn.rollback()
                    return None

                task_status = task_row["status"]

                # Atualiza heartbeat do run ativo (se existir)
                conn.execute(
                    """
                    UPDATE task_runs
                    SET last_heartbeat = ?
                    WHERE task_id = ? AND status = 'running' AND ended_at IS NULL
                    """,
                    (now, task_id),
                )

                new_task_status: str | None = None
                if state == "DONE" and task_status not in ("done", "blocked"):
                    new_task_status = "review"
                    conn.execute(
                        "UPDATE tasks SET status = 'review', completed_at = ? WHERE id = ?",
                        (now, task_id),
                    )
                    conn.execute(
                        """
                        UPDATE task_runs
                        SET status = 'done', ended_at = ?, outcome = 'completed'
                        WHERE task_id = ? AND status = 'running' AND ended_at IS NULL
                        """,
                        (now, task_id),
                    )
                elif state in ("BLOCKED", "NEEDS_INPUT") and task_status not in ("blocked", "done", "review"):
                    new_task_status = "blocked"
                    conn.execute(
                        "UPDATE tasks SET status = 'blocked' WHERE id = ?",
                        (task_id,),
                    )
                    conn.execute(
                        """
                        UPDATE task_runs
                        SET status = 'blocked', ended_at = ?, outcome = ?
                        WHERE task_id = ? AND status = 'running' AND ended_at IS NULL
                        """,
                        (now, state.lower(), task_id),
                    )
                elif state == "HANDOFF" and task_status not in ("blocked", "done", "review"):
                    # Handoff: task pai fica blocked (aguarda filho completar)
                    new_task_status = "blocked"
                    conn.execute(
                        "UPDATE tasks SET status = 'blocked' WHERE id = ?",
                        (task_id,),
                    )
                    conn.execute(
                        """
                        UPDATE task_runs
                        SET status = 'blocked', ended_at = ?, outcome = 'handoff_pending'
                        WHERE task_id = ? AND status = 'running' AND ended_at IS NULL
                        """,
                        (now, task_id),
                    )
                # IN_PROGRESS: só heartbeat, sem transição de status

                conn.commit()
                return {
                    "event_id": event_id,
                    "task_id": task_id,
                    "state": state,
                    "new_task_status": new_task_status or task_status,
                }
            except Exception:
                conn.rollback()
                raise

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

    async def list_review_events(
        self,
        reviewer_slug: str | None = None,
        limit: int = 100,
        since_id: int | None = None,
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            self._list_review_events,
            reviewer_slug,
            limit,
            since_id,
        )

    def _list_review_events(
        self,
        reviewer_slug: str | None,
        limit: int,
        since_id: int | None,
    ) -> list[dict[str, Any]]:
        clauses = [
            "e.kind IN ('review.accepted', 'review.rejected', 'review.requeued')",
        ]
        params: list[Any] = []
        if reviewer_slug:
            clauses.append(
                "(e.agent_slug = ? OR t.reviewer_assignee = ? "
                "OR json_extract(e.payload, '$.reviewer') = ?)"
            )
            params.extend([reviewer_slug, reviewer_slug, reviewer_slug])
        if since_id is not None:
            clauses.append("e.id > ?")
            params.append(since_id)
        params.append(limit)

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT e.id, e.task_id, e.agent_slug, e.instance_id, e.kind,
                       e.payload, e.created_at,
                       t.human_id, t.title, t.status, t.assignee,
                       t.reviewer_assignee, t.review_mode, t.tags
                FROM task_events e
                LEFT JOIN tasks t ON t.id = e.task_id
                WHERE {" AND ".join(clauses)}
                ORDER BY e.id DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
            result: list[dict[str, Any]] = []
            for row in rows:
                d = dict(row)
                for key in ("payload", "tags"):
                    if d.get(key):
                        try:
                            d[key] = json.loads(d[key])
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

    async def create_task_handoff(
        self,
        *,
        parent_id: str,
        child_id: str,
        to_agent: str,
        note: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._create_task_handoff,
            parent_id=parent_id,
            child_id=child_id,
            to_agent=to_agent,
            note=note,
            idempotency_key=idempotency_key,
        )

    def _create_task_handoff(
        self, *, parent_id, child_id, to_agent, note, idempotency_key
    ) -> dict[str, Any] | None:
        now = int(time.time())
        clean_note = note.strip() if isinstance(note, str) else None
        with self._connect() as conn, conn:
            if idempotency_key:
                existing = self._handoff_by_idempotency_key(conn, idempotency_key)
                if existing is not None:
                    return {
                        "idempotency_collision": True,
                        "existing": {
                            "parent_id": existing["link_parent_id"],
                            "child_id": existing["id"],
                        },
                    }

            parent_row = conn.execute(
                "SELECT * FROM tasks WHERE id = ?",
                (parent_id,),
            ).fetchone()
            if parent_row is None:
                return None

            parent = dict(parent_row)
            child_title = f"↳ {clean_note or parent['title']}"
            child_human_id = self._next_human_id(conn, to_agent)

            # MAX_HOPS: filho herda parent.max_hops - 1. Se chegar em 0, bloqueia.
            parent_hops = parent.get("max_hops") if parent.get("max_hops") is not None else 5
            child_hops = max(0, int(parent_hops) - 1)
            child_status = "blocked" if child_hops == 0 else "ready"

            conn.execute(
                """
                INSERT INTO tasks (id, human_id, title, body, assignee, origin_agent,
                                   status, priority, created_at, idempotency_key,
                                   heartbeat_timeout_seconds, max_hops)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    child_id,
                    child_human_id,
                    child_title,
                    clean_note,
                    to_agent,
                    parent["assignee"],
                    child_status,
                    parent["priority"],
                    now,
                    idempotency_key,
                    parent.get("heartbeat_timeout_seconds") or 900,
                    child_hops,
                ),
            )
            conn.execute(
                """
                INSERT INTO task_links (parent_id, child_id, link_kind, created_at)
                VALUES (?, ?, 'handoff', ?)
                """,
                (parent_id, child_id, now),
            )
            payload = {
                "parent": parent_id,
                "child": child_id,
                "from": parent["assignee"],
                "to": to_agent,
                "note": clean_note,
                "child_max_hops": child_hops,
            }
            cur = conn.execute(
                """
                INSERT INTO task_events (task_id, agent_slug, kind, payload, created_at)
                VALUES (?, ?, 'handoff', ?, ?)
                """,
                (
                    parent_id,
                    parent["assignee"],
                    json.dumps(payload, ensure_ascii=False),
                    now,
                ),
            )
            if child_hops == 0:
                # Filho bloqueado imediatamente por hop_limit
                conn.execute(
                    """
                    INSERT INTO task_events (task_id, agent_slug, kind, payload, created_at)
                    VALUES (?, ?, 'hop_limit', ?, ?)
                    """,
                    (
                        child_id,
                        to_agent,
                        json.dumps({"reason": "hop_limit", "parent": parent_id}, ensure_ascii=False),
                        now,
                    ),
                )
            child = self._get_task_from_conn(conn, child_id)
            assert child is not None
            return {
                "idempotency_collision": False,
                "parent": parent,
                "child": child,
                "event_id": cur.lastrowid,
                "payload": payload,
                "hop_limit_blocked": child_hops == 0,
            }

    def _handoff_by_idempotency_key(
        self, conn: sqlite3.Connection, key: str
    ) -> dict[str, Any] | None:
        row = conn.execute(
            "SELECT t.*, l.parent_id AS link_parent_id "
            "FROM tasks t LEFT JOIN task_links l "
            "ON l.child_id = t.id AND l.link_kind='handoff' "
            "WHERE t.idempotency_key = ?",
            (key,),
        ).fetchone()
        return dict(row) if row else None

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
            clauses.append("t.assignee = ?")
            params.append(assignee)
        if status:
            statuses = _parse_csv_statuses(status)
            if len(statuses) == 1:
                clauses.append("t.status = ?")
                params.append(statuses[0])
            elif statuses:
                placeholders = ", ".join("?" for _ in statuses)
                clauses.append(f"t.status IN ({placeholders})")
                params.extend(statuses)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        with self._connect() as conn:
            cur = conn.execute(
                f"""
                SELECT t.*,
                       r.id AS current_run_id,
                       r.status AS current_run_status,
                       r.last_heartbeat AS current_run_last_heartbeat,
                       r.started_at AS current_run_started_at,
                       r.ended_at AS current_run_ended_at,
                       r.outcome AS current_run_outcome
                FROM tasks t
                LEFT JOIN task_runs r ON r.id = (
                    SELECT id
                    FROM task_runs
                    WHERE task_id = t.id
                    ORDER BY
                        CASE WHEN ended_at IS NULL THEN 0 ELSE 1 END,
                        started_at DESC,
                        id DESC
                    LIMIT 1
                )
                {where}
                ORDER BY t.priority DESC, t.created_at ASC
                LIMIT ?
                """,
                params,
            )
            return [dict(row) for row in cur.fetchall()]

    async def get_task(self, task_id: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_task, task_id)

    def _get_task(self, task_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            return self._get_task_from_conn(conn, task_id)

    @staticmethod
    def _get_task_from_conn(
        conn: sqlite3.Connection, task_id: str
    ) -> dict[str, Any] | None:
        cur = conn.execute(
            """
            SELECT t.*,
                   r.id AS current_run_id,
                   r.status AS current_run_status,
                   r.last_heartbeat AS current_run_last_heartbeat,
                   r.started_at AS current_run_started_at,
                   r.ended_at AS current_run_ended_at,
                   r.outcome AS current_run_outcome
            FROM tasks t
            LEFT JOIN task_runs r ON r.id = (
                SELECT id
                FROM task_runs
                WHERE task_id = t.id
                ORDER BY
                    CASE WHEN ended_at IS NULL THEN 0 ELSE 1 END,
                    started_at DESC,
                    id DESC
                LIMIT 1
            )
            WHERE t.id = ?
            """,
            (task_id,),
        )
        row = cur.fetchone()
        return dict(row) if row is not None else None

    async def touch_agent_run_heartbeat(
        self,
        agent_slug: str,
        *,
        source_kind: str,
        task_id: str | None = None,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._touch_agent_run_heartbeat,
            agent_slug,
            source_kind=source_kind,
            task_id=task_id,
        )

    def _touch_agent_run_heartbeat(
        self,
        agent_slug: str,
        *,
        source_kind: str,
        task_id: str | None,
    ) -> dict[str, Any] | None:
        now = int(time.time())
        with self._connect() as conn, conn:
            conn.execute(
                "UPDATE agent_state SET last_seen = ? WHERE slug = ?",
                (now, agent_slug),
            )
            resolved_task_id = task_id
            if resolved_task_id is None:
                state_row = conn.execute(
                    "SELECT current_task_id FROM agent_state WHERE slug = ?",
                    (agent_slug,),
                ).fetchone()
                if state_row is not None:
                    resolved_task_id = state_row["current_task_id"]
            if resolved_task_id is None:
                task_row = conn.execute(
                    """
                    SELECT id
                    FROM tasks
                    WHERE assignee = ? AND status = 'running'
                    ORDER BY COALESCE(started_at, created_at) DESC
                    LIMIT 1
                    """,
                    (agent_slug,),
                ).fetchone()
                if task_row is not None:
                    resolved_task_id = task_row["id"]
            if resolved_task_id is None:
                return None

            run_row = conn.execute(
                """
                SELECT id
                FROM task_runs
                WHERE task_id = ?
                  AND status = 'running'
                  AND ended_at IS NULL
                ORDER BY started_at DESC, id DESC
                LIMIT 1
                """,
                (resolved_task_id,),
            ).fetchone()
            if run_row is None:
                return None

            conn.execute(
                """
                UPDATE task_runs
                SET last_heartbeat = ?
                WHERE id = ?
                """,
                (now, run_row["id"]),
            )
            return {
                "task_id": resolved_task_id,
                "run_id": run_row["id"],
                "agent_slug": agent_slug,
                "last_heartbeat": now,
                "source_kind": source_kind,
            }

    async def advance_task_from_lifecycle(
        self,
        agent_slug: str,
        *,
        lifecycle_status: str,
        source_event: str,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._advance_task_from_lifecycle,
            agent_slug,
            lifecycle_status=lifecycle_status,
            source_event=source_event,
        )

    def _advance_task_from_lifecycle(
        self,
        agent_slug: str,
        *,
        lifecycle_status: str,
        source_event: str,
    ) -> dict[str, Any] | None:
        if source_event in {
            "hook:Stop",
            "jsonl:assistant",
            "jsonl:result",
            "tara.exec.completed",
            "codex.turn.completed",
        }:
            next_status = "review"
            run_status = "done"
            outcome = "awaiting_review"
            event_kind = "lifecycle.review"
        elif source_event in {
            "hook:StopFailure",
            "tara.exec.failed",
            "codex.turn.failed",
            "codex.error",
        }:
            next_status = "blocked"
            run_status = "blocked"
            outcome = "lifecycle_failed"
            event_kind = "lifecycle.blocked"
        else:
            return None

        if next_status == "review" and lifecycle_status != "idle":
            return None
        if next_status == "blocked" and lifecycle_status != "error":
            return None

        now = int(time.time())
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                task_row = conn.execute(
                    """
                    SELECT t.*
                    FROM tasks t
                    LEFT JOIN agent_state s ON s.slug = t.assignee
                    WHERE t.assignee = ?
                      AND t.status = 'running'
                      AND (s.current_task_id = t.id OR s.current_task_id IS NULL)
                    ORDER BY
                        CASE WHEN s.current_task_id = t.id THEN 0 ELSE 1 END,
                        COALESCE(t.started_at, t.created_at) DESC
                    LIMIT 1
                    """,
                    (agent_slug,),
                ).fetchone()
                if task_row is None:
                    conn.rollback()
                    return None
                task = dict(task_row)
                task_id = task["id"]

                run_cur = conn.execute(
                    """
                    UPDATE task_runs
                    SET status = ?,
                        ended_at = COALESCE(ended_at, ?),
                        outcome = COALESCE(outcome, ?),
                        last_heartbeat = COALESCE(last_heartbeat, ?)
                    WHERE task_id = ?
                      AND status = 'running'
                      AND ended_at IS NULL
                    """,
                    (run_status, now, outcome, now, task_id),
                )
                if run_cur.rowcount == 0:
                    conn.rollback()
                    return None

                if next_status == "review":
                    conn.execute(
                        """
                        UPDATE tasks
                        SET status = ?
                        WHERE id = ? AND status = 'running'
                        """,
                        (next_status, task_id),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE tasks
                        SET status = ?, completed_at = NULL
                        WHERE id = ? AND status = 'running'
                        """,
                        (next_status, task_id),
                    )
                conn.execute(
                    """
                    UPDATE agent_state
                    SET current_task_id = NULL, last_seen = ?
                    WHERE slug = ? AND current_task_id = ?
                    """,
                    (now, agent_slug, task_id),
                )

                payload = {
                    "task_id": task_id,
                    "human_id": task.get("human_id"),
                    "assignee": agent_slug,
                    "from_status": "running",
                    "to_status": next_status,
                    "source_event": source_event,
                    "closed_runs": run_cur.rowcount,
                    "outcome": outcome,
                }
                event_cur = conn.execute(
                    """
                    INSERT INTO task_events (task_id, agent_slug, instance_id, kind, payload, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        task_id,
                        agent_slug,
                        task.get("instance_id"),
                        event_kind,
                        json.dumps(payload, ensure_ascii=False),
                        now,
                    ),
                )
                updated = self._get_task_from_conn(conn, task_id)
                conn.commit()
                return {
                    "task": updated,
                    "event_id": event_cur.lastrowid,
                    "payload": payload,
                }
            except Exception:
                conn.rollback()
                raise

    async def mark_stale_runs(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._mark_stale_runs)

    def _mark_stale_runs(self) -> list[dict[str, Any]]:
        now = int(time.time())
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                # Usa heartbeat_timeout_seconds por-task (default 900s).
                # Cada row tem seu próprio cutoff: now - COALESCE(t.heartbeat_timeout_seconds, 900)
                stale_rows = conn.execute(
                    """
                    SELECT
                        r.id AS run_id,
                        r.task_id,
                        r.last_heartbeat,
                        r.started_at AS run_started_at,
                        t.human_id,
                        t.assignee,
                        t.instance_id,
                        COALESCE(t.heartbeat_timeout_seconds, 900) AS timeout_s
                    FROM task_runs r
                    JOIN tasks t ON t.id = r.task_id
                    WHERE r.status = 'running'
                      AND r.ended_at IS NULL
                      AND t.status = 'running'
                      AND COALESCE(r.last_heartbeat, r.started_at) < (? - COALESCE(t.heartbeat_timeout_seconds, 900))
                    ORDER BY COALESCE(r.last_heartbeat, r.started_at) ASC
                    """,
                    (now,),
                ).fetchall()
                marked: list[dict[str, Any]] = []
                for row in stale_rows:
                    payload = {
                        "task_id": row["task_id"],
                        "human_id": row["human_id"],
                        "assignee": row["assignee"],
                        "run_id": row["run_id"],
                        "last_heartbeat": row["last_heartbeat"],
                        "timeout_seconds": row["timeout_s"],
                        "reason": "timed_out",
                    }
                    conn.execute(
                        """
                        UPDATE task_runs
                        SET status = 'timed_out',
                            ended_at = COALESCE(ended_at, ?),
                            outcome = COALESCE(outcome, 'timed_out')
                        WHERE id = ?
                          AND status = 'running'
                          AND ended_at IS NULL
                        """,
                        (now, row["run_id"]),
                    )
                    conn.execute(
                        """
                        UPDATE tasks
                        SET status = 'blocked'
                        WHERE id = ? AND status = 'running'
                        """,
                        (row["task_id"],),
                    )
                    conn.execute(
                        """
                        UPDATE agent_state
                        SET current_task_id = NULL, last_seen = ?
                        WHERE slug = ? AND current_task_id = ?
                        """,
                        (now, row["assignee"], row["task_id"]),
                    )
                    conn.execute(
                        """
                        INSERT INTO task_events (task_id, agent_slug, instance_id, kind, payload, created_at)
                        VALUES (?, ?, ?, 'run.timed_out', ?, ?)
                        """,
                        (
                            row["task_id"],
                            row["assignee"],
                            row["instance_id"],
                            json.dumps(payload, ensure_ascii=False),
                            now,
                        ),
                    )
                    marked.append(payload)
                conn.commit()
                return marked
            except Exception:
                conn.rollback()
                raise

    async def get_task_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_task_by_idempotency_key, key)

    def _get_task_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            cur = conn.execute("SELECT * FROM tasks WHERE idempotency_key = ?", (key,))
            row = cur.fetchone()
            return dict(row) if row is not None else None

    async def claim_task_dispatch(
        self,
        task_id: str,
        *,
        note: str | None = None,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._claim_task_dispatch, task_id, note=note)

    def _claim_task_dispatch(
        self,
        task_id: str,
        *,
        note: str | None,
    ) -> dict[str, Any] | None:
        now = int(time.time())
        clean_note = note.strip() if isinstance(note, str) and note.strip() else None
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
                if task_row is None:
                    conn.rollback()
                    return None
                task = dict(task_row)
                if task["status"] == "done":
                    raise ValueError("task já concluída")
                if task["status"] == "running":
                    raise ValueError("task já está em execução")

                conn.execute(
                    """
                    UPDATE tasks
                    SET status = 'running',
                        started_at = COALESCE(started_at, ?)
                    WHERE id = ?
                    """,
                    (now, task_id),
                )
                run_cur = conn.execute(
                    """
                    INSERT INTO task_runs (
                        task_id, instance_id, status, last_heartbeat,
                        started_at, output_excerpt
                    )
                    VALUES (?, ?, 'running', ?, ?, ?)
                    """,
                    (task_id, task["instance_id"], now, now, clean_note),
                )
                conn.execute(
                    """
                    UPDATE agent_state
                    SET current_task_id = ?, last_seen = ?
                    WHERE slug = ?
                    """,
                    (task_id, now, task["assignee"]),
                )
                updated = self._get_task_from_conn(conn, task_id)
                assert updated is not None
                conn.commit()
                return {
                    "task": updated,
                    "run_id": run_cur.lastrowid,
                    "note": clean_note,
                }
            except Exception:
                conn.rollback()
                raise

    async def claim_next_ready_dispatch(
        self,
        *,
        note: str | None = None,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._claim_next_ready_dispatch, note=note)

    def _claim_next_ready_dispatch(
        self,
        *,
        note: str | None,
    ) -> dict[str, Any] | None:
        now = int(time.time())
        clean_note = note.strip() if isinstance(note, str) and note.strip() else None
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                task_row = conn.execute(
                    """
                    SELECT t.*, a.tmux_session
                    FROM tasks t
                    JOIN agents a ON a.slug = t.assignee
                    WHERE t.status = 'ready'
                      AND a.tmux_session IS NOT NULL
                      AND a.tmux_session != ''
                      AND NOT EXISTS (
                          SELECT 1
                          FROM tasks active
                          WHERE active.assignee = t.assignee
                            AND active.status = 'running'
                      )
                    ORDER BY t.priority DESC, t.created_at ASC
                    LIMIT 1
                    """
                ).fetchone()
                if task_row is None:
                    conn.rollback()
                    return None
                task = dict(task_row)
                task_id = task["id"]

                conn.execute(
                    """
                    UPDATE tasks
                    SET status = 'running',
                        started_at = COALESCE(started_at, ?)
                    WHERE id = ? AND status = 'ready'
                    """,
                    (now, task_id),
                )
                run_cur = conn.execute(
                    """
                    INSERT INTO task_runs (
                        task_id, instance_id, status, last_heartbeat,
                        started_at, output_excerpt
                    )
                    VALUES (?, ?, 'running', ?, ?, ?)
                    """,
                    (task_id, task["instance_id"], now, now, clean_note),
                )
                conn.execute(
                    """
                    UPDATE agent_state
                    SET current_task_id = ?, last_seen = ?
                    WHERE slug = ?
                    """,
                    (task_id, now, task["assignee"]),
                )
                updated = self._get_task_from_conn(conn, task_id)
                assert updated is not None
                conn.commit()
                return {
                    "task": updated,
                    "run_id": run_cur.lastrowid,
                    "note": clean_note,
                    "tmux_session": task["tmux_session"],
                }
            except Exception:
                conn.rollback()
                raise

    async def record_task_dispatch_delivered(
        self,
        task_id: str,
        *,
        run_id: int,
        tmux_session: str,
        note: str | None = None,
        source: str = "manual",
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._record_task_dispatch_delivered,
            task_id,
            run_id=run_id,
            tmux_session=tmux_session,
            note=note,
            source=source,
        )

    def _record_task_dispatch_delivered(
        self,
        task_id: str,
        *,
        run_id: int,
        tmux_session: str,
        note: str | None,
        source: str,
    ) -> dict[str, Any] | None:
        now = int(time.time())
        clean_note = note.strip() if isinstance(note, str) and note.strip() else None
        with self._connect() as conn, conn:
            task = self._get_task_from_conn(conn, task_id)
            if task is None:
                return None
            payload = {
                "task_id": task_id,
                "human_id": task.get("human_id"),
                "assignee": task["assignee"],
                "tmux_session": tmux_session,
                "note": clean_note,
                "run_id": run_id,
                "source": source,
            }
            event_cur = conn.execute(
                """
                INSERT INTO task_events (task_id, agent_slug, instance_id, kind, payload, created_at)
                VALUES (?, ?, ?, 'dispatch', ?, ?)
                """,
                (
                    task_id,
                    task["assignee"],
                    task["instance_id"],
                    json.dumps(payload, ensure_ascii=False),
                    now,
                ),
            )
            return {
                "task": task,
                "run_id": run_id,
                "event_id": event_cur.lastrowid,
                "payload": payload,
            }

    async def record_task_dispatch_failed(
        self,
        task_id: str,
        *,
        run_id: int,
        tmux_session: str,
        reason: str,
        source: str = "manual",
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._record_task_dispatch_failed,
            task_id,
            run_id=run_id,
            tmux_session=tmux_session,
            reason=reason,
            source=source,
        )

    def _record_task_dispatch_failed(
        self,
        task_id: str,
        *,
        run_id: int,
        tmux_session: str,
        reason: str,
        source: str,
    ) -> dict[str, Any] | None:
        now = int(time.time())
        with self._connect() as conn, conn:
            task = self._get_task_from_conn(conn, task_id)
            if task is None:
                return None
            conn.execute(
                """
                UPDATE task_runs
                SET status = 'blocked',
                    ended_at = COALESCE(ended_at, ?),
                    outcome = COALESCE(outcome, 'dispatch_failed')
                WHERE id = ? AND task_id = ?
                """,
                (now, run_id, task_id),
            )
            conn.execute(
                """
                UPDATE tasks
                SET status = 'blocked'
                WHERE id = ?
                """,
                (task_id,),
            )
            conn.execute(
                """
                UPDATE agent_state
                SET current_task_id = NULL, last_seen = ?
                WHERE slug = ? AND current_task_id = ?
                """,
                (now, task["assignee"], task_id),
            )
            payload = {
                "task_id": task_id,
                "human_id": task.get("human_id"),
                "assignee": task["assignee"],
                "tmux_session": tmux_session,
                "run_id": run_id,
                "reason": reason,
                "source": source,
            }
            conn.execute(
                """
                INSERT INTO task_events (task_id, agent_slug, instance_id, kind, payload, created_at)
                VALUES (?, ?, ?, 'dispatch.failed', ?, ?)
                """,
                (
                    task_id,
                    task["assignee"],
                    task["instance_id"],
                    json.dumps(payload, ensure_ascii=False),
                    now,
                ),
            )
            return self._get_task_from_conn(conn, task_id)

    async def dispatch_task(
        self,
        task_id: str,
        *,
        tmux_session: str,
        note: str | None = None,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._dispatch_task,
            task_id,
            tmux_session=tmux_session,
            note=note,
        )

    def _dispatch_task(
        self,
        task_id: str,
        *,
        tmux_session: str,
        note: str | None,
    ) -> dict[str, Any] | None:
        now = int(time.time())
        clean_note = note.strip() if isinstance(note, str) and note.strip() else None
        with self._connect() as conn, conn:
            task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if task_row is None:
                return None
            task = dict(task_row)
            if task["status"] == "done":
                raise ValueError("task já concluída")
            if task["status"] == "running":
                raise ValueError("task já está em execução")

            conn.execute(
                """
                UPDATE tasks
                SET status = 'running',
                    started_at = COALESCE(started_at, ?)
                WHERE id = ?
                """,
                (now, task_id),
            )
            run_cur = conn.execute(
                """
                INSERT INTO task_runs (
                    task_id, instance_id, status, last_heartbeat,
                    started_at, output_excerpt
                )
                VALUES (?, ?, 'running', ?, ?, ?)
                """,
                (task_id, task["instance_id"], now, now, clean_note),
            )
            payload = {
                "task_id": task_id,
                "human_id": task.get("human_id"),
                "assignee": task["assignee"],
                "tmux_session": tmux_session,
                "note": clean_note,
                "run_id": run_cur.lastrowid,
            }
            event_cur = conn.execute(
                """
                INSERT INTO task_events (task_id, agent_slug, instance_id, kind, payload, created_at)
                VALUES (?, ?, ?, 'dispatch', ?, ?)
                """,
                (
                    task_id,
                    task["assignee"],
                    task["instance_id"],
                    json.dumps(payload, ensure_ascii=False),
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE agent_state
                SET current_task_id = ?, last_seen = ?
                WHERE slug = ?
                """,
                (task_id, now, task["assignee"]),
            )
            updated = self._get_task_from_conn(conn, task_id)
            assert updated is not None
            return {
                "task": updated,
                "run_id": run_cur.lastrowid,
                "event_id": event_cur.lastrowid,
                "payload": payload,
            }

    async def update_task(
        self, task_id: str, fields: dict[str, Any],
    ) -> dict[str, Any] | None:
        # `fields` carrega só os campos enviados pelo cliente (model_dump exclude_unset);
        # whitelist em TASK_UPDATABLE_COLUMNS impede coluna inválida virar SQL.
        return await asyncio.to_thread(self._update_task, task_id, fields)

    def _update_task(
        self, task_id: str, fields: dict[str, Any],
    ) -> dict[str, Any] | None:
        now = int(time.time())
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
            params.append(now)
        if new_status == "done":
            sets.append("completed_at = ?")
            params.append(now)

        if not sets:
            return self._get_task(task_id)

        params.append(task_id)
        with self._connect() as conn, conn:
            before_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if before_row is None:
                return None
            before = dict(before_row)
            cur = conn.execute(
                f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?",
                params,
            )
            if cur.rowcount == 0:
                return None
            updated = self._get_task_from_conn(conn, task_id)
            if updated is None:
                return None
            if new_status and new_status != before["status"]:
                closed_runs = self._close_open_runs_for_status(
                    conn,
                    task_id=task_id,
                    task_status=new_status,
                    ended_at=now,
                )
                if new_status in {"review", "blocked", "done"}:
                    conn.execute(
                        """
                        UPDATE agent_state
                        SET current_task_id = NULL, last_seen = ?
                        WHERE slug = ? AND current_task_id = ?
                        """,
                        (now, before["assignee"], task_id),
                    )
                payload = {
                    "task_id": task_id,
                    "human_id": updated.get("human_id"),
                    "from_status": before["status"],
                    "to_status": new_status,
                    "closed_runs": closed_runs,
                }
                conn.execute(
                    """
                    INSERT INTO task_events (task_id, agent_slug, instance_id, kind, payload, created_at)
                    VALUES (?, ?, ?, 'status.changed', ?, ?)
                    """,
                    (
                        task_id,
                        updated["assignee"],
                        updated["instance_id"],
                        json.dumps(payload, ensure_ascii=False),
                        now,
                    ),
                )
                refreshed = self._get_task_from_conn(conn, task_id)
                return refreshed if refreshed is not None else updated
            return updated

    async def update_task_review_fields(
        self,
        task_id: str,
        review_mode: str | object = _UNSET,
        reviewer_assignee: str | None | object = _UNSET,
        tags: list[Any] | tuple[Any, ...] | None | object = _UNSET,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._update_task_review_fields,
            task_id,
            review_mode,
            reviewer_assignee,
            tags,
        )

    def _update_task_review_fields(
        self,
        task_id: str,
        review_mode: str | object,
        reviewer_assignee: str | None | object,
        tags: list[Any] | tuple[Any, ...] | None | object,
    ) -> dict[str, Any] | None:
        sets: list[str] = []
        params: list[Any] = []
        if review_mode is not _UNSET:
            if not isinstance(review_mode, str) or review_mode not in REVIEW_MODES:
                raise ValueError(f"review_mode invalido: {review_mode!r}")
            sets.append("review_mode = ?")
            params.append(review_mode)
        if reviewer_assignee is not _UNSET:
            if reviewer_assignee is not None and not isinstance(reviewer_assignee, str):
                raise ValueError("reviewer_assignee deve ser string ou None")
            sets.append("reviewer_assignee = ?")
            params.append(reviewer_assignee)
        if tags is not _UNSET:
            if tags is not None and not isinstance(tags, (list, tuple)):
                raise ValueError("tags deve ser lista, tupla ou None")
            sets.append("tags = ?")
            params.append(_json_array_or_none(tags))

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
            return self._get_task_from_conn(conn, task_id)

    @staticmethod
    def _close_open_runs_for_status(
        conn: sqlite3.Connection,
        *,
        task_id: str,
        task_status: str,
        ended_at: int,
    ) -> int:
        if task_status not in {"review", "blocked", "done"}:
            return 0
        run_status = "blocked" if task_status == "blocked" else "done"
        outcome = task_status
        cur = conn.execute(
            """
            UPDATE task_runs
            SET status = ?,
                ended_at = COALESCE(ended_at, ?),
                outcome = COALESCE(outcome, ?)
            WHERE task_id = ?
              AND ended_at IS NULL
              AND status = 'running'
            """,
            (run_status, ended_at, outcome, task_id),
        )
        return cur.rowcount

    async def delete_task(self, task_id: str) -> bool:
        return await asyncio.to_thread(self._delete_task, task_id)

    def _delete_task(self, task_id: str) -> bool:
        with self._connect() as conn, conn:
            cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            return cur.rowcount > 0

    # ---------- agent_instances ----------

    async def create_agent_instance(
        self,
        *,
        agent_slug: str,
        cli: str,
        model: str,
        is_subagent: bool,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._create_agent_instance,
            agent_slug=agent_slug,
            cli=cli,
            model=model,
            is_subagent=is_subagent,
        )

    def _create_agent_instance(
        self, *, agent_slug: str, cli: str, model: str, is_subagent: bool
    ) -> dict[str, Any]:
        now = int(time.time())
        instance_id = str(uuid.uuid4())
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            cur = conn.execute(
                """
                SELECT COALESCE(MAX(instance_num), 0) + 1 AS next_num
                FROM agent_instances
                WHERE agent_slug = ?
                """,
                (agent_slug,),
            )
            instance_num = int(cur.fetchone()["next_num"])
            tmux_session = None
            if not is_subagent and cli in {"claude_code", "codex"}:
                tmux_session = f"{agent_slug}-{instance_num}"
            conn.execute(
                """
                INSERT INTO agent_instances (
                    id, agent_slug, instance_num, tmux_session, cli, model,
                    is_subagent, status, started_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?)
                """,
                (
                    instance_id,
                    agent_slug,
                    instance_num,
                    tmux_session,
                    cli,
                    model,
                    1 if is_subagent else 0,
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE agent_state
                SET instance_count = (
                    SELECT COUNT(*) FROM agent_instances
                    WHERE agent_slug = ? AND ended_at IS NULL
                )
                WHERE slug = ?
                """,
                (agent_slug, agent_slug),
            )
            conn.commit()

        instance = self._get_agent_instance(instance_id)
        assert instance is not None
        return instance

    async def end_agent_instance(
        self, *, agent_slug: str, instance_id: str
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._end_agent_instance, agent_slug=agent_slug, instance_id=instance_id
        )

    def _end_agent_instance(
        self, *, agent_slug: str, instance_id: str
    ) -> dict[str, Any] | None:
        now = int(time.time())
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM agent_instances WHERE id = ? AND agent_slug = ?",
                (instance_id, agent_slug),
            ).fetchone()
            if row is None:
                conn.rollback()
                return None
            conn.execute(
                """
                UPDATE agent_instances
                SET status = 'done', ended_at = COALESCE(ended_at, ?)
                WHERE id = ? AND agent_slug = ?
                """,
                (now, instance_id, agent_slug),
            )
            conn.execute(
                """
                UPDATE agent_state
                SET instance_count = (
                    SELECT COUNT(*) FROM agent_instances
                    WHERE agent_slug = ? AND ended_at IS NULL
                )
                WHERE slug = ?
                """,
                (agent_slug, agent_slug),
            )
            conn.commit()
            row_dict = dict(row)
            row_dict["status"] = "done"
            row_dict["ended_at"] = row_dict["ended_at"] or now
            return self._row_to_instance_dict(row_dict)

    async def get_agent_instance(self, instance_id: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_agent_instance, instance_id)

    def _get_agent_instance(self, instance_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM agent_instances WHERE id = ?",
                (instance_id,),
            ).fetchone()
            return self._row_to_instance(row) if row is not None else None

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
        return GrupoBorgesDB._row_to_instance_dict(dict(row))

    @staticmethod
    def _row_to_instance_dict(d: dict[str, Any]) -> dict[str, Any]:
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
                       s.current_task_id, s.last_seen, s.pane_excerpt,
                       s.lifecycle_status, s.lifecycle_detail, s.lifecycle_event,
                       s.lifecycle_updated_at, s.instance_count
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

            latest_event_rows = conn.execute(
                """
                SELECT e.agent_slug, e.kind, e.payload, e.created_at
                FROM task_events e
                JOIN (
                    SELECT agent_slug, MAX(id) AS max_id
                    FROM task_events
                    WHERE agent_slug IS NOT NULL
                    GROUP BY agent_slug
                ) latest
                  ON latest.agent_slug = e.agent_slug
                 AND latest.max_id = e.id
                """
            ).fetchall()
            latest_lifecycle_by_slug: dict[str, dict[str, Any]] = {}
            for row in latest_event_rows:
                payload = None
                if row["payload"]:
                    try:
                        payload = json.loads(row["payload"])
                    except json.JSONDecodeError:
                        payload = None
                status, detail = derive_lifecycle_from_event(row["kind"], payload)
                if status is None and detail is None:
                    continue
                latest_lifecycle_by_slug[row["agent_slug"]] = {
                    "status": status,
                    "detail": detail,
                    "event": row["kind"],
                    "updated_at": row["created_at"],
                }

            task_counts = {
                row["status"]: row["cnt"]
                for row in conn.execute(
                    "SELECT status, COUNT(*) AS cnt FROM tasks GROUP BY status"
                ).fetchall()
            }
            active_task_rows = conn.execute(
                """
                SELECT assignee,
                       COALESCE(human_id, id) AS display_id,
                       status,
                       priority,
                       COALESCE(started_at, created_at) AS activity_at,
                       (
                           SELECT last_heartbeat
                           FROM task_runs
                           WHERE task_id = tasks.id
                           ORDER BY
                               CASE WHEN ended_at IS NULL THEN 0 ELSE 1 END,
                               started_at DESC,
                               id DESC
                           LIMIT 1
                       ) AS run_last_heartbeat
                FROM tasks
                WHERE status IN ('running', 'ready', 'backlog')
                ORDER BY
                    CASE status
                        WHEN 'running' THEN 0
                        WHEN 'ready' THEN 1
                        WHEN 'backlog' THEN 2
                        ELSE 3
                    END,
                    priority DESC,
                    activity_at DESC
                """
            ).fetchall()
            current_task_by_agent: dict[str, dict[str, Any]] = {}
            for row in active_task_rows:
                current_task_by_agent.setdefault(
                    row["assignee"],
                    {
                        "display_id": row["display_id"],
                        "last_heartbeat": row["run_last_heartbeat"],
                    },
                )

        # Hidrata cada agente com instances ativas, status derivado e buckets gap-filled.
        for agent in agents:
            slug = agent["slug"]
            agent_instances = by_slug.get(slug, [])
            current_task = current_task_by_agent.get(slug)
            agent["current_task_id"] = current_task["display_id"] if current_task else None
            agent["current_task_last_heartbeat"] = (
                current_task["last_heartbeat"] if current_task else None
            )
            if agent.get("lifecycle_status") is None:
                latest_lifecycle = latest_lifecycle_by_slug.get(slug)
                if latest_lifecycle is not None:
                    agent["lifecycle_status"] = latest_lifecycle["status"]
                    agent["lifecycle_detail"] = latest_lifecycle["detail"]
                    agent["lifecycle_event"] = latest_lifecycle["event"]
                    agent["lifecycle_updated_at"] = latest_lifecycle["updated_at"]
            agent["instances"] = agent_instances
            agent["status"] = derive_agent_status(
                agent["last_seen"],
                agent_instances,
                lifecycle_status=agent.get("lifecycle_status"),
                lifecycle_updated_at=agent.get("lifecycle_updated_at"),
                current_task_id=agent.get("current_task_id"),
                now=now,
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
                "stale_threshold_seconds": RUN_STALE_THRESHOLD_SECONDS,
            },
        }
