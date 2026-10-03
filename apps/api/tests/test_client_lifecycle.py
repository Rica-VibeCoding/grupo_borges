from __future__ import annotations

import os
import subprocess
from pathlib import Path

import httpx
import pytest

from painel_controlador import create_controller_app
from services.client_lifecycle import ClientLifecycle


@pytest.mark.asyncio
async def test_resume_uses_scoped_controller_and_writes_only_uuid(tmp_path, monkeypatch):
    running = {"a": True, "b": True}
    commands = []

    def runner(incus, project, instance, action):
        commands.append((project, instance, action))
        if action == "stop":
            running[project] = False
        elif action == "start":
            running[project] = True
        code = 0 if action != "is-active" or running[project] else 3
        return subprocess.CompletedProcess([], code, "", "")

    controller = create_controller_app({
        "token": "m" * 40,
        "client_tokens": {"a": "a" * 40},
        "clients": {"a": {"project": "a", "instance": "a"},
                    "b": {"project": "b", "instance": "b"}},
    }, runner=runner)
    monkeypatch.setattr(httpx, "AsyncHTTPTransport", lambda uds: httpx.ASGITransport(app=controller))
    marker = tmp_path / "resume-id"
    lifecycle = ClientLifecycle("a", "/run/painel/control.sock", "a" * 40, str(marker))
    assert (await lifecycle.shutdown_agent("agente"))["sessao_encerrada"] is True
    session_id = "12345678-1234-4234-8234-123456789012"
    assert (await lifecycle.boot_agent("agente", session_id))["tmux_delivered"] is True
    assert marker.read_text().strip() == session_id
    assert all(row[:2] == ("a", "a") for row in commands)
    with pytest.raises(ValueError):
        await lifecycle.boot_agent("agente", "../../etc/passwd")
    assert marker.read_text().strip() == session_id


def test_boot_snippet_consumes_only_valid_session_id(tmp_path):
    snippet = Path(__file__).resolve().parents[3] / "deploy" / "painel-cliente" / "resume-args.sh"
    marker = tmp_path / "resume-id"
    for value, expected in [("12345678-1234-4234-8234-123456789012", "12345678-1234-4234-8234-123456789012"),
                            ("../../etc/passwd", "")]:
        marker.write_text(value + "\n")
        result = subprocess.run(["sh", "-c", f'. "{snippet}"; printf "%s" "$PAINEL_RESUME_ID"'],
                                env={**os.environ, "PAINEL_RESUME_FILE": str(marker)},
                                capture_output=True, text=True, check=True)
        assert result.stdout == expected
        assert not marker.exists()
