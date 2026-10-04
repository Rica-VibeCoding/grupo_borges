#!/usr/bin/env python3
"""Statusline do Claude Code: preserva o payload para contexto e cotas na API."""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        return 0
    if not isinstance(payload, dict):
        return 0
    session_id = payload.get("session_id")
    if not isinstance(session_id, str) or not re.fullmatch(r"[0-9a-fA-F-]{36}", session_id):
        return 0
    folder = Path(os.environ.get("PAINEL_STATUS_DIR", "/tmp"))
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / f"cc-status-{session_id}.json"
    with tempfile.NamedTemporaryFile(mode="w", dir=folder, prefix=".cc-status-",
                                     delete=False, encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
        temporary = handle.name
    os.chmod(temporary, 0o600)
    os.replace(temporary, destination)
    model = payload.get("model") or {}
    context = payload.get("context_window") or {}
    cost = payload.get("cost") or {}
    name = model.get("display_name") if isinstance(model, dict) else None
    pct = context.get("used_percentage") if isinstance(context, dict) else None
    duration_ms = cost.get("total_duration_ms") if isinstance(cost, dict) else None
    if isinstance(duration_ms, (int, float)) and not isinstance(duration_ms, bool) and duration_ms >= 0:
        seconds = int(duration_ms / 1000)
        duration = f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"
    else:
        duration = None
    if isinstance(pct, (int, float)) and not isinstance(pct, bool):
        percent = max(0, min(100, round(pct)))
        filled = percent // 10
        bar = "█" * filled + "░" * (10 - filled)
        print(f"{name or 'Claude'}{' - ' + duration if duration else ''} - [{bar}] {percent}%")
    else:
        print(name or "Claude")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
