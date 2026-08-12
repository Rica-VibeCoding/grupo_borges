"""TK-25 — leitor READ-ONLY do estado local do Codex (Tara).

Lê `~/.codex/state_5.sqlite` (modo ro) pra achar a thread atual da Tara e
parseia o rollout JSONL convertendo só o que é seguro pra UI. NUNCA escreve
no SQLite e NUNCA expõe `base_instructions`, prompts developer/system,
reasoning ou tool I/O — tudo isso vira item `internal` com texto redigido.

Conversa real:
- `payload.type=message` + `role=assistant` → bolha da Tara.
- `payload.type=message` + `role=user` → bolha do usuário, MAS só quando não
  for injeção de contexto de ambiente (AGENTS.md, `<INSTRUCTIONS>`, permissions).
- developer/system, reasoning, function_call_output → internos.
- function_call → visível só com comando/nome resumido; output segue redigido.
"""
from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CODEX_HOME = Path.home() / ".codex"
STATE_DB = CODEX_HOME / "state_5.sqlite"
TARA_CWD = "/home/clawd/repos/ze_claude/tara"
TELECODEX_CONTEXTS = Path(TARA_CWD) / ".telecodex" / "contexts.json"

# Thread store por delegator — o wrapper `scripts/tara-codex` grava
# `~/.tara/threads/<delegator>.txt` quando o run emite `thread.started`. A
# thread do COCKPIT é a do delegator `cockpit`, não a do `codex_thread_id` do
# agent_state (único, sobrescrito por qualquer delegator — o Daniel rodando a
# Tara por outro canal apontaria o cockpit pra thread alheia). Opção A, 10/08.
COCKPIT_THREAD_FILE = Path.home() / ".tara" / "threads" / "cockpit.txt"

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
    # Catálogo de plugins que o runtime injeta como se fosse fala do Rica —
    # apareceu cru no chat da Tara em 09/08, com dezenas de linhas de lista.
    "<recommended_plugins>",
)

# payload.type que, quando role=message, podem virar conversa visível.
_VISIBLE_ROLES = ("user", "assistant")

_AUDIO_SKILL_PREFIX = (
    "Use $audio-telegram-resumo nesta sessão. A entrada veio por áudio do Rica; "
    "responda em áudios curtos por etapa até a demanda encerrar."
)
_AUDIO_TRANSCRIPT_PREFIX = "Mensagem transcrita do áudio do Rica:"

# Régua de formatação que o wrapper `tara-codex` injeta no prompt de TODO turno
# com delegator=cockpit (`scripts/tara-codex`, bloco "régua do cockpit"). O Codex
# grava o prompt completo como user message, então sem este corte o Rica via o
# texto da skill inteira na bolha dele — e o `reconciliaPendentes` do front, que
# casa por texto exato, nunca achava o que ele digitou (medido 10/08: "ola tara"
# embutido no meio da régua, composer preso em 'aceito').
_COCKPIT_REGUA_MARKER = "esta mensagem chegou pelo cockpit do grupo_borges"
_COCKPIT_REGUA_SEPARATOR = "\n\n---\n\n"


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


