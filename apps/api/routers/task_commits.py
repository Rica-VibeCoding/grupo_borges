"""DS-51 — amarração commit ↔ task.

Hook git post-commit roda local e bate POST aqui com {repo, sha, message,
author, committed_at}. O hook já fez o trabalho duro de extrair human_ids
da mensagem (regex `[A-Z]+-\\d+`). Aqui só precisamos: lookup task_id por
human_id, gravar idempotente, devolver o que sabemos.

Tabela `task_commits` em `db/schema.sql`. Inserção é PK (task_id, sha) =
sem dedup manual; mesma combinação roda OR IGNORE.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from db.store import GrupoBorgesDB

router = APIRouter()
log = logging.getLogger(__name__)

HUMAN_ID_RE = re.compile(r"^[A-Z]+-\d+$")
SHA_RE = re.compile(r"^[0-9a-f]{7,40}$", re.IGNORECASE)


class TaskCommitCreate(BaseModel):
    task_human_ids: list[str] = Field(min_length=1, max_length=8)
    sha: str = Field(min_length=7, max_length=40)
    repo: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=500)
    author: str = Field(min_length=1, max_length=200)
    committed_at: int = Field(ge=0)

    @field_validator("task_human_ids")
    @classmethod
    def _normalize_human_ids(cls, value: list[str]) -> list[str]:
        cleaned = []
        for item in value:
            up = item.strip().upper()
            if not HUMAN_ID_RE.match(up):
                raise ValueError(f"human_id inválido: {item!r}")
            cleaned.append(up)
        # Dedup preservando ordem
        seen: set[str] = set()
        unique: list[str] = []
        for hid in cleaned:
            if hid not in seen:
                seen.add(hid)
                unique.append(hid)
        return unique

    @field_validator("sha")
    @classmethod
    def _validate_sha(cls, value: str) -> str:
        if not SHA_RE.match(value):
            raise ValueError("sha tem que ser hex 7-40 chars")
        return value.lower()


@router.post("", status_code=status.HTTP_201_CREATED)
async def record_task_commit(
    payload: TaskCommitCreate, request: Request
) -> dict[str, Any]:
    """Idempotente: PK (task_id, sha). Mesma combinação retorna `inserted=false`.

    Recebe lista de human_ids (um commit pode tocar várias tasks) e grava
    uma linha por (task, sha). human_ids que não casam com task viva são
    devolvidos em `skipped` — não falha o request.
    """
    db: GrupoBorgesDB = request.app.state.db
    linked: list[dict[str, Any]] = []
    skipped: list[str] = []
    for human_id in payload.task_human_ids:
        task_id = await db.find_task_id_by_human_id(human_id)
        if task_id is None:
            skipped.append(human_id)
            continue
        inserted = await db.record_task_commit(
            task_id=task_id,
            sha=payload.sha,
            repo=payload.repo,
            message=payload.message,
            author=payload.author,
            committed_at=payload.committed_at,
        )
        linked.append({
            "task_id": task_id,
            "human_id": human_id,
            "inserted": inserted,
        })
    if not linked:
        raise HTTPException(
            status_code=404,
            detail=f"nenhum human_id casou com task viva: {skipped}",
        )
    return {"linked": linked, "skipped": skipped, "sha": payload.sha}
