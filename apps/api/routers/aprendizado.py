from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from services.aprendizado import Aprendizado
from services.faxina import ZE_CLAUDE_ROOT

router = APIRouter()


def service(request: Request) -> Aprendizado:
    if not hasattr(request.app.state, "aprendizado"):
        request.app.state.aprendizado = Aprendizado(
            Path.home() / ".claude", ZE_CLAUDE_ROOT, Path.home() / ".local/state",
            getattr(request.app.state, "agents_config", {}).get("agents", []),
        )
    return request.app.state.aprendizado


@router.get("")
async def timeline(
    request: Request, agente: str | None = None,
    tipo: Literal["memoria", "memoria_compartilhada", "skill"] | None = None,
    desde: int | None = Query(None, ge=0), ate: int | None = Query(None, ge=0),
    offset: int = Query(0, ge=0), limite: int = Query(100, ge=1, le=500),
) -> dict:
    nodes, _ = await asyncio.to_thread(service(request).snapshot)
    filtered = [n for n in nodes if (agente is None or n["agente"] == agente)
                and (tipo is None or n["tipo"] == tipo)
                and (desde is None or n["data"] >= desde)
                and (ate is None or n["data"] <= ate)]
    end = offset + limite
    return {"itens": filtered[offset:end], "total": len(filtered),
            "proximo_offset": end if end < len(filtered) else None}


async def resolve(request: Request, node_id: str):
    reader = service(request)
    _, lookup = await asyncio.to_thread(reader.snapshot)
    asset = lookup.get(node_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="nó não encontrado")
    return reader, asset


@router.get("/{node_id}/conteudo")
async def content(node_id: str, request: Request) -> dict:
    reader, asset = await resolve(request, node_id)
    try:
        text = await asyncio.to_thread(reader.content, asset)
    except OverflowError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="arquivo não encontrado") from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=403, detail="caminho não permitido") from exc
    return {"caminho": str(asset.root / asset.relative), "texto": text}
