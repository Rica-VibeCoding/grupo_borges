"""
GET  /api/agents                       — lista 6 agentes da frota com state agregado
GET  /api/agents/{slug}                — detalhe + state de um agente
GET  /api/agents/{slug}/instances      — lista instâncias do agente (pílulas multi-instância)
GET  /api/agents/{slug}/sparkline      — eventos por hora (mini-chart de atividade)
GET  /api/agents/{slug}/skills         — skills do workspace (.claude/skills/*/SKILL.md)
GET  /api/agents/{slug}/docs           — docs do workspace (lista + resolved com @include)
GET  /api/agents/{slug}/tables         — tabelas do domínio do agente (de agents.yaml)
GET  /api/agents/{slug}/pane/stream    — DS-2: SSE com excerpt do pane (poll 1 Hz, dedupe sha1)
POST /api/agents/{slug}/input          — DS-2: envia texto pro pane via paste-buffer
POST /api/agents/{slug}/voice          — DS-54: upload áudio → STT (gpt-4o-transcribe) → send-keys
POST /api/agents/{slug}/image          — DS-54: upload imagem → path absoluto → send-keys
POST /api/agents/{slug}/model          — DS-2: troca modelo via /model <slug> + confirma na statusline
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sqlite3
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Literal

from fastapi import APIRouter, Form, HTTPException, Query, Request, Response, UploadFile, status
from libtmux import exc as libtmux_exc
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from db.store import GrupoBorgesDB, build_hour_series, hour_window
from services import tmux_driver
from services import workspace_reader

router = APIRouter()
log = logging.getLogger(__name__)

InstanceStatus = Literal["idle", "running", "blocked", "done"]
AgentCli = Literal["claude_code", "codex"]
MODELS_BY_CLI: dict[AgentCli, set[str]] = {
    "claude_code": {"claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"},
    "codex": {
        "codex-gpt-5-5",
        "codex-gpt-5-4",
        "codex-gpt-5-4-mini",
        "codex-gpt-5-3-codex",
        "codex-gpt-5-2",
    },
}


class AgentInstanceCreate(BaseModel):
    cli: AgentCli
    model: str = Field(min_length=1, max_length=80)
    is_subagent: bool = False


@router.get("")
async def list_agents(request: Request):
    db: GrupoBorgesDB = request.app.state.db
    return await db.list_agents()


@router.get("/{slug}")
async def get_agent(slug: str, request: Request):
    db: GrupoBorgesDB = request.app.state.db
    agent = await db.get_agent(slug)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return agent


@router.get("/{slug}/instances")
async def list_agent_instances(
    slug: str,
    request: Request,
    status: InstanceStatus | None = Query(default=None),
) -> list[dict[str, Any]]:
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return await db.list_agent_instances(slug, status=status)


@router.post("/{slug}/instances", status_code=status.HTTP_201_CREATED)
async def create_agent_instance(
    slug: str, payload: AgentInstanceCreate, request: Request
) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    agent = await db.get_agent(slug)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    if payload.model not in MODELS_BY_CLI[payload.cli]:
        raise HTTPException(
            status_code=400,
            detail=f"combinação cli={payload.cli} + model={payload.model} inválida",
        )

    try:
        instance = await db.create_agent_instance(
            agent_slug=slug,
            cli=payload.cli,
            model=payload.model,
            is_subagent=payload.is_subagent,
        )
    except sqlite3.IntegrityError as e:
        log.warning("IntegrityError ao criar instância de %s: %s", slug, e)
        raise HTTPException(
            status_code=409,
            detail="colisão ao alocar instance_num; tente novamente",
        ) from e

    tmux_created = False
    session_error: str | None = None
    bootstrap_result = {
        "bootstrap_attempted": False,
        "bootstrap_confirmed": False,
    }
    tmux_session = instance.get("tmux_session")
    if tmux_session:
        try:
            await tmux_driver.create_empty_session(tmux_session)
            tmux_created = True
        except libtmux_exc.LibTmuxException as e:
            log.warning("Falha ao criar tmux session %s: %s", tmux_session, e)
            session_error = str(e)

        if tmux_created and not payload.is_subagent:
            try:
                bootstrap = await tmux_driver.bootstrap_cli_in_session(
                    tmux_session,
                    agent["workspace_path"],
                    payload.cli,
                    payload.model,
                )
                bootstrap_result = {
                    f"bootstrap_{k}": v for k, v in bootstrap.items()
                }
            except (libtmux_exc.LibTmuxException, ValueError) as e:
                log.warning("Falha ao bootar CLI em %s: %s", tmux_session, e)
                session_error = str(e)

    response: dict[str, Any] = {
        "instance": instance,
        "tmux_created": tmux_created,
        **bootstrap_result,
    }
    if session_error:
        response["session_error"] = session_error
    return response


@router.delete("/{slug}/instances/{instance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent_instance(slug: str, instance_id: str, request: Request) -> Response:
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")

    instance = await db.end_agent_instance(agent_slug=slug, instance_id=instance_id)
    if instance is None:
        raise HTTPException(status_code=404, detail=f"Instância {instance_id} não encontrada")

    tmux_session = instance.get("tmux_session")
    if tmux_session:
        try:
            await tmux_driver.kill_session_if_exists(tmux_session)
        except libtmux_exc.LibTmuxException as e:
            log.warning("Falha ao matar tmux session %s: %s", tmux_session, e)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{slug}/sparkline")
async def get_agent_sparkline(
    slug: str,
    request: Request,
    hours: int = Query(default=24, ge=1, le=168),
) -> list[dict[str, Any]]:
    """Série horária de `task_events` do agente.

    Retorna `hours` buckets cobrindo `[hora_corrente_UTC - (hours-1), hora_corrente_UTC]`,
    inclusive — ou seja, a hora atual + (hours-1) anteriores. Horas sem evento entram
    com `count=0` pra UI consumir série contínua sem gap-fill no cliente.
    """
    db: GrupoBorgesDB = request.app.state.db
    if await db.get_agent(slug) is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")

    start_dt, _ = hour_window(hours)
    since_unix = int(start_dt.timestamp())
    counts = await db.event_counts_per_hour(slug, since_unix=since_unix)
    tokens = await db.event_tokens_per_hour(slug, since_unix=since_unix)
    return build_hour_series(counts, start_dt, hours, token_sums=tokens)


# ----- Fase 3: skills / docs / tables (alimenta o AgentModal) ---------------

@router.get("/{slug}/skills")
async def list_agent_skills(slug: str, request: Request) -> dict[str, Any]:
    """Skills disponíveis no workspace (parse de `.claude/skills/*/SKILL.md`).

    Detecta symlinks pra skills compartilhadas (`ze-shared/.claude/skills/`).
    """
    agent = await _get_agent_or_404(request, slug)
    skills = await asyncio.to_thread(workspace_reader.read_skills_cached, agent["workspace_path"])
    return {"slug": slug, "skills": skills, "count": len(skills)}


@router.get("/{slug}/docs")
async def list_agent_docs(
    slug: str,
    request: Request,
    filename: str | None = Query(default=None, description="Quando preenchido, devolve o conteúdo do doc"),
    resolve: bool = Query(default=False, description="Se true, expande @include inline (default: false — conteúdo cru)"),
) -> dict[str, Any]:
    """Docs do workspace (CLAUDE/SOUL/IDENTITY/AGENTS/TOOLS/OPS).

    Sem `filename`: lista os docs existentes (metadados leves).
    Com `filename`: devolve `content_md` cru (default) ou com `@include`
    expandido inline quando `resolve=true` (cap profundidade 5, cap 256KB).
    """
    agent = await _get_agent_or_404(request, slug)
    if filename:
        resolved = await asyncio.to_thread(
            workspace_reader.read_doc_resolved,
            agent["workspace_path"],
            filename,
            resolve=resolve,
        )
        if resolved is None:
            raise HTTPException(status_code=404, detail=f"Doc {filename} não encontrado em {slug}")
        return {"slug": slug, **resolved}

    docs = await asyncio.to_thread(workspace_reader.read_docs_cached, agent["workspace_path"])
    return {"slug": slug, "docs": docs, "count": len(docs)}


@router.get("/{slug}/tables")
async def list_agent_tables(slug: str, request: Request) -> dict[str, Any]:
    """Tabelas do domínio do agente — fonte de verdade: `agents.yaml`.

    Cada item: `{ name, db, description }`. Lista vazia é resposta válida
    (agente sem domínio de dados próprio).
    """
    await _get_agent_or_404(request, slug)
    config = request.app.state.agents_config
    tables: list[dict[str, Any]] = []
    for entry in config.get("agents", []):
        if entry.get("slug") == slug:
            tables = list(entry.get("domain_tables") or [])
            break
    return {"slug": slug, "tables": tables, "count": len(tables)}


async def _get_agent_or_404(request: Request, slug: str) -> dict[str, Any]:
    db: GrupoBorgesDB = request.app.state.db
    agent = await db.get_agent(slug)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent {slug} não encontrado")
    return agent


# ----- Chat / Pane endpoints (DS-2) ---------------------------------------
# Stubs. Tipos + roteamento + gates determinísticos prontos; lógica real entra
# em passo 2 (send_message, capture_pane loop, upsert_agent_state, task_event).

ChatModel = Literal["opus", "sonnet", "haiku"]


class PaneStreamEvent(BaseModel):
    excerpt: str
    captured_at: int
    executor_kind: str


class InputRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8192)
    idempotency_key: str = Field(min_length=1, max_length=128)


class InputResponse(BaseModel):
    tmux_delivered: bool
    sent_at: int


class ModelChangeRequest(BaseModel):
    model: ChatModel
    force: bool = False


class ModelChangeResponse(BaseModel):
    tmux_delivered: bool
    state_persisted: bool
    confirmed: bool
    model: str


_PANE_STREAM_POLL_S = 1.0
_PANE_STREAM_DISCONNECT_CHECK_S = 0.1
_MESSAGES_STREAM_LIMIT_DEFAULT = 200
_MESSAGES_STREAM_LIMIT_MAX = 500
_MESSAGES_STREAM_POLL_S = 0.25
_MESSAGES_STREAM_HEARTBEAT_S = 15.0
# 200 linhas (era 80) cobre respostas longas sem cortar o topo. Configurável
# via env pro ops afinar sob carga sem deploy. `_PANE_STREAM_MAX_CHARS` foi a
# 20k acomodando linhas mais longas + escape sequences ANSI preservadas no
# stream (bandwidth real precisa ser medido em prod — backlog Fase 2).
_PANE_STREAM_LINE_LIMIT = int(os.getenv("COCKPIT_PANE_LINE_LIMIT", "200"))
_PANE_STREAM_MAX_CHARS = int(os.getenv("COCKPIT_PANE_MAX_CHARS", "20000"))


@router.get("/{slug}/pane/stream")
async def stream_agent_pane(slug: str, request: Request) -> EventSourceResponse:
    """SSE com excerpt do pane em tempo real (poll 1 Hz, dedupe por hash).

    - 404 quando agente não existe (antes de abrir o stream)
    - Loop: `capture_pane_excerpt(line_limit=_PANE_STREAM_LINE_LIMIT,
      max_chars=_PANE_STREAM_MAX_CHARS, preserve_ansi=True)` a cada 1s;
      defaults 200/20000, overrideable via env `COCKPIT_PANE_LINE_LIMIT` /
      `COCKPIT_PANE_MAX_CHARS`. Emite `event: pane` com `{excerpt,
      captured_at, executor_kind}` só quando hash sha1 do excerpt muda.
    - `preserve_ansi=True` mantém escape sequences pro front renderizar
      cores via `lib/pane-chrome.ts:parseAnsi`.
    - Encerra ao detectar `request.is_disconnected()` no início de cada tick.
    """
    agent = await _get_agent_or_404(request, slug)
    session = agent["tmux_session"]
    executor_kind = agent.get("executor_kind") or "claude_code"

    async def _pane_stream() -> AsyncGenerator[dict, None]:
        last_hash: str | None = None
        elapsed = _PANE_STREAM_POLL_S  # força captura no primeiro tick
        while True:
            if await request.is_disconnected():
                return
            if elapsed >= _PANE_STREAM_POLL_S:
                excerpt = (
                    await tmux_driver.capture_pane_excerpt(
                        session,
                        line_limit=_PANE_STREAM_LINE_LIMIT,
                        max_chars=_PANE_STREAM_MAX_CHARS,
                        preserve_ansi=True,
                    )
                    or ""
                )
                current_hash = hashlib.sha1(excerpt.encode("utf-8")).hexdigest()
                if current_hash != last_hash:
                    yield {
                        "event": "pane",
                        "data": json.dumps(
                            {
                                "excerpt": excerpt,
                                "captured_at": int(time.time()),
                                "executor_kind": executor_kind,
                            }
                        ),
                    }
                    last_hash = current_hash
                elapsed = 0.0
            # Sleep cooperativo: checa disconnect a cada 100ms pra teardown
            # rápido em TestClient e cliente real. asyncio.sleep(1s) cego
            # pendura a stream porque sse-starlette não cancela em close.
            await asyncio.sleep(_PANE_STREAM_DISCONNECT_CHECK_S)
            elapsed += _PANE_STREAM_DISCONNECT_CHECK_S

    return EventSourceResponse(_pane_stream())


def _canonical_jsonl_message_event(event: dict[str, Any]) -> dict[str, Any] | None:
    payload = event.get("payload")
    if not isinstance(payload, dict):
        return None
    uuid_value = payload.get("uuid")
    if not uuid_value:
        return None
    kind = payload.get("type")
    if not isinstance(kind, str) or not kind:
        raw_kind = event.get("kind")
        kind = raw_kind.removeprefix("jsonl:") if isinstance(raw_kind, str) else "unknown"
    return {
        "id": event["id"],
        "kind": kind,
        "uuid": uuid_value,
        "parent_uuid": payload.get("parentUuid"),
        "session_id": payload.get("sessionId"),
        "is_sidechain": bool(payload.get("isSidechain", False)),
        "user_type": payload.get("userType"),
        "timestamp": payload.get("timestamp"),
        "created_at": event["created_at"],
        "message": payload.get("message"),
    }


def _sse_json(event: str, data: dict[str, Any]) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


@router.get("/{slug}/messages/stream")
async def stream_agent_messages(
    slug: str,
    request: Request,
    session_id: str | None = Query(default=None, alias="sessionId"),
    limit: int = Query(default=_MESSAGES_STREAM_LIMIT_DEFAULT, ge=1),
    since_id: int = Query(default=0, ge=0),
) -> EventSourceResponse:
    """SSE canônico dos eventos JSONL de conversa de um agente.

    Protocolo: `replay-start` → N `message` → `replay-end` → live polling
    com `heartbeat` a cada 15s. O cursor público é `task_events.id`.
    """
    db: GrupoBorgesDB = request.app.state.db
    await _get_agent_or_404(request, slug)

    capped_limit = min(limit, _MESSAGES_STREAM_LIMIT_MAX)
    resolved_session_id = session_id or await db.latest_jsonl_session_id(slug)

    async def _message_stream() -> AsyncGenerator[dict[str, str], None]:
        started_at = time.perf_counter()
        last_id = since_id
        replay_events = await db.list_jsonl_message_events(
            slug,
            session_id=resolved_session_id,
            since_id=since_id,
            limit=capped_limit,
        )
        yield _sse_json(
            "replay-start",
            {"session_id": resolved_session_id, "total": len(replay_events)},
        )
        for event in replay_events:
            if await request.is_disconnected():
                return
            last_id = max(last_id, int(event["id"]))
            canonical = _canonical_jsonl_message_event(event)
            if canonical is not None:
                yield _sse_json("message", canonical)
        yield _sse_json(
            "replay-end",
            {
                "last_id": last_id,
                "elapsed_ms": int((time.perf_counter() - started_at) * 1000),
            },
        )

        last_heartbeat = time.monotonic()
        while True:
            if await request.is_disconnected():
                return

            live_events = await db.list_jsonl_message_events(
                slug,
                session_id=resolved_session_id,
                since_id=last_id,
                limit=_MESSAGES_STREAM_LIMIT_MAX,
            )
            for event in live_events:
                if await request.is_disconnected():
                    return
                last_id = max(last_id, int(event["id"]))
                canonical = _canonical_jsonl_message_event(event)
                if canonical is not None:
                    yield _sse_json("message", canonical)

            now = time.monotonic()
            if now - last_heartbeat >= _MESSAGES_STREAM_HEARTBEAT_S:
                yield _sse_json("heartbeat", {"ts": int(time.time())})
                last_heartbeat = now

            await asyncio.sleep(_MESSAGES_STREAM_POLL_S)

    return EventSourceResponse(
        _message_stream(),
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/{slug}/input", response_model=InputResponse)
async def send_agent_input(
    slug: str, payload: InputRequest, request: Request
) -> InputResponse:
    """Cola `payload.text` no pane ativo via tmux paste-buffer + Enter.

    - 404 quando agente não existe
    - 422 (Pydantic) em text vazio/>8KB ou idempotency_key vazio/>128
    - 409 `agent_pane_unavailable` quando send_message=False (pane fora do
      CLI esperado — guard do tmux_driver, ex: user trocou window)
    - 200 + `tmux_delivered=True` no caminho feliz
    """
    agent = await _get_agent_or_404(request, slug)
    delivered = await tmux_driver.send_message(agent["tmux_session"], payload.text)
    if not delivered:
        raise HTTPException(status_code=409, detail="agent_pane_unavailable")
    return InputResponse(tmux_delivered=True, sent_at=int(time.time()))


_VOICE_ALLOWED_MIMES = {"audio/ogg", "audio/webm", "audio/mp4", "audio/mpeg"}
_VOICE_MAX_BYTES = 10 * 1024 * 1024  # 10MB
_VOICE_STT_SCRIPT = "/home/clawd/repos/ze_claude/ze-shared/.claude/skills/voz/scripts/stt-openai.sh"
_VOICE_STT_TIMEOUT_S = 30
_VOICE_MIME_SUFFIX = {
    "audio/ogg": ".oga",
    "audio/webm": ".webm",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
}
_IMAGE_ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp"}
_IMAGE_MAX_BYTES = 10 * 1024 * 1024  # 10MB
_IMAGE_MIME_SUFFIX = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
_AGENT_UPLOADS_BASE = Path(__file__).resolve().parents[1] / "uploads" / "agents"


def _sniff_agent_image_type(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


@router.post("/{slug}/voice")
async def post_agent_voice(
    slug: str, audio: UploadFile, request: Request
) -> dict[str, Any]:
    """Upload áudio → STT (gpt-4o-transcribe) → envia transcrito via send-keys.

    - 404 quando agente não existe
    - 422 quando mime não suportado ou tamanho > 10MB
    - 502 `stt_failed` quando script STT retorna exit≠0
    - 502 `stt_empty` quando transcrição vem vazia
    - 504 `stt_timeout` quando STT estoura 30s
    - 200 + {transcribed, tmux_delivered, duration_ms} no caminho feliz

    Cleanup do arquivo temp acontece no `finally`.
    """
    agent = await _get_agent_or_404(request, slug)

    base_mime = (audio.content_type or "").split(";")[0].strip()
    if base_mime not in _VOICE_ALLOWED_MIMES:
        raise HTTPException(
            status_code=422, detail=f"mime não suportado: {audio.content_type}"
        )

    content = await audio.read()
    if len(content) > _VOICE_MAX_BYTES:
        raise HTTPException(status_code=422, detail="audio maior que 10MB")

    started_at = time.monotonic()
    # stt-openai.sh só converte via ffmpeg extensões não reconhecidas (.oga, .opus…).
    # .webm vai direto pra OpenAI mas alguns encodings de browser falham. Salvar sempre
    # como .oga força a conversão mp3 e resolve webm/mp4/ogg de uma vez.
    suffix = ".oga"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    try:
        tmp.write(content)
        tmp.close()

        try:
            result = await asyncio.to_thread(
                subprocess.run,
                [_VOICE_STT_SCRIPT, tmp_path],
                capture_output=True,
                timeout=_VOICE_STT_TIMEOUT_S,
                text=True,
            )
        except subprocess.TimeoutExpired as e:
            raise HTTPException(status_code=504, detail="stt_timeout") from e

        if result.returncode != 0:
            stderr_tail = (result.stderr or "").strip().splitlines()
            last = stderr_tail[-1] if stderr_tail else "unknown"
            raise HTTPException(status_code=502, detail=f"stt_failed: {last}")

        transcribed = (result.stdout or "").strip()
        if not transcribed:
            raise HTTPException(status_code=502, detail="stt_empty")

        delivered = await tmux_driver.send_message(
            agent["tmux_session"], transcribed
        )
        duration_ms = int((time.monotonic() - started_at) * 1000)
        return {
            "transcribed": transcribed,
            "tmux_delivered": delivered,
            "duration_ms": duration_ms,
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@router.post("/{slug}/image")
async def post_agent_image(
    slug: str,
    file: UploadFile,
    request: Request,
    caption: str | None = Form(default=None),
) -> dict[str, Any]:
    """Upload imagem → salva permanente → envia path absoluto via send-keys.

    - 404 quando agente não existe
    - 422 quando mime não suportado, tamanho > 10MB ou bytes não são imagem real
    - 200 + {path, tmux_delivered, duration_ms} no caminho feliz
    """
    agent = await _get_agent_or_404(request, slug)

    base_mime = (file.content_type or "").split(";")[0].strip()
    if base_mime not in _IMAGE_ALLOWED_MIMES:
        raise HTTPException(
            status_code=422, detail=f"mime não suportado: {file.content_type}"
        )

    content = await file.read()
    if len(content) > _IMAGE_MAX_BYTES:
        raise HTTPException(status_code=422, detail="imagem maior que 10MB")

    ext = _IMAGE_MIME_SUFFIX[base_mime]
    sniffed_ext = _sniff_agent_image_type(content)
    if sniffed_ext is None or sniffed_ext != ext:
        raise HTTPException(status_code=422, detail="arquivo não é imagem válida")

    started_at = time.monotonic()
    filename = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:12]}{ext}"
    dest_dir = _AGENT_UPLOADS_BASE / slug
    absolute_path = dest_dir / filename

    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(absolute_path.write_bytes, content)
    except OSError as exc:
        log.error("Erro ao salvar imagem do agente %s em %s: %s", slug, absolute_path, exc)
        raise HTTPException(status_code=500, detail="erro interno ao salvar imagem") from exc

    caption_text = (caption or "").strip()
    text = f"Imagem enviada via cockpit: {absolute_path}"
    if caption_text:
        text = f"{text}\nCaption: {caption_text}"

    delivered = await tmux_driver.send_message(agent["tmux_session"], text)
    duration_ms = int((time.monotonic() - started_at) * 1000)
    log.info("agent %s: imagem salva %s", slug, absolute_path)
    return {
        "path": str(absolute_path),
        "tmux_delivered": delivered,
        "duration_ms": duration_ms,
    }


@router.post("/{slug}/model", response_model=ModelChangeResponse)
async def change_agent_model(
    slug: str, payload: ModelChangeRequest, request: Request
) -> ModelChangeResponse:
    """Troca modelo do agente via `/model <slug>` (Claude Code).

    Gates:
    - 404 quando agente não existe
    - 422 (Pydantic) quando model fora do whitelist opus/sonnet/haiku
    - 422 `codex_no_runtime_model_switch` quando executor_kind=codex (DS-2.1)
    - 409 `agent_busy_confirm_required` quando lifecycle=trabalhando sem force

    Caminho feliz (200):
    1. envia `/model <slug>` via send_message
    2. picker idempotente: aguarda 300ms e envia Enter extra
    3. poll capture_pane_excerpt em t+500/1000/1500ms; regex parse_model_from_pane
       confirma propagação. `confirmed=False` é warning (não erro).
    4. persiste state_model SÓ se delivered=True (inversão v2)
    5. emite task_event `agent.model_change` com {from, to, actor, confirmed}
    """
    agent = await _get_agent_or_404(request, slug)
    if agent.get("executor_kind") == "codex":
        raise HTTPException(status_code=422, detail="codex_no_runtime_model_switch")
    if agent.get("lifecycle_status") == "trabalhando" and not payload.force:
        raise HTTPException(status_code=409, detail="agent_busy_confirm_required")

    db: GrupoBorgesDB = request.app.state.db
    session = agent["tmux_session"]
    target = payload.model
    from_model = agent.get("state_model") or agent.get("model_default")

    delivered = await tmux_driver.send_message(session, f"/model {target}")

    state_persisted = False
    confirmed = False

    if delivered:
        # Picker do /model pode parar em prompt de confirmação ("Switch to ... y/n").
        # Enter idempotente: sem picker, cai em prompt vazio e o CC ignora.
        await asyncio.sleep(0.3)
        await tmux_driver.press_enter(session)

        # Poll de confirmação em t+500/1000/1500ms (acumulado). Sai cedo no match.
        for _ in range(3):
            await asyncio.sleep(0.5)
            excerpt = await tmux_driver.capture_pane_excerpt(session)
            if tmux_driver.parse_model_from_pane(excerpt) == target:
                confirmed = True
                break

        # Persistência só após delivered=True (v2: sem regressão silenciosa).
        await db.upsert_agent_state(slug, model=target)
        state_persisted = True

        await db.insert_task_event(
            kind="agent.model_change",
            agent_slug=slug,
            payload={
                "from": from_model,
                "to": target,
                "actor": "cockpit",
                "confirmed": confirmed,
            },
        )

    return ModelChangeResponse(
        tmux_delivered=delivered,
        state_persisted=state_persisted,
        confirmed=confirmed,
        model=target,
    )
