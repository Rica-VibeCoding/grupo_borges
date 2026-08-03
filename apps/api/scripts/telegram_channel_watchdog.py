#!/usr/bin/env python3
"""Vigia determinístico dos pollers Telegram, independente do cockpit.

Uso manual:
    python3 scripts/telegram_channel_watchdog.py

Cron sugerido (não instalado):
    */5 * * * * cd /home/clawd/repos/grupo_borges/apps/api && /usr/bin/python3 scripts/telegram_channel_watchdog.py >> /tmp/telegram-channel-watchdog.log 2>&1

O script chama somente ``getWebhookInfo``. Nunca usa ``getUpdates`` e, portanto,
não consome nem descarta mensagens que pertencem aos agentes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

DEFAULT_CHANNELS_DIR = Path.home() / ".claude" / "channels"
DEFAULT_STATE_FILE = Path.home() / ".cache" / "grupo-borges" / "telegram-watchdog.json"
TOKEN_KEY = "TELEGRAM_BOT_TOKEN"
_STATE_DIR_AGENT_ALIASES = {
    "telegram": "daniel",
    "telegram-auxiliar": "pavan",
    "telegram-monfin": "barsi",
    "telegram-movelmar": "vinicius",
    "telegram-woodpro": "felipe",
}


def read_bot_token(env_path: Path) -> str | None:
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return None
    for raw_line in lines:
        line = raw_line.strip()
        if line.startswith("export "):
            line = line.removeprefix("export ").lstrip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() != TOKEN_KEY:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        return value or None
    return None


def discover_channels(channels_dir: Path) -> list[tuple[str, Path, str]]:
    channels: list[tuple[str, Path, str]] = []
    if not channels_dir.is_dir():
        return channels
    for state_dir in sorted(path for path in channels_dir.iterdir() if path.is_dir()):
        token = read_bot_token(state_dir / ".env")
        if token:
            channels.append((agent_name(state_dir.name), state_dir, token))
    return channels


def agent_name(state_dir_name: str) -> str:
    if state_dir_name in _STATE_DIR_AGENT_ALIASES:
        return _STATE_DIR_AGENT_ALIASES[state_dir_name]
    return state_dir_name.removeprefix("telegram-")


def fetch_pending_update_count(token: str, timeout_s: float) -> int:
    url = f"https://api.telegram.org/bot{token}/getWebhookInfo"
    request = urllib.request.Request(url, headers={"User-Agent": "grupo-borges-watchdog/1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            payload = json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"{type(exc).__name__}: falha na API Telegram") from exc
    result = payload.get("result") if isinstance(payload, dict) and payload.get("ok") else None
    pending = result.get("pending_update_count") if isinstance(result, dict) else None
    if not isinstance(pending, int) or pending < 0:
        raise RuntimeError("resposta inválida da API Telegram")
    return pending


def load_state(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {"version": 1, "channels": {}}
    if not isinstance(payload, dict) or not isinstance(payload.get("channels"), dict):
        return {"version": 1, "channels": {}}
    return payload


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as temp_file:
            json.dump(state, temp_file, ensure_ascii=False, sort_keys=True)
            temp_file.write("\n")
        os.chmod(temp_name, 0o600)
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def run_check(
    channels_dir: Path,
    state_file: Path,
    *,
    timeout_s: float,
    fetch_pending: Callable[[str, float], int] = fetch_pending_update_count,
) -> int:
    previous = load_state(state_file)
    previous_channels = previous["channels"]
    next_channels: dict[str, dict[str, int | str]] = {}
    dead: list[tuple[str, str, int, int]] = []
    errors: list[tuple[str, str]] = []
    suspicious = 0

    discovered = discover_channels(channels_dir)
    if not discovered:
        save_state(state_file, {"version": 1, "channels": {}})
        print("ERRO nenhum canal Telegram com token foi descoberto", file=sys.stderr)
        return 2

    for agent, state_dir, token in discovered:
        key = state_dir.name
        prior = previous_channels.get(key, {})
        fingerprint = hashlib.sha256(token.encode()).hexdigest()[:16]
        try:
            pending = fetch_pending(token, timeout_s)
        except RuntimeError as exc:
            next_channels[key] = {
                "pending": 0,
                "positive_streak": 0,
                "token_fingerprint": fingerprint,
            }
            errors.append((agent, str(exc)))
            continue

        prior_streak = (
            prior.get("positive_streak", 0)
            if isinstance(prior, dict) and prior.get("token_fingerprint") == fingerprint
            else 0
        )
        if not isinstance(prior_streak, int) or prior_streak < 0:
            prior_streak = 0
        streak = prior_streak + 1 if pending > 0 else 0
        next_channels[key] = {
            "pending": pending,
            "positive_streak": streak,
            "token_fingerprint": fingerprint,
        }
        if streak >= 2:
            dead.append((agent, key, pending, streak))
        elif streak == 1:
            suspicious += 1

    save_state(state_file, {"version": 1, "channels": next_channels})

    for agent, channel, pending, streak in dead:
        print(
            f"MORTO agente={agent} canal={channel} "
            f"pending_update_count={pending} leituras_positivas={streak}"
        )
    for agent, error in errors:
        print(f"ERRO agente={agent} detalhe={error}", file=sys.stderr)

    if dead:
        return 1
    if errors:
        return 2
    print(f"OK canais={len(discovered)} suspeitos_primeira_leitura={suspicious}")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--channels-dir", type=Path, default=DEFAULT_CHANNELS_DIR)
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE_FILE)
    parser.add_argument("--timeout", type=float, default=10.0)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    return run_check(args.channels_dir, args.state_file, timeout_s=args.timeout)


if __name__ == "__main__":
    raise SystemExit(main())
