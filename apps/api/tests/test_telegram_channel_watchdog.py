"""Vigia Telegram: estado persistente e API read-only, sem rede real."""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import telegram_channel_watchdog as watchdog


def _channel(channels_dir: Path, name: str, token: str) -> None:
    state_dir = channels_dir / name
    state_dir.mkdir(parents=True)
    (state_dir / ".env").write_text(
        f'IGNORED=value\nexport TELEGRAM_BOT_TOKEN="{token}"\n',
        encoding="utf-8",
    )


def test_fetch_pending_uses_only_get_webhook_info() -> None:
    response = io.BytesIO(
        json.dumps({"ok": True, "result": {"pending_update_count": 4}}).encode()
    )
    with patch("scripts.telegram_channel_watchdog.urllib.request.urlopen", return_value=response) as open_url:
        pending = watchdog.fetch_pending_update_count("token-secreto", 1.0)

    assert pending == 4
    request = open_url.call_args.args[0]
    assert request.full_url.endswith("/getWebhookInfo")
    assert "getUpdates" not in request.full_url


def test_one_positive_reading_is_only_suspicious(tmp_path: Path, capsys) -> None:
    channels_dir = tmp_path / "channels"
    state_file = tmp_path / "state.json"
    _channel(channels_dir, "telegram", "token-daniel")

    exit_code = watchdog.run_check(
        channels_dir,
        state_file,
        timeout_s=1.0,
        fetch_pending=lambda _token, _timeout: 3,
    )

    assert exit_code == 0
    assert "suspeitos_primeira_leitura=1" in capsys.readouterr().out
    state = json.loads(state_file.read_text(encoding="utf-8"))
    assert state["channels"]["telegram"]["positive_streak"] == 1


def test_two_consecutive_positive_readings_report_dead_channel(
    tmp_path: Path, capsys
) -> None:
    channels_dir = tmp_path / "channels"
    state_file = tmp_path / "state.json"
    _channel(channels_dir, "telegram", "token-daniel")

    first = watchdog.run_check(
        channels_dir,
        state_file,
        timeout_s=1.0,
        fetch_pending=lambda _token, _timeout: 2,
    )
    second = watchdog.run_check(
        channels_dir,
        state_file,
        timeout_s=1.0,
        fetch_pending=lambda _token, _timeout: 5,
    )

    assert first == 0
    assert second == 1
    output = capsys.readouterr().out
    assert "MORTO agente=daniel canal=telegram" in output
    assert "pending_update_count=5" in output
    assert "leituras_positivas=2" in output


def test_zero_pending_resets_the_consecutive_reading_counter(tmp_path: Path) -> None:
    channels_dir = tmp_path / "channels"
    state_file = tmp_path / "state.json"
    _channel(channels_dir, "telegram-hiro", "token-hiro")

    readings = iter((1, 0, 1))
    results = [
        watchdog.run_check(
            channels_dir,
            state_file,
            timeout_s=1.0,
            fetch_pending=lambda _token, _timeout: next(readings),
        )
        for _ in range(3)
    ]

    assert results == [0, 0, 0]
    state = json.loads(state_file.read_text(encoding="utf-8"))
    assert state["channels"]["telegram-hiro"]["positive_streak"] == 1


def test_token_rotation_resets_positive_streak(tmp_path: Path) -> None:
    channels_dir = tmp_path / "channels"
    state_file = tmp_path / "state.json"
    _channel(channels_dir, "telegram", "token-antigo")

    first = watchdog.run_check(
        channels_dir,
        state_file,
        timeout_s=1.0,
        fetch_pending=lambda _token, _timeout: 1,
    )
    (channels_dir / "telegram" / ".env").write_text(
        "TELEGRAM_BOT_TOKEN=token-novo\n",
        encoding="utf-8",
    )
    after_rotation = watchdog.run_check(
        channels_dir,
        state_file,
        timeout_s=1.0,
        fetch_pending=lambda _token, _timeout: 1,
    )
    second_same_token = watchdog.run_check(
        channels_dir,
        state_file,
        timeout_s=1.0,
        fetch_pending=lambda _token, _timeout: 1,
    )

    assert first == 0
    assert after_rotation == 0
    assert second_same_token == 1


def test_no_discovered_channels_is_monitoring_error(tmp_path: Path, capsys) -> None:
    exit_code = watchdog.run_check(
        tmp_path / "channels",
        tmp_path / "state.json",
        timeout_s=1.0,
    )

    assert exit_code == 2
    assert "nenhum canal Telegram" in capsys.readouterr().err
