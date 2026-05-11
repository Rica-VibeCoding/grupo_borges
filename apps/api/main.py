"""
FastAPI app do cockpit grupo_borges.

Backend roda na VPS atrás de Tailscale Serve (HTTPS via cert da tailnet).
Auth: identity headers do Tailscale (sem senha custom — tailnet basta).
Em dev local: GB_DEV_BYPASS_AUTH=1 + host loopback bypassa o middleware.

Rodar dev:
    uv sync
    GB_DEV_BYPASS_AUTH=1 uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000

Rodar prod (VPS, atrás do tailscale serve):
    uv run uvicorn main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import ipaddress
from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from config import get_settings
from db.store import GrupoBorgesDB
from orchestrator.jsonl_watcher import JsonlWatcher
from orchestrator.tmux_driver import TmuxDriver
from routers import agents as agents_router
from routers import events as events_router
from routers import fleet as fleet_router
from routers import hooks as hooks_router
from routers import stream as stream_router
from routers import tasks as tasks_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings

    with Path(settings.agents_yaml).open("r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    app.state.agents_config = config

    db = GrupoBorgesDB(settings.db_path)
    await db.startup()
    await db.sync_agents_from_yaml(config["agents"])
    app.state.db = db

    app.state.tmux = TmuxDriver()

    watcher = JsonlWatcher(
        claude_projects_dir=settings.claude_projects_dir,
        agents=config["agents"],
        db=db,
    )
    await watcher.start()
    app.state.watcher = watcher

    yield

    await watcher.stop()
    await db.shutdown()


app = FastAPI(
    title="grupo_borges API",
    description="Backend do cockpit multi-agente — escritório central da frota Claude Code",
    version="0.1.0",
    lifespan=lifespan,
)


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@app.middleware("http")
async def tailscale_identity(request: Request, call_next):
    """Valida Tailscale-User-Login. Bypassa health, OPTIONS preflight e dev loopback."""
    # Health check sempre livre (probe Tailscale Serve)
    if request.url.path == "/health":
        return await call_next(request)

    # CORS preflight: navegadores não enviam headers custom em OPTIONS — deixa
    # passar pra que o CORSMiddleware (mais interno na stack) responda.
    if request.method == "OPTIONS":
        return await call_next(request)

    # Dev: GB_DEV_BYPASS_AUTH=1 + cliente em loopback bypassa identity
    settings = getattr(app.state, "settings", None)
    if settings and settings.dev_bypass_auth:
        host = request.client.host if request.client else None
        if _is_loopback(host):
            return await call_next(request)

    user = request.headers.get("Tailscale-User-Login")
    if not user:
        return JSONResponse(
            {"error": "Unauthorized — Tailscale identity header missing"},
            status_code=401,
        )
    request.state.tailscale_user = user
    return await call_next(request)


# CORS: adicionado APÓS o middleware Tailscale pra ficar mais interno na stack
# (Starlette: último adicionado é o mais externo, primeiro a executar). Assim
# o tailscale_identity tem chance de fazer bypass de OPTIONS antes do CORS,
# e o CORS responde os preflights legítimos sem ser barrado por auth.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://grupo-borges.vercel.app",  # ajustar quando criar projeto Vercel
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
async def health() -> dict:
    return {"status": "ok", "service": "grupo_borges-api", "version": "0.1.0"}


app.include_router(agents_router.router, prefix="/api/agents", tags=["agents"])
app.include_router(fleet_router.router, prefix="/api/fleet", tags=["fleet"])
app.include_router(tasks_router.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(events_router.router, prefix="/api/events", tags=["events"])
app.include_router(hooks_router.router, prefix="/hooks", tags=["hooks"])
app.include_router(stream_router.router, prefix="/api/stream", tags=["stream"])
