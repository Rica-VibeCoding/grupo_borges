"""Controlador PRIVADO no hospedeiro Incus; nunca roda no portao/cliente.

PAINEL_CONTROL_CONFIG=/etc/painel/controlador.json \
  uvicorn painel_controlador:app --uds /run/painel-control/control.sock
"""
from __future__ import annotations

import asyncio
import hmac
import json
import os
import re
import subprocess
import time
from collections.abc import Callable
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


def _run(incus: str, project: str, instance: str, action: str) -> subprocess.CompletedProcess[str]:
    if action not in {"start", "stop", "is-active"}:
        raise ValueError("ação inválida")
    return subprocess.run(
        [incus, "--force-local", "exec", instance, "--project", project, "--force-noninteractive", "--",
         "/usr/bin/systemctl", action, "agente.service"],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=25, check=False,
    )


def create_controller_app(config: dict, *, runner: Callable = _run) -> FastAPI:
    clients = config["clients"]
    token = config["token"]
    client_tokens = config.get("client_tokens", {})
    incus = config.get("incus", "/usr/bin/incus")
    if not clients or len(token) < 32 or not Path(incus).is_absolute():
        raise RuntimeError("configuração do controlador inválida")
    for slug, target in clients.items():
        if not re.fullmatch(r"[a-z0-9_-]+", slug):
            raise RuntimeError("slug inválido")
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", target["project"]):
            raise RuntimeError("projeto inválido")
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", target["instance"]):
            raise RuntimeError("instância inválida")
    if any(slug not in clients or len(value) < 32 for slug, value in client_tokens.items()):
        raise RuntimeError("token de cliente inválido")

    app = FastAPI(title="controlador privado do painel")
    locks = {slug: asyncio.Lock() for slug in clients}

    @app.middleware("http")
    async def gate(request: Request, call_next):
        bearer = request.headers.get("authorization", "")
        master = hmac.compare_digest(bearer, f"Bearer {token}")
        scoped = next((slug for slug, value in client_tokens.items()
                       if hmac.compare_digest(bearer, f"Bearer {value}")), None)
        if not master and scoped is None:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        if scoped is not None and request.url.path.split("/")[3:4] != [scoped]:
            return JSONResponse({"detail": "forbidden"}, status_code=403)
        return await call_next(request)

    async def command(slug: str, action: str) -> subprocess.CompletedProcess[str]:
        target = clients[slug]
        return await asyncio.to_thread(runner, incus, target["project"], target["instance"], action)

    async def active(slug: str) -> bool:
        result = await command(slug, "is-active")
        if result.returncode not in {0, 3}:
            raise RuntimeError("estado indisponível")
        return result.returncode == 0

    @app.get("/v1/clients/{slug}/state")
    async def state(slug: str):
        if slug not in clients:
            return JSONResponse({"detail": "unknown_client"}, status_code=404)
        try:
            return {"slug": slug, "active": await active(slug), "unit": "agente.service"}
        except (OSError, subprocess.TimeoutExpired, RuntimeError):
            return JSONResponse({"detail": "controller_failed"}, status_code=502)

    async def change(slug: str, action: str):
        if slug not in clients:
            return JSONResponse({"detail": "unknown_client"}, status_code=404)
        async with locks[slug]:
            try:
                before = await active(slug)
                desired = action == "start"
                attempted = before != desired
                if attempted:
                    result = await command(slug, action)
                    if result.returncode != 0:
                        return JSONResponse({"detail": "controller_failed"}, status_code=502)
                after = await active(slug)
                if after != desired:
                    return JSONResponse({"detail": "state_not_confirmed"}, status_code=502)
            except (OSError, subprocess.TimeoutExpired, RuntimeError):
                return JSONResponse({"detail": "controller_failed"}, status_code=502)
        now = int(time.time())
        if action == "start":
            return {"tmux_delivered": after, "attempted": attempted, "sent_at": now}
        return {
            "tmux_delivered": not after,
            "attempted": attempted,
            "sessao_encerrada": not after,
            "scopes_parados": ["agente.service"] if attempted else [],
            "scopes_resistiram": [],
            "boot_cancelado": False,
            "sent_at": now,
        }

    @app.post("/v1/clients/{slug}/start")
    async def start(slug: str):
        return await change(slug, "start")

    @app.post("/v1/clients/{slug}/stop")
    async def stop(slug: str):
        return await change(slug, "stop")

    return app


def load_config(path: str) -> dict:
    config = json.loads(Path(path).read_text(encoding="utf-8"))
    config["token"] = Path(config.pop("token_file")).read_text(encoding="utf-8").strip()
    config["client_tokens"] = {
        slug: Path(token_file).read_text(encoding="utf-8").strip()
        for slug, token_file in config.pop("client_token_files", {}).items()
    }
    return config


app = create_controller_app(load_config(os.environ["PAINEL_CONTROL_CONFIG"])) if os.environ.get("PAINEL_CONTROL_CONFIG") else None
