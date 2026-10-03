"""Bancada local: dois clientes, portão e um agente falso num tmux isolado."""
from __future__ import annotations

import asyncio
import subprocess
import uuid
from pathlib import Path

import httpx
import pytest
import yaml

from client_app import create_client_app
from painel_portao import create_portao_app, password_hash
from services import tmux_driver


@pytest.mark.asyncio
async def test_two_clients_cannot_cross_read_or_act_with_fake_tmux(tmp_path: Path, monkeypatch):
    socket_name = "painel-test-" + uuid.uuid4().hex[:12]
    fake = tmp_path / "fake-agent.js"
    fake.write_text("process.stdout.write('FAKE_AGENT_READY\\n'); process.stdin.resume();\n", encoding="utf-8")
    await asyncio.to_thread(subprocess.run, ["tmux", "-L", socket_name, "new-session", "-d", "-s", "agente",
                                            f"/usr/bin/node {fake}"], check=True)
    monkeypatch.setattr(tmux_driver, "_TMUX_SOCKET_TEMPLATE", socket_name)
    sent = []
    async def fake_send(session_name, text):
        sent.append((session_name, text))
        return tmux_driver.DeliveryResult("delivered")
    monkeypatch.setattr(tmux_driver, "send_message", fake_send)
    try:
        for _ in range(30):
            pane = await tmux_driver.capture_pane_excerpt("agente")
            if pane and "FAKE_AGENT_READY" in pane:
                break
            await asyncio.sleep(0.1)
        assert pane and "FAKE_AGENT_READY" in pane

        apps = {}
        for slug in ("a", "b"):
            workspace = tmp_path / slug / "workspace"
            workspace.mkdir(parents=True)
            projects = tmp_path / slug / "claude" / "projects"
            projects.mkdir(parents=True)
            config = tmp_path / slug / "agent.yaml"
            config.write_text(yaml.safe_dump({"agents": [{
                "slug": slug, "name": slug.upper(), "tmux_session": "agente",
                "workspace_path": str(workspace), "cli_default": "claude_code",
                "model_default": "opus",
            }]}), encoding="utf-8")
            monkeypatch.setenv("GB_AGENTS_YAML", str(config))
            monkeypatch.setenv("GB_DB_PATH", str(tmp_path / slug / "api.db"))
            monkeypatch.setenv("GB_CLAUDE_PROJECTS_DIR", str(projects))
            apps[slug] = create_client_app(slug=slug, token=slug * 40)
            # Captura settings enquanto as env vars deste cliente estão ativas.
            async with apps[slug].router.lifespan_context(apps[slug]):
                pass

        def transport_factory(socket):
            slug = "a" if socket == "/tmp/a.sock" else "b"
            return httpx.ASGITransport(app=apps[slug])

        portao = create_portao_app({
            "public_origin": "https://agentes.conectamoveis.net.br",
            "session_db": str(tmp_path / "sessions.db"),
            "users": {"ana": {"role": "client", "slug": "a", "password_hash": password_hash("senha")}},
            "clients": {"a": {"socket": "/tmp/a.sock", "token": "a" * 40},
                        "b": {"socket": "/tmp/b.sock", "token": "b" * 40}},
            "controller": {"socket": "/tmp/control.sock", "token": "c" * 40},
        }, transport_factory=transport_factory)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=portao),
                                     base_url="https://agentes.conectamoveis.net.br") as browser:
            origin = {"origin": "https://agentes.conectamoveis.net.br"}
            assert (await browser.post("/auth/login", headers=origin,
                                       json={"usuario": "ana", "senha": "senha"})).status_code == 200
            own = await browser.get("/api/agents/a")
            assert own.status_code == 200 and own.json()["slug"] == "a"
            painel = await browser.get("/api/agents/a/painel")
            assert painel.status_code == 200
            enviado = await browser.post("/api/agents/a/input", headers=origin,
                                         json={"text": "Olá", "idempotency_key": "req-a"})
            assert enviado.status_code == 200 and enviado.json()["tmux_delivered"] is True
            assert sent == [("agente", "Olá")]
            assert (await browser.get("/api/agents/b")).status_code == 403
            assert (await browser.post("/api/agents/b/input", headers=origin,
                                       json={"text": "ler B"})).status_code == 403
            assert (await browser.post("/api/agents/b/desligar", headers=origin,
                                       json={"confirm": True})).status_code == 403
            assert sent == [("agente", "Olá")]
    finally:
        await asyncio.to_thread(subprocess.run, ["tmux", "-L", socket_name, "kill-server"], check=False,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
