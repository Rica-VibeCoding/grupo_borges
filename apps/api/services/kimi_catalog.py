from __future__ import annotations

import time
from dataclasses import dataclass
from threading import Lock
from typing import Any

import httpx

_MODELS_URL = "https://api.kimi.com/coding/v1/models"
_TIMEOUT_SECONDS = 5
_CACHE_TTL_SECONDS = 300
_FAILURE_TTL_SECONDS = 30


@dataclass(frozen=True)
class Modelo:
    id: str
    display_name: str
    context_length: int | None = None


@dataclass
class _Cache:
    modelos: tuple[Modelo, ...] = ()
    expira_em: float = 0.0


_cache = _Cache()
_lock = Lock()


def parsear(payload: Any) -> tuple[Modelo, ...]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        return ()
    modelos = []
    ids = set()
    for item in payload["data"]:
        if not isinstance(item, dict):
            return ()
        model_id, label = item.get("id"), item.get("display_name")
        janela = item.get("context_length")
        if not isinstance(model_id, str) or not model_id.strip():
            return ()
        if not isinstance(label, str) or not label.strip() or model_id in ids:
            return ()
        if janela is not None and (type(janela) is not int or janela <= 0):
            return ()
        ids.add(model_id)
        modelos.append(Modelo(model_id, label, janela))
    return tuple(modelos)


def listar_modelos(api_key: str | None = None, *, forcar: bool = False) -> tuple[Modelo, ...]:
    with _lock:
        agora = time.monotonic()
        if not forcar and agora < _cache.expira_em:
            return _cache.modelos
        modelos = _ler_catalogo(api_key) if api_key else ()
        _cache.modelos = modelos or _cache.modelos
        _cache.expira_em = agora + (_CACHE_TTL_SECONDS if modelos else _FAILURE_TTL_SECONDS)
        return _cache.modelos


def _ler_catalogo(api_key: str) -> tuple[Modelo, ...]:
    try:
        response = httpx.get(
            _MODELS_URL,
            headers={"x-api-key": api_key, "Accept": "application/json"},
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return parsear(response.json())
    except (httpx.HTTPError, ValueError):
        return ()
