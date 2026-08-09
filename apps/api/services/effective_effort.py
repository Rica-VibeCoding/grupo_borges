"""Leitura somente-leitura do esforço efetivo de um agente.

O valor persistido em ``agent_state`` é a intenção do painel, não a
configuração em vigor. Este módulo consulta apenas a fonte viva de cada
executor:

* Codex: ``threads.reasoning_effort`` no state SQLite do Codex;
* Claude Code e motores compatíveis: ``effort.level`` no snapshot da
  statusline da sessão.

Quando a fonte não pode ser lida, ou não traz um nível válido, ``value`` é
``None``. Em particular, este leitor nunca faz fallback para os campos de
esforço pedido em ``agent_state``.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

from services import codex_reader

CODEX_STATE_DB = codex_reader.STATE_DB
CC_STATUS_DIR = Path("/tmp")
CC_STATUS_PREFIX = "cc-status-"

# É o conjunto documentado pelo statusline do Claude Code. O mesmo conjunto
# cobre os valores expostos pelo painel para Codex neste momento.
KNOWN_EFFORTS = frozenset(("low", "medium", "high", "xhigh", "max"))


@dataclass(frozen=True)
class EffectiveEffort:
    """Resultado de uma tentativa de leitura do esforço em vigor.

    ``source`` identifica o arquivo consultado, inclusive quando ele existe
    mas não contém um valor utilizável. Quando nem sequer há uma sessão
    identificável, fica ``None``.
    """

    value: str | None
    source: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def read_effective_effort(
    agent: Mapping[str, Any],
    *,
    session_id: str | None = None,
    codex_db_path: str | Path = CODEX_STATE_DB,
    status_dir: str | Path = CC_STATUS_DIR,
) -> EffectiveEffort:
    """Lê o esforço efetivo sem usar o esforço pedido como fallback.

    ``session_id`` é o UUID da sessão do Claude Code que alimentou a
    statusline; ele não é o nome da sessão tmux. Se omitido, o leitor aceita
    um ``session_id``/``sessionId`` já resolvido no próprio mapa do agente.
    Resolver a sessão mais recente a partir dos eventos do banco continua
    sendo responsabilidade do chamador, porque uma sessão anterior não é
    evidência do valor da sessão atual.
    """

    if _is_codex(agent):
        return _read_codex_effort(agent, Path(codex_db_path))

    resolved_session_id = session_id or _agent_session_id(agent)
    if resolved_session_id is None:
        return EffectiveEffort(value=None, source=None)
    return _read_statusline_effort(resolved_session_id, Path(status_dir))


def _is_codex(agent: Mapping[str, Any]) -> bool:
    return agent.get("executor_kind") == "codex" or agent.get("cli_default") == "codex"


def _read_codex_effort(agent: Mapping[str, Any], db_path: Path) -> EffectiveEffort:
    source = str(db_path)
    try:
        thread = codex_reader.resolve_thread(
            thread_id=_string_or_none(agent.get("codex_thread_id")),
            cwd=_string_or_none(agent.get("workspace_path")) or codex_reader.TARA_CWD,
            db_path=db_path,
            telecodex_context_path=None,
        )
    except (OSError, sqlite3.Error, TypeError, ValueError):
        # Um state ausente, incompleto ou momentaneamente ilegível não pode
        # derrubar o snapshot do cockpit nem virar o valor pedido por acidente.
        return EffectiveEffort(value=None, source=source)

    if thread is None:
        return EffectiveEffort(value=None, source=source)
    return EffectiveEffort(value=_known_effort(thread.reasoning_effort), source=source)


def _read_statusline_effort(session_id: str, status_dir: Path) -> EffectiveEffort:
    clean_session_id = session_id.strip() if isinstance(session_id, str) else ""
    if not clean_session_id or Path(clean_session_id).name != clean_session_id:
        return EffectiveEffort(value=None, source=None)

    path = status_dir / f"{CC_STATUS_PREFIX}{clean_session_id}.json"
    source = str(path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        return EffectiveEffort(value=None, source=source)

    if not isinstance(payload, dict):
        return EffectiveEffort(value=None, source=source)
    effort = payload.get("effort")
    if not isinstance(effort, dict):
        return EffectiveEffort(value=None, source=source)
    return EffectiveEffort(value=_known_effort(effort.get("level")), source=source)


def _agent_session_id(agent: Mapping[str, Any]) -> str | None:
    for key in ("session_id", "sessionId", "cc_session_id", "status_session_id"):
        value = _string_or_none(agent.get(key))
        if value is not None:
            return value
    return None


def _string_or_none(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _known_effort(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value in KNOWN_EFFORTS else None


__all__ = [
    "CC_STATUS_DIR",
    "CC_STATUS_PREFIX",
    "CODEX_STATE_DB",
    "EffectiveEffort",
    "KNOWN_EFFORTS",
    "read_effective_effort",
]
