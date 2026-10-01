"""Rastro da troca de conversa: o que abre toda conversa nascida de `/clear`.

Régua única do feed (`routers/agents.py`) e da leitura de conversa
(`services/conversas.py`, F14): o que um esconde, o outro também.
"""
from __future__ import annotations

import re
from typing import Any

_ENVELOPE_CLEAR_RE = re.compile(r"^\s*<command-name>/clear</command-name>")
_LEMBRETE_RENAME_RE = re.compile(
    r"^\s*<system-reminder>\s*The user named this session\b[\s\S]*</system-reminder>\s*$"
)


def _texto_do_user(payload: dict[str, Any]) -> str | None:
    message = payload.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list) and len(content) == 1 and isinstance(content[0], dict):
        texto = content[0].get("text")
        return texto if isinstance(texto, str) else None
    return None


def eh_residuo_de_troca(payload: dict[str, Any]) -> bool:
    """Rastro da troca de conversa que abre toda conversa nascida de `/clear`.

    O CC grava o envelope do `/clear` (com o argumento, se houver) como
    primeira mensagem da conversa NOVA, e o `/rename` do nome do agente deixa
    um lembrete `isMeta` logo depois. O feed desenhava os dois como a bolha
    `SLASH: /CLEAR <título da anterior>` (F11). Nenhum é fala de ninguém.
    """
    if payload.get("type") != "user":
        return False
    texto = _texto_do_user(payload)
    if texto is None:
        return False
    if _ENVELOPE_CLEAR_RE.match(texto):
        return True
    return payload.get("isMeta") is True and _LEMBRETE_RENAME_RE.match(texto) is not None
