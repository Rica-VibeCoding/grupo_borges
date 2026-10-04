"""Login e repasse do painel no contêiner portao; nenhum acesso ao Incus."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from client_app import AGENT_ROUTES, CONVERSA_ROUTES, TTS_ROUTES

PRIVATE_HOOK_ROUTES = {
    ("POST", "/{slug}/conversas/estacionar"),
    ("GET", "/{slug}/conversas/{session_id}/briefing"),
}

COOKIE = "painel_sessao"
SESSION_SECONDS = 12 * 3600
MAX_BODY = 64 * 1024 * 1024
HOP_HEADERS = {"host", "connection", "keep-alive", "content-length", "transfer-encoding",
               "accept-encoding", "content-encoding", "authorization", "cookie", "origin", "x-forwarded-host"}
RESPONSE_HOP = {"connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "set-cookie"}


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt$16384${salt.hex()}${digest.hex()}"


def password_matches(password: str, encoded: str) -> bool:
    try:
        method, cost, salt_hex, expected = encoded.split("$")
        if method != "scrypt" or cost != "16384":
            return False
        actual = password_hash(password, bytes.fromhex(salt_hex)).split("$")[-1]
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _pattern(prefix: str, path: str) -> re.Pattern[str]:
    template = prefix + path
    parts = re.split(r"(\{[^}]+\})", template)
    return re.compile("^" + "".join("[^/]+" if p.startswith("{") else re.escape(p) for p in parts) + "$")


PROXY_PATHS = tuple(
    (method, _pattern("/api/agents", path))
    for method, path in AGENT_ROUTES | (CONVERSA_ROUTES - PRIVATE_HOOK_ROUTES)
) + tuple((method, _pattern("/api", path)) for method, path in TTS_ROUTES)
UPLOAD_PATH = re.compile(r"^/uploads/agents/([^/]+)/([^/]+)$")
AGENT_PATH = re.compile(r"^/api/agents/([^/]+)(?:/|$)")
CONTROL_PATH = re.compile(r"^/api/agents/([^/]+)/(ligar|desligar|estado)$")


class Login(BaseModel):
    usuario: str = Field(min_length=1, max_length=128)
    senha: str = Field(min_length=1, max_length=1024)


class Senha(BaseModel):
    atual: str = Field(max_length=1024)
    nova: str = Field(max_length=1024)


@contextmanager
def _db(path: str):
    conn = sqlite3.connect(path, timeout=5)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        with conn:
            yield conn
    finally:
        conn.close()


def _setup_db(path: str, users: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with _db(path) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)")
        conn.execute("CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires)")
        conn.execute("CREATE TABLE IF NOT EXISTS login_attempts (username TEXT PRIMARY KEY, count INTEGER NOT NULL, first_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, role TEXT NOT NULL, slug TEXT, password_hash TEXT NOT NULL, trocar_senha INTEGER NOT NULL DEFAULT 0)")
        # O JSON só cadastra nomes novos. Reinício ou painel-add não substitui a
        # senha que o usuário já trocou no banco.
        conn.executemany(
            "INSERT OR IGNORE INTO users (username, role, slug, password_hash, trocar_senha) VALUES (?, ?, ?, ?, ?)",
            ((username, user["role"], user.get("slug"), user["password_hash"],
              int(user.get("trocar_senha", user["role"] == "client")))
             for username, user in users.items()),
        )


def _user(config: dict, username: str) -> dict | None:
    with _db(config["session_db"]) as conn:
        row = conn.execute(
            "SELECT role, slug, password_hash, trocar_senha FROM users WHERE username=?", (username,)
        ).fetchone()
    return {"role": row[0], "slug": row[1], "password_hash": row[2],
            "trocar_senha": bool(row[3])} if row else None


def _session(config: dict, token: str | None) -> dict | None:
    if not token:
        return None
    session_id = hashlib.sha256(token.encode()).hexdigest()
    with _db(config["session_db"]) as conn:
        row = conn.execute(
            "SELECT s.username, u.role, u.slug, u.trocar_senha FROM sessions s "
            "JOIN users u ON u.username=s.username WHERE s.id=? AND s.expires>?",
            (session_id, int(time.time())),
        ).fetchone()
    if row is None:
        return None
    return {"username": row[0], "role": row[1], "slug": row[2], "trocar_senha": bool(row[3])}


def _origin_ok(request: Request, config: dict) -> bool:
    return request.headers.get("origin") == config["public_origin"]


def _forward_headers(request: Request, token: str) -> dict[str, str]:
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
    headers["authorization"] = f"Bearer {token}"
    return headers


def create_portao_app(config: dict, *, transport_factory=None) -> FastAPI:
    if not config["public_origin"].startswith("https://"):
        raise RuntimeError("public_origin precisa ser HTTPS")
    if not config["clients"] or not config["users"]:
        raise RuntimeError("cadastro vazio")
    for slug, entry in config["clients"].items():
        if not re.fullmatch(r"[a-z0-9_-]+", slug) or not entry["socket"].startswith("/"):
            raise RuntimeError("cliente inválido")
        if len(entry["token"]) < 32:
            raise RuntimeError("token de cliente curto")
    for user in config["users"].values():
        if user["role"] not in {"client", "admin"}:
            raise RuntimeError("papel inválido")
        if user["role"] == "client" and user.get("slug") not in config["clients"]:
            raise RuntimeError("cliente sem destino")
    _setup_db(config["session_db"], config["users"])
    app = FastAPI(title="grupo_borges-api portao")
    dummy_hash = password_hash("senha-invalida", bytes(16))

    def transport(socket: str):
        return transport_factory(socket) if transport_factory else httpx.AsyncHTTPTransport(uds=socket)

    async def relay(request: Request, socket: str, token: str, path: str) -> Response:
        content = await request.body()
        if len(content) > MAX_BODY:
            return JSONResponse({"detail": "body_too_large"}, status_code=413)
        client = httpx.AsyncClient(transport=transport(socket), base_url="http://local",
                                   timeout=httpx.Timeout(connect=5, read=None, write=60, pool=5),
                                   follow_redirects=False)
        try:
            upstream_request = client.build_request(request.method, path,
                params=request.url.query, headers=_forward_headers(request, token), content=content)
            upstream = await client.send(upstream_request, stream=True)
        except httpx.HTTPError:
            await client.aclose()
            return JSONResponse({"detail": "destino_indisponivel"}, status_code=502)
        if 300 <= upstream.status_code < 400:
            await upstream.aclose()
            await client.aclose()
            return JSONResponse({"detail": "redirect_recusado"}, status_code=502)
        headers = {k: v for k, v in upstream.headers.items() if k.lower() not in RESPONSE_HOP}
        if upstream.headers.get("content-type", "").startswith("text/event-stream"):
            headers["cache-control"] = "no-cache, no-transform"
            headers["x-accel-buffering"] = "no"

            async def stream():
                try:
                    async for part in upstream.aiter_raw():
                        yield part
                finally:
                    await upstream.aclose()
                    await client.aclose()

            return StreamingResponse(stream(), status_code=upstream.status_code, headers=headers)
        body = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        return Response(body, status_code=upstream.status_code, headers=headers)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "grupo_borges-api-portao"}

    @app.post("/auth/login")
    async def login(body: Login, request: Request):
        if not _origin_ok(request, config):
            return JSONResponse({"detail": "origin_recusada"}, status_code=403)
        username = body.usuario.strip().lower()
        now = int(time.time())
        with _db(config["session_db"]) as conn:
            attempt = conn.execute("SELECT count, first_at, blocked_until FROM login_attempts WHERE username=?",
                                   (username,)).fetchone()
        if attempt and attempt[2] > now:
            return JSONResponse({"detail": "tente_mais_tarde"}, status_code=429)
        user = _user(config, username)
        encoded = user["password_hash"] if user else dummy_hash
        valid = await asyncio.to_thread(password_matches, body.senha, encoded)
        if not valid or not user:
            count = attempt[0] + 1 if attempt and now - attempt[1] < 900 else 1
            first_at = attempt[1] if attempt and now - attempt[1] < 900 else now
            with _db(config["session_db"]) as conn:
                conn.execute("INSERT OR REPLACE INTO login_attempts VALUES (?, ?, ?, ?)",
                             (username, count, first_at, now + 900 if count >= 5 else 0))
            return JSONResponse({"detail": "credenciais_invalidas"}, status_code=401)
        token = secrets.token_urlsafe(32)
        with _db(config["session_db"]) as conn:
            conn.execute("DELETE FROM login_attempts WHERE username=?", (username,))
            conn.execute("DELETE FROM sessions WHERE expires<=?", (int(time.time()),))
            conn.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                         (hashlib.sha256(token.encode()).hexdigest(), username, int(time.time()) + SESSION_SECONDS))
        response = JSONResponse({"usuario": username, "role": user["role"], "slug": user.get("slug")})
        response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, secure=True, samesite="lax")
        return response

    @app.get("/auth/me")
    async def me(request: Request):
        session = _session(config, request.cookies.get(COOKIE))
        return JSONResponse(session) if session else JSONResponse({"detail": "unauthorized"}, status_code=401)

    @app.post("/auth/senha")
    async def senha(body: Senha, request: Request):
        if not _origin_ok(request, config):
            return JSONResponse({"detail": "origin_recusada"}, status_code=403)
        token = request.cookies.get(COOKIE)
        session = _session(config, token)
        if not session:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        user = _user(config, session["username"])
        if not user or not await asyncio.to_thread(password_matches, body.atual, user["password_hash"]):
            return JSONResponse({"detail": "credenciais_invalidas"}, status_code=401)
        if len(body.nova) < 8 or body.nova == body.atual:
            return JSONResponse({"detail": "nova_senha_fraca"}, status_code=422)
        encoded = await asyncio.to_thread(password_hash, body.nova)
        session_id = hashlib.sha256(token.encode()).hexdigest()
        with _db(config["session_db"]) as conn:
            changed = conn.execute(
                "UPDATE users SET password_hash=?, trocar_senha=0 "
                "WHERE username=? AND password_hash=?",
                (encoded, session["username"], user["password_hash"]),
            ).rowcount
            if changed:
                conn.execute("DELETE FROM sessions WHERE username=? AND id<>?",
                             (session["username"], session_id))
                conn.execute("DELETE FROM login_attempts WHERE username=?", (session["username"],))
        if not changed:
            return JSONResponse({"detail": "credenciais_invalidas"}, status_code=401)
        return Response(status_code=204)

    @app.post("/auth/logout")
    async def logout(request: Request):
        if not _origin_ok(request, config):
            return JSONResponse({"detail": "origin_recusada"}, status_code=403)
        token = request.cookies.get(COOKIE)
        if token:
            with _db(config["session_db"]) as conn:
                conn.execute("DELETE FROM sessions WHERE id=?", (hashlib.sha256(token.encode()).hexdigest(),))
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE)
        return response

    async def authenticated_relay(request: Request, path: str) -> Response:
        session = _session(config, request.cookies.get(COOKIE))
        if not session:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        if request.method not in {"GET", "HEAD"} and not _origin_ok(request, config):
            return JSONResponse({"detail": "origin_recusada"}, status_code=403)
        control = CONTROL_PATH.fullmatch(path)
        agent = AGENT_PATH.match(path)
        upload = UPLOAD_PATH.fullmatch(path)
        slug = control.group(1) if control else agent.group(1) if agent else upload.group(1) if upload else None
        if path.startswith("/api/tts/"):
            if request.method == "GET":
                slug = parse_qs(request.url.query).get("slug", [None])[0]
            else:
                try:
                    payload = json.loads(await request.body())
                    slug = payload.get("slug") if isinstance(payload, dict) else None
                except (ValueError, UnicodeDecodeError):
                    return JSONResponse({"detail": "body_invalido"}, status_code=400)
        if slug not in config["clients"]:
            return JSONResponse({"detail": "forbidden"}, status_code=403)
        if session["role"] != "admin" and session["slug"] != slug:
            return JSONResponse({"detail": "forbidden"}, status_code=403)
        if control:
            action = control.group(2)
            if (request.method == "GET") != (action == "estado"):
                return JSONResponse({"detail": "method_not_allowed"}, status_code=405)
            if action == "desligar":
                try:
                    if (await request.json()).get("confirm") is not True:
                        raise ValueError
                except (ValueError, AttributeError):
                    return JSONResponse({"detail": "confirmacao_explicita_obrigatoria"}, status_code=400)
            method = "GET" if action == "estado" else "POST"
            mapped = {"ligar": "start", "desligar": "stop", "estado": "state"}[action]
            controller = config["controller"]
            async with httpx.AsyncClient(transport=transport(controller["socket"]), base_url="http://local", timeout=30) as client:
                try:
                    answer = await client.request(method, f"/v1/clients/{slug}/{mapped}",
                                                  headers={"authorization": f"Bearer {controller['token']}"})
                except httpx.HTTPError:
                    return JSONResponse({"detail": "controlador_indisponivel"}, status_code=502)
            return Response(answer.content, status_code=answer.status_code, media_type="application/json")
        allowed = any(method == request.method and pattern.fullmatch(path)
                      for method, pattern in PROXY_PATHS) or bool(upload and request.method == "GET")
        if not allowed:
            return JSONResponse({"detail": "not_found"}, status_code=404)
        client = config["clients"][slug]
        return await relay(request, client["socket"], client["token"], path)

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "DELETE", "PATCH", "PUT"])
    async def api(path: str, request: Request):
        return await authenticated_relay(request, "/api/" + path)

    @app.api_route("/uploads/agents/{path:path}", methods=["GET"])
    async def uploads(path: str, request: Request):
        return await authenticated_relay(request, "/uploads/agents/" + path)

    return app


def load_config(path: str) -> dict:
    config = json.loads(Path(path).read_text(encoding="utf-8"))
    for client in config["clients"].values():
        client["token"] = Path(client.pop("token_file")).read_text(encoding="utf-8").strip()
    config["controller"]["token"] = Path(config["controller"].pop("token_file")).read_text(encoding="utf-8").strip()
    return config


app = create_portao_app(load_config(os.environ["PAINEL_PORTAO_CONFIG"])) if os.environ.get("PAINEL_PORTAO_CONFIG") else None


if __name__ == "__main__":
    import getpass
    print(password_hash(getpass.getpass("Senha: ")))
