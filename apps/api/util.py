"""
Helpers compartilhados.
"""
from __future__ import annotations

import json


def parse_dict_or_none(raw: str | bytes | None) -> dict | None:
    """Aceita só dict; bytes/str inválido ou non-dict vira None."""
    if not raw:
        return None
    try:
        v = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return v if isinstance(v, dict) else None
