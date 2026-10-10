"""Associa telemetria à conversa do processo vivo, sem escolher por mtime."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import NamedTuple

from services import tmux_driver


class ClaudeRuntime(NamedTuple):
    session_id: str
    status: str | None


def _read_runtime(session: str, workspace: str) -> ClaudeRuntime | None:
    server = tmux_driver._server_for(session)
    if not server.has_session(session):
        return None
    agent_session = server.sessions.get(session_name=session)
    panes = [pane for window in agent_session.windows for pane in window.panes]
    found: set[ClaudeRuntime] = set()
    for pane in panes:
        for pid in tmux_driver._pane_owner_pids(int(pane.pane_pid)):
            try:
                argv = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
                names = {Path(arg.decode()).name for arg in argv[:2] if arg}
                if not names.intersection({"claude", "claude.exe", "cli.js"}):
                    continue
                if b"-p" in argv or b"--print" in argv:
                    continue
                data = json.loads((Path.home() / ".claude/sessions" / f"{pid}.json").read_text())
                sid = data.get("sessionId")
                if (data.get("pid") != pid or not isinstance(sid, str)
                        or not tmux_driver._SESSION_ID_PATTERN.fullmatch(sid)
                        or Path(data.get("cwd", "")).resolve() != Path(workspace).resolve()):
                    continue
                status = data.get("status")
                found.add(ClaudeRuntime(sid, status if status in {"idle", "busy"} else None))
            except (OSError, ValueError, TypeError, AttributeError):
                continue
    return next(iter(found)) if len(found) == 1 else None


async def read_runtime(session: str, workspace: str) -> ClaudeRuntime | None:
    try:
        return await asyncio.to_thread(_read_runtime, session, workspace)
    except Exception:  # Falha de observação não vira contexto de outra conversa.
        return None


def read_status(session_id: str) -> dict | None:
    try:
        payload = json.loads((Path("/tmp") / f"cc-status-{session_id}.json").read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("session_id") != session_id:
        return None
    return payload
