from __future__ import annotations

import sqlite3

import httpx
import pytest

from painel_portao import create_portao_app, password_hash


@pytest.mark.asyncio
async def test_login_posse_e_repasse_sse(tmp_path):
    seen = []

    def transport_factory(socket):
        def handle(request):
            seen.append((socket, request.method, request.url.path, dict(request.headers)))
            if request.url.path.endswith(("/messages/stream", "/events")):
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
        assert (await browser.get("/auth/me")).json()["trocar_senha"] is True
        assert (await browser.get("/api/agents/cliente_a")).status_code == 200
        stream = await browser.get("/api/agents/cliente_a/messages/stream")
        assert stream.status_code == 200
        assert stream.content == b"event: heartbeat\ndata: {}\n\n"
        assert "no-transform" in stream.headers["cache-control"]
        events = await browser.get("/api/agents/cliente_a/events")
        assert events.status_code == 200
        assert events.headers["x-accel-buffering"] == "no"
        assert events.content == stream.content
        count = len(seen)
        assert (await browser.get("/api/agents/cliente_b")).status_code == 403
        assert (await browser.get("/api/agents/cliente_b/events")).status_code == 403
        assert (await browser.post("/api/agents/cliente_b/input",
                                   headers={"origin": config["public_origin"]},
                                   json={"text": "Roubar"})).status_code == 403
        assert (await browser.post("/api/agents/cliente_b/destrava",
                                   headers={"origin": config["public_origin"]})).status_code == 403
        assert (await browser.post("/api/agents/cliente_a/destrava")).status_code == 403
        assert (await browser.post("/api/agents/cliente_a/destrava",
                                   headers={"origin": config["public_origin"]})).status_code == 200
        assert seen[-1][2] == "/api/agents/cliente_a/destrava"
        count = len(seen)
        assert (await browser.get("/uploads/agents/cliente_b/a.png")).status_code == 403
        assert (await browser.post("/api/agents/cliente_a/conversas/estacionar",
                                   headers={"origin": config["public_origin"]},
                                   json={"titulo": "x"})).status_code == 404
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


@pytest.mark.asyncio
async def test_login_limits_repeated_wrong_passwords(tmp_path):
    config = {
        "public_origin": "https://agentes.conectamoveis.net.br",
        "session_db": str(tmp_path / "sessions.db"),
        "users": {"ana": {"role": "client", "slug": "a", "password_hash": password_hash("correct")}},
        "clients": {"a": {"socket": "/tmp/a.sock", "token": "a" * 40}},
        "controller": {"socket": "/tmp/control.sock", "token": "c" * 40},
    }
    app = create_portao_app(config)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url=config["public_origin"]) as browser:
        for _ in range(5):
            assert (await browser.post("/auth/login", headers={"origin": config["public_origin"]},
                                       json={"usuario": "ana", "senha": "wrong"})).status_code == 401
        assert (await browser.post("/auth/login", headers={"origin": config["public_origin"]},
                                   json={"usuario": "ana", "senha": "correct"})).status_code == 429


@pytest.mark.asyncio
async def test_users_migrated_once_from_config(tmp_path):
    db = str(tmp_path / "sessions.db")
    config = {
        "public_origin": "https://agentes.conectamoveis.net.br",
        "session_db": db,
        "users": {"ana": {"role": "client", "slug": "a", "password_hash": password_hash("primeira senha")},
                  "rica": {"role": "admin", "password_hash": password_hash("admin password")}},
        "clients": {"a": {"socket": "/tmp/a.sock", "token": "a" * 40}},
        "controller": {"socket": "/tmp/control.sock", "token": "c" * 40},
    }
    create_portao_app(config)
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT trocar_senha FROM users WHERE username='ana'").fetchone() == (1,)
        assert conn.execute("SELECT trocar_senha FROM users WHERE username='rica'").fetchone() == (0,)
        conn.execute("UPDATE users SET password_hash=?, trocar_senha=0 WHERE username='ana'",
                     (password_hash("senha nova"),))
    config["users"]["ana"]["password_hash"] = password_hash("senha da config regravada")
    app = create_portao_app(config)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url=config["public_origin"]) as browser:
        old = await browser.post("/auth/login", headers={"origin": config["public_origin"]},
                                 json={"usuario": "ana", "senha": "senha da config regravada"})
        assert old.status_code == 401
        new = await browser.post("/auth/login", headers={"origin": config["public_origin"]},
                                 json={"usuario": "ana", "senha": "senha nova"})
        assert new.status_code == 200
        assert (await browser.get("/auth/me")).json()["trocar_senha"] is False
