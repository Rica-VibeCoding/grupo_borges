from __future__ import annotations

import httpx
import pytest

from painel_portao import create_portao_app, password_hash


@pytest.mark.asyncio
async def test_login_posse_e_repasse_sse(tmp_path):
    seen = []

    def transport_factory(socket):
        def handle(request):
            seen.append((socket, request.method, request.url.path, dict(request.headers)))
            if request.url.path.endswith("/messages/stream"):
                return httpx.Response(200, headers={"content-type": "text/event-stream"},
                                      stream=httpx.ByteStream(b"event: heartbeat\ndata: {}\n\n"))
            return httpx.Response(200, json={"slug": "cliente_a"})
        return httpx.MockTransport(handle)

    config = {
        "public_origin": "https://agentes.conectamoveis.net.br",
        "session_db": str(tmp_path / "sessions.db"),
        "users": {
            "ana": {"role": "client", "slug": "cliente_a", "password_hash": password_hash("correct horse")},
            "rica": {"role": "admin", "password_hash": password_hash("admin password")},
        },
        "clients": {
            "cliente_a": {"socket": "/tmp/a.sock", "token": "a" * 40},
            "cliente_b": {"socket": "/tmp/b.sock", "token": "b" * 40},
        },
        "controller": {"socket": "/tmp/control.sock", "token": "c" * 40},
    }
    app = create_portao_app(config, transport_factory=transport_factory)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url=config["public_origin"]) as browser:
        assert (await browser.get("/api/agents/cliente_a")).status_code == 401
        login = await browser.post("/auth/login", headers={"origin": config["public_origin"]},
                                   json={"usuario": "ana", "senha": "correct horse"})
        assert login.status_code == 200
        assert "HttpOnly" in login.headers["set-cookie"]
        assert "Secure" in login.headers["set-cookie"]
        assert (await browser.get("/auth/me")).json()["slug"] == "cliente_a"
        assert (await browser.get("/api/agents/cliente_a")).status_code == 200
        stream = await browser.get("/api/agents/cliente_a/messages/stream")
        assert stream.status_code == 200
        assert stream.content == b"event: heartbeat\ndata: {}\n\n"
        assert "no-transform" in stream.headers["cache-control"]
        count = len(seen)
        assert (await browser.get("/api/agents/cliente_b")).status_code == 403
        assert (await browser.post("/api/agents/cliente_b/input",
                                   headers={"origin": config["public_origin"]},
                                   json={"text": "Roubar"})).status_code == 403
        assert (await browser.get("/uploads/agents/cliente_b/a.png")).status_code == 403
        assert (await browser.post("/api/tts/synth", headers={"origin": config["public_origin"]},
                                   json={"slug": "cliente_b", "text": "Roubar"})).status_code == 403
        assert len(seen) == count
        assert (await browser.post("/api/agents/cliente_a/input", json={"text": "x"})).status_code == 403
        assert seen[0][0] == "/tmp/a.sock"
        assert seen[0][3]["authorization"] == "Bearer " + "a" * 40
        assert "cookie" not in seen[0][3]
        assert (await browser.post("/auth/logout", headers={"origin": config["public_origin"]})).status_code == 200
        assert (await browser.get("/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_admin_role_can_reach_both_clients(tmp_path):
    calls = []
    def transport_factory(socket):
        def handle(request):
            calls.append(socket)
            return httpx.Response(200, json={"ok": True})
        return httpx.MockTransport(handle)
    config = {
        "public_origin": "https://agentes.conectamoveis.net.br",
        "session_db": str(tmp_path / "sessions.db"),
        "users": {"rica": {"role": "admin", "password_hash": password_hash("admin password")}},
        "clients": {"a": {"socket": "/tmp/a.sock", "token": "a" * 40},
                    "b": {"socket": "/tmp/b.sock", "token": "b" * 40}},
        "controller": {"socket": "/tmp/control.sock", "token": "c" * 40},
    }
    app = create_portao_app(config, transport_factory=transport_factory)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url=config["public_origin"]) as browser:
        await browser.post("/auth/login", headers={"origin": config["public_origin"]},
                           json={"usuario": "rica", "senha": "admin password"})
        assert (await browser.get("/api/agents/a")).status_code == 200
        assert (await browser.get("/api/agents/b")).status_code == 200
    assert calls == ["/tmp/a.sock", "/tmp/b.sock"]
