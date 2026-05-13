"""
Parser de checkpoint emitido por agentes no cockpit.

Formato esperado (última ocorrência no output do agente):
    STATE: DONE
    SUMMARY: Breve descrição
    FILES_CHANGED: path/a, path/b
    NEXT_STEP: -
    HANDOFF_TO: pavan  # só se STATE=HANDOFF

Gotcha re.MULTILINE: ^ ancora somente após \\n. Tmux capture-pane pode retornar
\\r\\n (CRLF). Normalizamos pra \\n antes de aplicar o regex.
"""
from __future__ import annotations

import hashlib
import re
from typing import TypedDict

_STATE_RE = re.compile(
    r"^STATE:\s+(DONE|BLOCKED|NEEDS_INPUT|HANDOFF|IN_PROGRESS)\s*$",
    re.MULTILINE,
)

_FIELDS_RE = re.compile(
    r"^(STATE|SUMMARY|FILES_CHANGED|NEXT_STEP|HANDOFF_TO):\s*(.*?)\s*$",
    re.MULTILINE,
)


class CheckpointFields(TypedDict, total=False):
    state: str
    summary: str | None
    files_changed: str | None
    next_step: str | None
    handoff_to: str | None


def parse_checkpoint(text: str) -> CheckpointFields | None:
    """Parseia a última ocorrência de STATE: no output do agente.

    Retorna None se nenhum STATE: válido for encontrado.
    """
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    matches = list(_STATE_RE.finditer(normalized))
    if not matches:
        return None

    last_match = matches[-1]
    state = last_match.group(1)

    # Parse campos a partir do último STATE: (bloco de ~800 chars)
    block = normalized[last_match.start():]
    fields: dict[str, str | None] = {}
    for m in _FIELDS_RE.finditer(block):
        key = m.group(1).lower()
        value = m.group(2).strip() or None
        if key not in fields:  # primeira ocorrência de cada campo
            fields[key] = value

    return CheckpointFields(
        state=state,
        summary=fields.get("summary"),
        files_changed=fields.get("files_changed"),
        next_step=fields.get("next_step"),
        handoff_to=fields.get("handoff_to"),
    )


def checkpoint_hash(
    *, state: str, summary: str | None, files_changed: str | None, next_step: str | None
) -> str:
    """Hash determinístico pra chave de idempotência em task_events."""
    raw = f"{state}|{summary or ''}|{files_changed or ''}|{next_step or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]
