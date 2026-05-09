"""
FastAPI app do cockpit grupo_borges.

Backend roda na VPS atrás de Tailscale Serve (HTTPS via cert da tailnet).
Auth: identity headers do Tailscale (sem senha custom — tailnet basta).
Em dev local: env GB_DEV_BYPASS_AUTH=1 + host loopback bypassa o middleware.

Rodar dev:
    uv sync
    GB_DEV_BYPASS_AUTH=1 uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000

Rodar prod (VPS, atrás do tailscale serve):
    uv run uvicorn main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from db.store import GrupoBorgesDB
from routers import agents as agents_router
from routers import hooks as hooks_router
from routers import stream as stream_router

# ----- agents.yaml (raiz do repo, 2 níveis acima de apps/api/) -----
AGENTS_YAML = Path(__file__).resolve().parents[2] / "agents.yaml"


def load_agents_config() -> dict:
    with AGENTS_YAML.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# ----- lifecycle -----
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    config = load_agents_config()
    app.state.agents_config = config

    db = GrupoBorgesDB()
    await db.startup()
    app.state.db = db
    await db.sync_agents_from_yaml(config["agents"])

    yield

    # shutdown
    await db.shutdown()


app = FastAPI(
    title="grupo_borges API",
    description="Backend do cockpit multi-agente — escritório central da frota Claude Code",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS pro front Vercel
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


# ----- middleware Tailscale identity -----
@app.middleware("http")
async def tailscale_identity(request: Request, call_next):
    """
    Valida que a request veio pela tailnet via header Tailscale-User-Login.
    Em dev (localhost loopback) bypass é permitido com env GB_DEV_BYPASS_AUTH=1.
    """
    is_loopback = request.client and request.client.host in ("127.0.0.1", "::1", "localhost")
    bypass_dev = os.environ.get("GB_DEV_BYPASS_AUTH") == "1" and is_loopback

    # Health check libera sem auth (probe Tailscale Serve)
    if request.url.path == "/health":
        return await call_next(request)

    if not bypass_dev:
        user = request.headers.get("Tailscale-User-Login")
        if not user:
            return JSONResponse(
                {"error": "Unauthorized — Tailscale identity header missing"},
                status_code=401,
            )
        request.state.tailscale_user = user

    return await call_next(request)


# ----- health -----
@app.get("/health", tags=["meta"])
async def health() -> dict:
    return {"status": "ok", "service": "grupo_borges-api", "version": "0.1.0"}


# ----- routers -----
app.include_router(agents_router.router, prefix="/api/agents", tags=["agents"])
app.include_router(hooks_router.router, prefix="/hooks", tags=["hooks"])
app.include_router(stream_router.router, prefix="/api/stream", tags=["stream"])
