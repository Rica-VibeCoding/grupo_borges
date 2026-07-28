#!/usr/bin/env python3
"""Poda de retenção da tabela `task_events` do cockpit.

Motivação (2026-07-28): `task_events` acumulava desde maio sem retenção —
360k linhas / 2,4 GB. `_hydrate_cc_context_pct` roda uma query de agregação
por agente a cada carga do painel, e o custo cresce junto com a tabela:
`/api/fleet` chegou a 5,6s, sendo 5,3s só nesse hydrate.

Mantém os eventos ligados a uma task (`task_id IS NOT NULL`) — são poucas
centenas e alimentam o histórico do card no cockpit. O peso mora nos eventos
de espelho do JSONL (`jsonl:*`), que ficam sem `task_id`.

Uso:
    python3 scripts/prune_task_events.py --dry-run
    python3 scripts/prune_task_events.py --days 30 --vacuum
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "db" / "grupo_borges.db"
BATCH = 5_000


def human_mb(num_bytes: int) -> str:
    return f"{num_bytes / 1048576:,.0f} MB"


def db_size(path: Path) -> int:
    total = path.stat().st_size
    for suffix in ("-wal", "-shm"):
        sidecar = path.with_name(path.name + suffix)
        if sidecar.exists():
            total += sidecar.stat().st_size
    return total


def prune(db_path: Path, days: int, dry_run: bool, do_vacuum: bool) -> int:
    cutoff = int(time.time()) - days * 86400
    size_before = db_size(db_path)

    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.execute("PRAGMA busy_timeout = 30000")

    total, payload_bytes = conn.execute(
        """SELECT COUNT(*), COALESCE(SUM(LENGTH(payload) + LENGTH(COALESCE(raw_jsonl, ''))), 0)
           FROM task_events WHERE created_at < ? AND task_id IS NULL""",
        (cutoff,),
    ).fetchone()

    print(f"banco     {db_path} ({human_mb(size_before)})")
    print(f"corte     created_at < {cutoff} (>{days} dias)")
    print(f"alvo      {total:,} eventos · {human_mb(payload_bytes)} de payload")

    if dry_run:
        print("dry-run   nada apagado")
        conn.close()
        return 0

    if not total:
        conn.close()
        return 0

    deleted = 0
    started = time.time()
    while True:
        cur = conn.execute(
            """DELETE FROM task_events WHERE id IN (
                   SELECT id FROM task_events
                   WHERE created_at < ? AND task_id IS NULL LIMIT ?
               )""",
            (cutoff, BATCH),
        )
        conn.commit()
        if not cur.rowcount:
            break
        deleted += cur.rowcount
        print(f"  apagados {deleted:,}/{total:,}", end="\r", flush=True)

    print(f"  apagados {deleted:,} eventos em {time.time() - started:.1f}s")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    if do_vacuum:
        print("vacuum    recompactando (pode demorar alguns minutos)...")
        started = time.time()
        try:
            conn.execute("VACUUM")
            print(f"vacuum    ok em {time.time() - started:.1f}s")
        except sqlite3.OperationalError as exc:
            # VACUUM precisa de lock exclusivo — a API pode estar escrevendo.
            print(f"vacuum    falhou ({exc}) — reservar janela com a API parada")

    conn.close()
    size_after = db_size(db_path)
    print(f"tamanho   {human_mb(size_before)} → {human_mb(size_after)}")
    return deleted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--days", type=int, default=30, help="retenção em dias (default: 30)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--vacuum", action="store_true", help="recompacta o arquivo ao final")
    args = parser.parse_args()

    if not args.db.exists():
        print(f"banco não encontrado: {args.db}", file=sys.stderr)
        return 1

    print(f"--- poda task_events · {time.strftime('%Y-%m-%d %H:%M:%S %z')} ---")
    prune(args.db, args.days, args.dry_run, args.vacuum)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
