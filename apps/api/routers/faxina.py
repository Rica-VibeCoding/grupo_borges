from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Request

from db.store import GrupoBorgesDB
from services.faxina import ZE_CLAUDE_ROOT, read_content

router = APIRouter()


@router.get("")
async def list_items(request: Request, status: Literal["pendente", "arquivado", "todos"] = "pendente") -> dict:
    db: GrupoBorgesDB = request.app.state.db
    return await db.list_faxina(status)


async def decide(item_id: int, request: Request, action: str) -> dict:
    db: GrupoBorgesDB = request.app.state.db
    try:
        item = await db.decide_faxina(item_id, action)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="item não encontrado")
    return item


@router.post("/{item_id}/manter")
async def keep(item_id: int, request: Request) -> dict:
    return await decide(item_id, request, "manter")


@router.post("/{item_id}/arquivar")
async def archive(item_id: int, request: Request) -> dict:
    return await decide(item_id, request, "arquivar")


@router.post("/{item_id}/desfazer")
async def undo(item_id: int, request: Request) -> dict:
    return await decide(item_id, request, "desfazer")


@router.get("/{item_id}/conteudo")
async def content(item_id: int, request: Request) -> dict:
    db: GrupoBorgesDB = request.app.state.db
    item = await db.get_faxina_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="item não encontrado")
    caminho = item["caminho"]
    if item["status"] in {"arquivado", "desfazer_pedido"}:
        caminho = item["arquivado_para"]
        if not caminho:
            raise HTTPException(status_code=409, detail="destino do arquivo não registrado")
    try:
        texto = await asyncio.to_thread(read_content, ZE_CLAUDE_ROOT, caminho)
    except OverflowError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="arquivo não encontrado") from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=403, detail="caminho não permitido") from exc
    return {"caminho": caminho, "texto": texto}
