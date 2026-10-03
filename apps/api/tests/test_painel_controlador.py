from __future__ import annotations

import subprocess

import httpx
import pytest

from painel_controlador import _run, create_controller_app


@pytest.mark.asyncio
async def test_controller_only_fixed_client_and_fixed_unit():
    active = {"teste": False, "outro": True}
    seen = []

    def runner(incus, project, instance, action):
        seen.append((incus, project, instance, action))
        if action == "start":
            active[project] = True
        if action == "stop":
            active[project] = False
        return subprocess.CompletedProcess([], 0 if action != "is-active" or active[project] else 3, "", "")

    app = create_controller_app({
        "token": "t" * 40,
        "client_tokens": {"a": "a" * 40},
        "clients": {"a": {"project": "teste", "instance": "teste"},
                    "b": {"project": "outro", "instance": "outro"}},
    }, runner=runner)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
        headers = {"authorization": "Bearer " + "t" * 40}
        assert (await client.post("/v1/clients/a/start")).status_code == 401
        assert (await client.post("/v1/clients/not-listed/start", headers=headers)).status_code == 404
        assert (await client.post("/v1/clients/a/restart", headers=headers)).status_code == 404
        scoped = {"authorization": "Bearer " + "a" * 40}
        assert (await client.get("/v1/clients/b/state", headers=scoped)).status_code == 403
        assert (await client.get("/v1/clients/a/state", headers=scoped)).status_code == 200
        assert (await client.get("/v1/clients/a/state", headers=headers)).json()["active"] is False
        started = await client.post("/v1/clients/a/start", headers=headers)
        assert started.status_code == 200
        assert started.json()["tmux_delivered"] is True
        assert (await client.post("/v1/clients/a/start", headers=headers)).json()["attempted"] is False
        stopped = await client.post("/v1/clients/a/stop", headers=headers)
        assert stopped.json()["sessao_encerrada"] is True
    assert all(row[1:3] == ("teste", "teste") for row in seen)
    assert {row[3] for row in seen} == {"is-active", "start", "stop"}


def test_incus_exec_uses_fixed_argv_without_shell(monkeypatch):
    calls = []
    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 0, "", "")
    monkeypatch.setattr(subprocess, "run", fake_run)
    _run("/usr/bin/incus", "teste", "teste", "stop")
    assert calls[0][0] == ["/usr/bin/incus", "--force-local", "exec", "teste", "--project", "teste",
                           "--force-noninteractive", "--", "/usr/bin/systemctl", "stop", "agente.service"]
    assert calls[0][1]["stdin"] == subprocess.DEVNULL
    with pytest.raises(ValueError):
        _run("/usr/bin/incus", "teste", "teste", "restart")
    assert len(calls) == 1
