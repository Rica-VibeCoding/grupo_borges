"""Perfil de um agente para a API dentro do contêiner do cliente.

Execução: PAINEL_CLIENT_SLUG=teste GB_AGENTS_YAML=/etc/painel/agent.yaml
GB_DB_PATH=/casa/painel/api.db GB_CLAUDE_PROJECTS_DIR=/casa/claude/projects
COCKPIT_TMUX_SOCKET=agente uvicorn client_app:app --host 127.0.0.1 --port 8010
"""
from __future__ import annotations

import asyncio
import hmac
import json
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.routing import APIRoute

from config import get_settings
from db.store import GrupoBorgesDB
from orchestrator.jsonl_watcher import JsonlWatcher, encoded_cwd
from orchestrator.tmux_driver import TmuxDriver
from routers import agents, conversas, tts
from services.client_index import ClientIndex
from services.client_lifecycle import ClientLifecycle

AGENT_ROUTES = {
    ("GET", "/{slug}"),
    ("GET", "/{slug}/painel"),
    ("GET", "/{slug}/pulso"),
    ("GET", "/{slug}/messages/stream"),
    ("GET", "/{slug}/pane/stream"),
    ("POST", "/{slug}/input"),
    ("POST", "/{slug}/interromper"),
    ("POST", "/{slug}/destrava"),
    ("POST", "/{slug}/image"),
    ("POST", "/{slug}/file"),
    ("GET", "/{slug}/file/{filename}"),
    ("POST", "/{slug}/voice"),
    ("POST", "/{slug}/transcription"),
    ("POST", "/{slug}/transcription/live-token"),
    ("POST", "/{slug}/quotas/refresh"),
}
CONVERSA_ROUTES = {
    ("GET", "/{slug}/conversas"),
    ("GET", "/{slug}/conversas/operacao"),
    ("POST", "/{slug}/conversas/estacionar"),
    ("GET", "/{slug}/conversas/{session_id}/briefing"),
    ("GET", "/{slug}/conversas/{session_id}/leitura"),
    ("POST", "/{slug}/conversas/nova"),
    ("POST", "/{slug}/conversas/{session_id}/retomar"),
    ("POST", "/{slug}/conversas/{session_id}/titulo"),
    ("POST", "/{slug}/conversas/{session_id}/concluida"),
    ("POST", "/{slug}/conversas/{session_id}/estrela"),
    ("DELETE", "/{slug}/conversas/{session_id}"),
}
TTS_ROUTES = {
    ("GET", "/tts/motores"),
    ("POST", "/tts/synth"),
    ("POST", "/tts/synth/stream"),
}


def _selected(source: APIRouter, allowed: set[tuple[str, str]]) -> APIRouter:
    """Monta os mesmos APIRoute da frota, sem duplicar handlers ou liberar extras."""
    selected = APIRouter()
    found: set[tuple[str, str]] = set()
    for route in source.routes:
        if not isinstance(route, APIRoute):
            continue
        methods = route.methods or set()
        for method in methods:
            key = (method, route.path)
            if key in allowed:
                selected.routes.append(route)
                found.add(key)
    if found != allowed:
        raise RuntimeError(f"rotas do perfil cliente divergiram: {sorted(allowed - found)}")
    return selected


def _local_layout(settings, slug: str):
    config = yaml.safe_load(Path(settings.agents_yaml).read_text(encoding="utf-8"))
    entries = config.get("agents", []) if isinstance(config, dict) else []
    if len(entries) != 1 or entries[0].get("slug") != slug:
        raise RuntimeError("agent.yaml deve conter só o cliente configurado")
    agent = entries[0]
    if agent.get("tmux_session") != "agente":
        raise RuntimeError("tmux_session do cliente deve ser agente")
    projects = Path(settings.claude_projects_dir).resolve()
    workspace = Path(agent["workspace_path"]).resolve()
    if not projects.is_dir() or not workspace.is_dir():
        raise RuntimeError("workspace ou pasta de projetos Claude não existe")
    directory = projects / encoded_cwd(str(workspace))
    paths = sorted(directory.glob("*.jsonl"), key=lambda p: p.stat().st_mtime_ns) if directory.is_dir() else []
    return config, entries, projects, paths


