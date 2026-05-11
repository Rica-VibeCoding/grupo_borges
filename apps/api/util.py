"""
Helpers compartilhados.
"""
from __future__ import annotations

import json
import re
from typing import Any


def parse_dict_or_none(raw: str | bytes | None) -> dict | None:
    """Aceita só dict; bytes/str inválido ou non-dict vira None."""
    if not raw:
        return None
    try:
        v = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return v if isinstance(v, dict) else None


# Antes de gravar payload de hook em task_events, passamos por aqui pra
# mascarar credenciais e cortar tool_result enorme. Sem isso, plugar o hook
# em workspaces que tocam vault/.env/secrets vaza tudo em SQLite.
_REDACTED = "***REDACTED***"
_MAX_STRING_BYTES = 8 * 1024  # 8KB

_SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),                          # Anthropic/OpenAI-style
    re.compile(r"sbp_[A-Za-z0-9_-]{40,}"),                         # Supabase service role
    re.compile(
        r"-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----"
    ),
    re.compile(r"ghp_[A-Za-z0-9]{36,}"),                           # GitHub PAT
    re.compile(r"github_pat_[A-Za-z0-9_]{60,}"),                   # GitHub fine-grained
    re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),  # JWT
    re.compile(r"AIza[0-9A-Za-z_-]{30,}"),                         # Google API
    re.compile(r"xox[bpars]-[A-Za-z0-9-]{10,}"),                   # Slack
    re.compile(r"AKIA[0-9A-Z]{16}"),                               # AWS access key
]

_SENSITIVE_PATH_FRAGMENTS = ("vault/", "/secrets/", "/.env", ".vault-key")


def _scrub_string(s: str) -> str:
    if len(s.encode("utf-8")) > _MAX_STRING_BYTES:
        clipped = s.encode("utf-8")[:_MAX_STRING_BYTES].decode("utf-8", errors="ignore")
        s = clipped + f"\n[...truncated, original >{_MAX_STRING_BYTES // 1024}KB]"
    for pat in _SECRET_PATTERNS:
        s = pat.sub(_REDACTED, s)
    if any(frag in s for frag in _SENSITIVE_PATH_FRAGMENTS):
        # Conteúdo que cita path sensível PODE ser inocente (log "li o arquivo X"),
        # mas se contiver linhas tipo `KEY=value` ou conteúdo binário curtido,
        # mascara só o que parece valor de env (LINHA=VALOR) pra preservar contexto.
        s = re.sub(r"(?m)^([A-Z][A-Z0-9_]{2,}=)\S+", rf"\1{_REDACTED}", s)
    return s


def redact_payload(value: Any) -> Any:
    """Mascara credenciais e trunca strings gigantes recursivamente."""
    if isinstance(value, str):
        return _scrub_string(value)
    if isinstance(value, dict):
        return {k: redact_payload(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_payload(v) for v in value]
    return value