def _strip_audio_skill_prefix(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith(_AUDIO_SKILL_PREFIX):
        return text
    rest = stripped[len(_AUDIO_SKILL_PREFIX) :].lstrip()
    if rest.startswith(_AUDIO_TRANSCRIPT_PREFIX):
        return rest[len(_AUDIO_TRANSCRIPT_PREFIX) :].lstrip()
    return rest


def _strip_cockpit_regua(text: str) -> str:
    """Tira a régua do cockpit de uma user message, deixando só a fala do Rica.

    Conservador: sem o marcador ou sem o separador, devolve o texto intacto.
    O marcador é o início fixo da régua (frase estável do wrapper); o separador
    é o `\n\n---\n\n` que o wrapper injeta entre a régua e o prompt do usuário.
    """
    stripped = text.lstrip()
    if not stripped.lower().startswith(_COCKPIT_REGUA_MARKER):
        return text
    idx = stripped.find(_COCKPIT_REGUA_SEPARATOR)
    if idx == -1:
        return text
    return stripped[idx + len(_COCKPIT_REGUA_SEPARATOR) :].strip()


# Marcador da skill de áudio: delimita o trecho que vira fala, e some do texto
# escrito. O que está DENTRO é resposta de verdade pro Rica — some o marcador,
# nunca o conteúdo. `[[voz]]\nSim.\n[[/voz]]` tem que sobreviver como "Sim.".
_VOICE_MARKER_RE = re.compile(r"\[\[/?voz\]\]")

# Envelope de anexo do bridge telecodex: `<image name=[Image #1] path="...">`
# seguido de `</image>`. As TAGS saem, o miolo fica — no caso comum o miolo é
# vazio e o texto útil vem logo depois ("muito alto"), mas se um dia vier
# conteúdo dentro, apagá-lo seria perder fala do Rica.
_IMAGE_ENVELOPE_RE = re.compile(r"</?image\b[^>]*>", re.IGNORECASE)

# Três quebras ou mais viram duas: tirar marcador no meio do texto deixa buraco.
_EXTRA_BLANK_LINES_RE = re.compile(r"\n{3,}")


def _strip_channel_envelopes(text: str) -> str:
    """Tira marcação de transporte que não é fala, preservando o que é.

    Vazava direto pra tela do Rica em 09/08 — `[[voz]]` cru no meio da resposta
    e o envelope de anexo com o path do .jpg. Nenhum dos dois é conversa: são
    etiquetas que a skill de áudio e o bridge telecodex põem no caminho.
    """
    if not text:
        return text
    limpo = _VOICE_MARKER_RE.sub("", text)
    limpo = _IMAGE_ENVELOPE_RE.sub("", limpo)
    limpo = _EXTRA_BLANK_LINES_RE.sub("\n\n", limpo)
    return limpo.strip()


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


def _summarize_function_call(payload: dict[str, Any]) -> str:
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip():
        name = "function_call"
    name = name.strip()

    arguments = payload.get("arguments")
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except (json.JSONDecodeError, ValueError):
            arguments = {"arguments": arguments}
    if not isinstance(arguments, dict):
        arguments = {}

    for key in ("cmd", "command", "shell_command"):
        value = arguments.get(key)
        if isinstance(value, str) and value.strip():
            text = value.strip()
            return text[:240]

    if name in {"exec_command", "shell"} and isinstance(arguments.get("argv"), list):
        argv = [str(item) for item in arguments["argv"] if item is not None]
        if argv:
            return " ".join(argv)[:240]

    return name[:120]


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
                text = _strip_audio_skill_prefix(_extract_text(payload))
                text = _strip_cockpit_regua(text)
                # A classificação vem ANTES da limpeza, de propósito: quem
                # decide "isto é contexto injetado" olha os marcadores do texto
                # cru. Limpar primeiro apagaria a prova e o lixo viraria bolha.
                role_out, visible = classify_message(role_in, text)
                text = _strip_channel_envelopes(text) if visible else text
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
            elif item_type == "function_call":
                messages.append(
                    CodexMessage(
                        id=msg_id,
                        role="internal",
                        text=_summarize_function_call(payload),
                        timestamp=timestamp,
                        item_type=item_type,
                        visible=True,
                    )
                )
            else:
                # reasoning / function_call_output / etc → interno,
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


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def _pct_or_none(used: int | None, total: int | None) -> float | None:
    if used is None or total is None or total <= 0:
        return None
    return round(max(0, min(100, used * 100 / total)), 1)


def _epoch_or_none(value: Any) -> int | None:
    """Timestamp do rollout vem ISO (`2026-08-07T21:32:00.123Z`) ou epoch."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp())
    return None


def normalize_token_count_payload(
    payload: dict[str, Any],
    *,
    observed_at: int | None = None,
) -> dict[str, Any] | None:
    """`observed_at` é QUANDO a cota foi medida na origem, não quando alguém leu.

    Sem ele o painel carimbava `time.time()` na leitura e a cota da Tara nunca
    envelhecia: agente parado há horas aparecia com dado "de agora".
    """
    if payload.get("type") != "token_count":
        return None
    info = payload.get("info") if isinstance(payload.get("info"), dict) else {}
    last_usage = info.get("last_token_usage")
    total_usage = info.get("total_token_usage")
    if not isinstance(last_usage, dict):
        return None

    context_window = _int_or_none(info.get("model_context_window"))
    if context_window is None:
        context_window = _int_or_none(payload.get("model_context_window"))
    context_tokens = _int_or_none(last_usage.get("total_tokens"))
    return {
        "source": "codex.event_msg.token_count",
        "usage": last_usage,
        "total_usage": total_usage if isinstance(total_usage, dict) else None,
        "model_context_window": context_window,
        "context_tokens": context_tokens,
        "context_pct": _pct_or_none(context_tokens, context_window),
        "rate_limits": payload.get("rate_limits") if isinstance(payload.get("rate_limits"), dict) else None,
        "observed_at": observed_at,
    }


def read_latest_token_count(path: str | Path) -> dict[str, Any] | None:
    p = Path(path)
    if not p.exists():
        return None
    latest: dict[str, Any] | None = None
    latest_context_window: int | None = None
    with p.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
            if not isinstance(row, dict) or row.get("type") != "event_msg":
                continue
            payload = row.get("payload")
            if not isinstance(payload, dict):
                continue
            info = payload.get("info") if isinstance(payload.get("info"), dict) else {}
            context_window = _int_or_none(info.get("model_context_window"))
            if context_window is None:
                context_window = _int_or_none(payload.get("model_context_window"))
            if context_window is not None:
                latest_context_window = context_window
            snapshot = normalize_token_count_payload(
                payload,
                observed_at=_epoch_or_none(row.get("timestamp")),
            )
            if snapshot is not None:
                if snapshot["model_context_window"] is None and latest_context_window is not None:
                    snapshot["model_context_window"] = latest_context_window
                    snapshot["context_pct"] = _pct_or_none(
                        snapshot["context_tokens"],
                        latest_context_window,
                    )
                latest = snapshot
    return latest


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


def _read_telecodex_thread_id(cwd: str, context_path: str | Path) -> str | None:
    p = Path(context_path)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, list):
        return None

    candidates: list[tuple[int, str]] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        if entry.get("workspace") != cwd:
            continue
        thread_id = entry.get("threadId")
        if not isinstance(thread_id, str) or not thread_id.strip():
            continue
        updated_at = entry.get("updatedAt")
        if not isinstance(updated_at, int):
            updated_at = 0
        candidates.append((updated_at, thread_id.strip()))

    if not candidates:
        return None
    return max(candidates)[1]


def read_cockpit_thread_id(thread_file: str | Path | None = None) -> str | None:
    """Thread do DELEGATOR COCKPIT, lida do store que o wrapper grava por run.

    `None` quando o cockpit ainda não rodou turno nenhum (primeira conversa
    nasce fresh). Quem decide se a thread ainda existe no SQLite é o chamador,
    validando com `resolve_thread` — o arquivo é só o lembrete do último run.

    O default sai de `COCKPIT_THREAD_FILE` em runtime, não na assinatura: como
    valor padrão ele congelaria no import e o módulo deixaria de ser
    redirecionável por teste, igual `TELECODEX_CONTEXTS` já é.
    """
    p = Path(thread_file if thread_file is not None else COCKPIT_THREAD_FILE)
    if not p.exists():
        return None
    try:
        text = p.read_text(encoding="utf-8").strip()
    except (OSError, ValueError):
        return None
    return text if text else None


_THREAD_COLUMNS = """
    SELECT id, rollout_path, cwd, title, model, reasoning_effort,
           tokens_used, updated_at_ms, created_at_ms
    FROM threads
"""


def _fetch_thread_by_id(
    conn: sqlite3.Connection, thread_id: str, cwd: str | None = None
) -> sqlite3.Row | None:
    if cwd is None:
        # Id do run em execução: nem cwd nem arquivamento entram como critério.
        # O id já É a resposta — filtrar aqui devolveria o painel à heurística
        # que servia a thread do run anterior.
        return conn.execute(f"{_THREAD_COLUMNS} WHERE id = ? LIMIT 1", (thread_id,)).fetchone()
    return conn.execute(
        f"{_THREAD_COLUMNS} WHERE id = ? AND cwd = ? AND archived = 0 LIMIT 1",
        (thread_id, cwd),
    ).fetchone()


def _fetch_latest_thread(conn: sqlite3.Connection, cwd: str) -> sqlite3.Row | None:
    return conn.execute(
        f"""
        {_THREAD_COLUMNS}
        WHERE cwd = ? AND archived = 0
        ORDER BY updated_at_ms DESC, updated_at DESC
        LIMIT 1
        """,
        (cwd,),
    ).fetchone()


def _connect_ro(db_path: str | Path) -> sqlite3.Connection | None:
    """Read-only via URI — defesa em profundidade contra escrita no banco do Codex."""
    p = Path(db_path)
    if not p.exists():
        return None
    conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=2.0)
    conn.row_factory = sqlite3.Row
    return conn


def resolve_thread(
    *,
    thread_id: str | None,
    cwd: str = TARA_CWD,
    db_path: str | Path = STATE_DB,
    telecodex_context_path: str | Path | None = TELECODEX_CONTEXTS,
) -> CodexThread | None:
    """Thread do run em execução: o id manda, o cwd é só o plano B.

    O run é disparado com `-C <repo do dia>` e o Codex indexa a thread pelo cwd
    REAL do run — procurar pelo workspace cadastrado do agente devolve o run
    ANTERIOR, com o contexto e o modelo dele. O id vem do `thread.started` que o
    próprio run emite; sem ele (agente que nunca reportou), a heurística antiga
    ainda é melhor que painel vazio.
    """
    if thread_id:
        conn = _connect_ro(db_path)
        if conn is not None:
            try:
                row = _fetch_thread_by_id(conn, thread_id)
            finally:
                conn.close()
            if row is not None:
                return _row_to_thread(row)
    return find_latest_thread(cwd, db_path, telecodex_context_path)


def find_latest_thread(
    cwd: str = TARA_CWD,
    db_path: str | Path = STATE_DB,
    telecodex_context_path: str | Path | None = TELECODEX_CONTEXTS,
) -> CodexThread | None:
    """Acha a thread ativa do `cwd` no state do Codex.

    Abre o SQLite em modo read-only via URI — defesa em profundidade contra
    qualquer escrita acidental no banco do Codex.
    """
    conn = _connect_ro(db_path)
    if conn is None:
        return None
    try:
        row = None
        if telecodex_context_path is not None:
            thread_id = _read_telecodex_thread_id(cwd, telecodex_context_path)
            if thread_id is not None:
                row = _fetch_thread_by_id(conn, thread_id, cwd)
        if row is None:
            row = _fetch_latest_thread(conn, cwd)
    finally:
        conn.close()
    return _row_to_thread(row) if row else None


def read_latest_conversation(
    cwd: str = TARA_CWD,
    db_path: str | Path = STATE_DB,
    *,
    thread_id: str | None = None,
) -> tuple[CodexThread | None, list[CodexMessage]]:
    """Atalho: thread atual + mensagens parseadas do rollout dela.

    ``thread_id`` é a thread do DELEGATOR COCKPIT (o ``codex_thread_id`` que o
    evento ``codex.thread.started`` do wrapper gravou no agent_state). Quando
    vem explícita, a conversa é a do cockpit — sem cair no fallback do
    telecodex, que puxaria a thread da sessão interativa do tmux (opção A,
    10/08). Sem thread do cockpit ainda, devolve vazio: o cockpit não tem
    conversa própria até a primeira mensagem.
    """
    if thread_id:
        conn = _connect_ro(db_path)
        if conn is not None:
            try:
                row = _fetch_thread_by_id(conn, thread_id)
            finally:
                conn.close()
            if row is not None:
                thread = _row_to_thread(row)
                return thread, parse_rollout(thread.rollout_path, thread_id=thread.thread_id)
        return None, []
    thread = find_latest_thread(cwd, db_path)
    if thread is None:
        return None, []
    return thread, parse_rollout(thread.rollout_path, thread_id=thread.thread_id)
