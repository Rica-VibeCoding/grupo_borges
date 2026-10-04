from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def test_statusline_captures_context_and_subscription_quota(tmp_path):
    script = Path(__file__).resolve().parents[3] / "deploy" / "painel-cliente" / "statusline-capture.py"
    session = "12345678-1234-4234-8234-123456789012"
    payload = {
        "session_id": session,
        "model": {"id": "claude-opus-5-5", "display_name": "Opus"},
        "cost": {"total_duration_ms": 192_000},
        "context_window": {"used_percentage": 42, "context_window_size": 200000},
        "rate_limits": {"five_hour": {"used_percentage": 12}},
    }
    result = subprocess.run(["python3", str(script)], input=json.dumps(payload),
                            capture_output=True, text=True, check=True,
                            env={**os.environ, "PAINEL_STATUS_DIR": str(tmp_path)})
    assert "Opus 5.5 - 00:03:12 - [" in result.stdout
    assert "] 42%" in result.stdout
    path = tmp_path / f"cc-status-{session}.json"
    assert json.loads(path.read_text())["rate_limits"] == payload["rate_limits"]
    assert path.stat().st_mode & 0o777 == 0o600