def create_client_app(*, slug: str | None = None, token: str | None = None,
                      hook_token: str | None = None) -> FastAPI:
    slug = slug or os.environ.get("PAINEL_CLIENT_SLUG", "")
    if not slug or not re.fullmatch(r"[a-z0-9_-]+", slug):
        raise RuntimeError("PAINEL_CLIENT_SLUG inválido")
    if token is None:
        token_file = os.environ.get("PAINEL_INTERNAL_TOKEN_FILE", "")
        if not token_file:
            raise RuntimeError("PAINEL_INTERNAL_TOKEN_FILE obrigatório")
        token = Path(token_file).read_text(encoding="utf-8").strip()
    if len(token) < 32:
        raise RuntimeError("token interno deve ter pelo menos 32 caracteres")
    hook_file = os.environ.get("PAINEL_HOOK_TOKEN_FILE")
    if hook_token is None and hook_file:
        hook_token = Path(hook_file).read_text(encoding="utf-8").strip()
    if os.environ.get("PAINEL_CLIENT_SLUG") and (not hook_token or len(hook_token) < 32):
        raise RuntimeError("PAINEL_HOOK_TOKEN_FILE obrigatório")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings = get_settings()
        config, entries, projects, paths = await asyncio.to_thread(_local_layout, settings, slug)
        app.state.settings = settings
        app.state.agents_config = config
        app.state.humans = {}
        db = GrupoBorgesDB(settings.db_path)
        await db.startup()
        await db.sync_agents_from_yaml(entries)
        app.state.db = db
        app.state.tmux = TmuxDriver()
        control_socket = os.environ.get("PAINEL_CONTROL_SOCKET")
        control_token_file = os.environ.get("PAINEL_CONTROL_TOKEN_FILE")
        resume_file = os.environ.get("PAINEL_RESUME_FILE")
        if control_socket and control_token_file and resume_file:
            app.state.client_lifecycle = ClientLifecycle(
                slug, control_socket,
                (await asyncio.to_thread(Path(control_token_file).read_text, encoding="utf-8")).strip(),
                resume_file,
            )
        elif os.environ.get("PAINEL_CLIENT_SLUG"):
            raise RuntimeError("controlador privado não configurado")
        index = ClientIndex(Path(settings.db_path).with_suffix(".offsets.json"))
        watcher = JsonlWatcher(claude_projects_dir=str(projects), agents=entries, db=db,
                               dedupe_jsonl=True, on_offset=index.save)
        # Um cliente precisa do histórico inteiro. O checkpoint evita replay
        # integral em cada restart; o content_hash cobre crash entre DB e marca.
        await index.backfill(watcher, slug, paths)
        await watcher.start()
        app.state.watcher = watcher
        try:
            yield
        finally:
            await watcher.stop()
            await db.shutdown()

    app = FastAPI(title="grupo_borges-api cliente", lifespan=lifespan)
    app.state.client_slug = slug
    app.state.internal_token = token
    app.state.hook_token = hook_token

    @app.middleware("http")
    async def internal_gate(request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        bearer = request.headers.get("authorization", "")
        path = request.url.path
        hook_path = bool(re.fullmatch(
            rf"/api/agents/{re.escape(app.state.client_slug)}/conversas/(?:estacionar|[0-9a-fA-F-]{{36}}/briefing)",
            path,
        )) and request.method in {"GET", "POST"}
        regular = hmac.compare_digest(bearer, f"Bearer {app.state.internal_token}")
        hook = hook_path and app.state.hook_token is not None and hmac.compare_digest(
            bearer, f"Bearer {app.state.hook_token}"
        )
        if not regular and not hook:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        prefix = "/api/agents/"
        if path.startswith(prefix):
            requested_slug = path[len(prefix):].split("/", 1)[0]
            if requested_slug != app.state.client_slug:
                return JSONResponse({"detail": "forbidden"}, status_code=403)
        if path.startswith("/uploads/agents/"):
            requested_slug = path[len("/uploads/agents/"):].split("/", 1)[0]
            if requested_slug != app.state.client_slug:
                return JSONResponse({"detail": "forbidden"}, status_code=403)
        if path.startswith("/api/tts/"):
            if request.method == "GET":
                requested_slug = request.query_params.get("slug")
            else:
                try:
                    body = json.loads(await request.body())
                    requested_slug = body.get("slug") if isinstance(body, dict) else None
                except (ValueError, UnicodeDecodeError):
                    requested_slug = None
            if requested_slug != app.state.client_slug:
                return JSONResponse({"detail": "forbidden"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if response.headers.get("content-type", "").startswith("text/event-stream"):
            response.headers["Cache-Control"] = "no-cache, no-transform"
            response.headers["X-Accel-Buffering"] = "no"
        return response

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "grupo_borges-api-cliente"}

    app.include_router(_selected(agents.router, AGENT_ROUTES), prefix="/api/agents")
    app.include_router(_selected(conversas.router, CONVERSA_ROUTES), prefix="/api/agents")
    app.include_router(_selected(tts.router, TTS_ROUTES), prefix="/api")

    @app.get("/uploads/agents/{slug}/{filename}")
    async def get_upload(slug: str, filename: str, request: Request) -> FileResponse:
        return await agents.get_agent_file(slug, filename, request)

    return app


app = create_client_app() if os.environ.get("PAINEL_CLIENT_SLUG") else None
