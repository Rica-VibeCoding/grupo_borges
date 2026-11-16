from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, StrictBool

from services.aprendizado import Aprendizado
from services.aprendizado_poda import Conflict, archive_memory, undo_memory
from services.faxina import ZE_CLAUDE_ROOT, read_content

router = APIRouter()


class Confirmation(BaseModel):
    confirmar: StrictBool


def confirmed(body: Confirmation) -> None:
    if not body.confirmar:
        raise HTTPException(status_code=422, detail="confirmação explícita obrigatória")


async def memory_operation(function, *args) -> Any:
    try:
        return await asyncio.to_thread(function, *args)
    except Conflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OverflowError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="arquivo ou operação não encontrado") from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=403, detail="caminho ou operação não permitido") from exc


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


@router.post("/{node_id}/apagar")
async def delete_memory(node_id: str, body: Confirmation, request: Request) -> dict:
    confirmed(body)
    reader, asset = await resolve(request, node_id)
    if asset.tipo != "memoria":
        raise HTTPException(status_code=403, detail="somente memória individual pode ser apagada")
    return await memory_operation(archive_memory, reader, asset, node_id)


def skill_response(item: dict) -> dict:
    return {"operacao_id": f"faxina-{item['id']}", "tipo": "skill",
            "status": item["status"], "faxina_item": item}


@router.post("/{node_id}/arquivar")
async def archive_skill(node_id: str, body: Confirmation, request: Request) -> dict:
    confirmed(body)
    reader, asset = await resolve(request, node_id)
    if asset.tipo != "skill":
        raise HTTPException(status_code=403, detail="somente skill pode ser arquivada por esta rota")
    # Revalida o destino canônico antes de criar pedido no banco; mover é do executor.
    await memory_operation(read_content, asset.root, asset.relative)
    path = str(Path(asset.relative).parent)
    nodes, _ = await asyncio.to_thread(reader.snapshot)
    dates = [n["data"] for n in nodes if n["caminho"] == str(asset.root / asset.relative)]
    if not dates:
        raise HTTPException(status_code=409, detail="inventário mudou; atualize antes de arquivar")
    try:
        item = await request.app.state.db.request_skill_archive(
            caminho=path, workspace=Path(path).parts[0], ultimo_commit=max(dates),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if item["status"] not in {"arquivar_pedido", "arquivado"}:
        raise HTTPException(status_code=409, detail="pedido existente exige conferência na Faxina")
    return skill_response(item)


@router.post("/podas/{operation_id}/desfazer")
async def undo(operation_id: str, body: Confirmation, request: Request) -> dict:
    confirmed(body)
    reader = service(request)
    if re.fullmatch(r"faxina-[1-9][0-9]*", operation_id):
        try:
            db = request.app.state.db
            item_id = int(operation_id.removeprefix("faxina-"))
            item = await db.get_faxina_item(item_id)
            if item is None:
                raise HTTPException(status_code=404, detail="operação não encontrada")
            if item["tipo"] != "skill":
                raise HTTPException(status_code=403, detail="operação não é de skill")
            item = await db.decide_faxina(item_id, "desfazer")
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        reader.invalidate()
        return skill_response(item)
    return await memory_operation(undo_memory, reader, operation_id)
