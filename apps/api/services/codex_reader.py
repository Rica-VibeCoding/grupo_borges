"""TK-25 — leitor READ-ONLY do estado local do Codex (Tara).

Lê `~/.codex/state_5.sqlite` (modo ro) pra achar a thread atual da Tara e
parseia o rollout JSONL convertendo só o que é seguro pra UI. NUNCA escreve
no SQLite e NUNCA expõe `base_instructions`, prompts developer/system,
reasoning ou tool I/O — tudo isso vira item `internal` com texto redigido.

Conversa real:
- `payload.type=message` + `role=assistant` → bolha da Tara.
- `payload.type=message` + `role=user` → bolha do usuário, MAS só quando não
  for injeção de contexto de ambiente (AGENTS.md, `<INSTRUCTIONS>`, permissions).
- developer/system, reasoning, function_call, function_call_output → internos.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

CODEX_HOME = Path.home() / ".codex"
STATE_DB = CODEX_HOME / "state_5.sqlite"
TARA_CWD = "/home/clawd/repos/ze_claude/tara"

SOURCE = "codex-local"

# Mensagens role=user que na verdade são contexto injetado pelo runtime Codex,
# não conversa do Rica. Marcador no início do texto basta (case-insensitive).
_INSTRUCTION_MARKERS = (
    "# agents.md instructions",
    "<instructions>",
    "<user_instructions>",
    "<environment_context>",
    "<permissions instructions>",
    "<system",
)

# payload.type que, quando role=message, podem virar conversa visível.
_VISIBLE_ROLES = ("user", "assistant")


@dataclass(frozen=True)
class CodexThread:
    thread_id: str
    rollout_path: str
    cwd: str
    title: str
    model: str | None
    reasoning_effort: str | None
    tokens_used: int
    updated_at_ms: int | None
    created_at_ms: int | None
    source: str = SOURCE

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class CodexMessage:
    id: str
    role: str  # 'user' | 'assistant' | 'internal'
    text: str  # '' quando interno/redigido — nunca vaza conteúdo sensível
    timestamp: str
    item_type: str  # 'message' | 'reasoning' | 'function_call' | 'function_call_output' | ...
    visible: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _looks_like_injected_context(text: str) -> bool:
    head = text.lstrip()[:400].lower()
    return any(head.startswith(marker) or marker in head for marker in _INSTRUCTION_MARKERS)


def classify_message(role: str, text: str) -> tuple[str, bool]:
    """Decide o papel exposto e se é visível. Conservador: na dúvida, interno."""
    if role == "assistant":
        return "assistant", True
    if role == "user":
        if _looks_like_injected_context(text):
            return "internal", False
        return "user", True
    # developer, system, tool, qualquer outro → interno.
    return "internal", False


def _extract_text(payload: dict[str, Any]) -> str:
    """Junta os pedaços de texto de `payload.content[]` (input_text/output_text)."""
    content = payload.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict):
            chunk = item.get("text") or item.get("output_text") or ""
            if isinstance(chunk, str) and chunk:
                parts.append(chunk)
    return "\n".join(parts)


def parse_rollout(path: str | Path, *, thread_id: str = "") -> list[CodexMessage]:
    """Parseia o JSONL de rollout em mensagens classificadas e sanitizadas.

    Robusto a linhas corrompidas (pula JSON inválido). Itens internos saem com
    `text=''` — o conteúdo cru nunca é copiado pro objeto retornado.
    """
    messages: list[CodexMessage] = []
    p = Path(path)
    if not p.exists():
        return messages

    with p.open("r", encoding="utf-8", errors="replace") as fh:
        for idx, line in enumerate(fh):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
            if not isinstance(row, dict) or row.get("type") != "response_item":
                continue
            payload = row.get("payload")
            if not isinstance(payload, dict):
                continue

            item_type = str(payload.get("type") or "unknown")
            timestamp = str(row.get("timestamp") or "")
            msg_id = f"{thread_id or 'codex'}:{idx}"

            if item_type == "message":
                role_in = str(payload.get("role") or "")
                text = _extract_text(payload)
                role_out, visible = classify_message(role_in, text)
                messages.append(
                    CodexMessage(
                        id=msg_id,
                        role=role_out,
                        text=text if visible else "",
                        timestamp=timestamp,
                        item_type="message",
                        visible=visible,
                    )
                )
            else:
                # reasoning / function_call / function_call_output / etc → interno,
                # SEM texto. Mantemos a entrada só pra contagem honesta de atividade.
                messages.append(
                    CodexMessage(
                        id=msg_id,
                        role="internal",
                        text="",
                        timestamp=timestamp,
                        item_type=item_type,
                        visible=False,
                    )
                )
    return messages


def _row_to_thread(row: sqlite3.Row) -> CodexThread:
    def _int(value: Any) -> int | None:
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    return CodexThread(
        thread_id=str(row["id"]),
        rollout_path=str(row["rollout_path"]),
        cwd=str(row["cwd"]),
        title=str(row["title"] or ""),
        model=row["model"] if row["model"] else None,
        reasoning_effort=row["reasoning_effort"] if row["reasoning_effort"] else None,
        tokens_used=_int(row["tokens_used"]) or 0,
        updated_at_ms=_int(row["updated_at_ms"]),
        created_at_ms=_int(row["created_at_ms"]),
    )


def find_latest_thread(
    cwd: str = TARA_CWD, db_path: str | Path = STATE_DB
) -> CodexThread | None:
    """Acha a thread mais recente (não arquivada) do `cwd` no state do Codex.

    Abre o SQLite em modo read-only via URI — defesa em profundidade contra
    qualquer escrita acidental no banco do Codex.
    """
    p = Path(db_path)
    if not p.exists():
        return None
    uri = f"file:{p}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=2.0)
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT id, rollout_path, cwd, title, model, reasoning_effort,
                   tokens_used, updated_at_ms, created_at_ms
            FROM threads
            WHERE cwd = ? AND archived = 0
            ORDER BY updated_at_ms DESC, updated_at DESC
            LIMIT 1
            """,
            (cwd,),
        ).fetchone()
    finally:
        conn.close()
    return _row_to_thread(row) if row else None


def read_latest_conversation(
    cwd: str = TARA_CWD, db_path: str | Path = STATE_DB
) -> tuple[CodexThread | None, list[CodexMessage]]:
    """Atalho: thread atual + mensagens parseadas do rollout dela."""
    thread = find_latest_thread(cwd, db_path)
    if thread is None:
        return None, []
    return thread, parse_rollout(thread.rollout_path, thread_id=thread.thread_id)
