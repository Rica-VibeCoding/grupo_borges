"""
POST /hooks/{event_kind} — receptor de hooks do Claude Code.

Cada agente configura `.claude/settings.json` apontando hooks para
http://<vps>:8000/hooks/<EventName>. CC posta JSON com payload do evento.

Schema oficial (https://code.claude.com/docs/en/hooks) — campos top-level
sempre presentes: session_id, transcript_path, cwd, hook_event_name. Por
evento: tool_name/tool_input/tool_result, prompt, agent_id/agent_type, etc.

MVP: registra TODOS os 27 eventos crus em task_events. Lógica especial fica
reservada pra 5 críticos (UserPromptSubmit, PostToolUse, SubagentStart,
SubagentStop, Stop) — por enquanto só sinalizamos via flag no response.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from util import parse_dict_or_none, redact_payload

router = APIRouter()

CRITICAL_EVENTS = {
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "SessionStart",
    "Stop",
}


def _slug_from_cwd(cwd: str | None, agents_config: list[dict]) -> str | None:
    if not cwd:
        return None
    # Hook payload `cwd` em sessões Windows vem com '\\' literal. Normalizamos
    # ambos os lados pra '/' antes do prefix-match.
    cwd_norm = cwd.replace("\\", "/").rstrip("/")
    for a in agents_config:
        wp = a["workspace_path"].replace("\\", "/").rstrip("/")
        if cwd_norm == wp or cwd_norm.startswith(wp + "/"):
            return a["slug"]
    return None


def _short_text(value: Any, *, limit: int = 80) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    if not text:
        return None
    return text if len(text) <= limit else f"{text[: limit - 3]}..."


def _hook_lifecycle(event_kind: str, payload: dict[str, Any]) -> tuple[str, str | None]:
    tool_name = _short_text(payload.get("tool_name"), limit=64)
    agent_type = _short_text(payload.get("agent_type"), limit=64)
    matcher = _short_text(payload.get("matcher"), limit=64)

    if event_kind == "SessionStart":
        source = _short_text(payload.get("source"), limit=40)
        return "session", source or "sessao iniciada"
    if event_kind == "UserPromptSubmit":
        prompt = _short_text(payload.get("prompt"), limit=80)
        return "prompt", prompt or "prompt recebido"
    if event_kind == "PreToolUse":
        return "tool", tool_name or matcher or "tool em execucao"
    if event_kind == "PostToolUse":
        return "tool_done", tool_name or matcher or "tool concluida"
    if event_kind == "PostToolUseFailure":
        return "error", tool_name or matcher or "tool falhou"
    if event_kind == "SubagentStart":
        return "subagent", agent_type or "subagent iniciado"
    if event_kind == "SubagentStop":
        return "subagent_done", agent_type or "subagent finalizado"
    if event_kind == "Stop":
        return "idle", "turno finalizado"
    if event_kind == "StopFailure":
        reason = _short_text(payload.get("reason"), limit=80)
        return "error", reason or "turno falhou"
    return "event", event_kind


@router.post("/{event_kind}")
async def receive_hook(event_kind: str, request: Request) -> dict[str, Any]:
    db = request.app.state.db
    agents_config = request.app.state.agents_config["agents"]

    raw_body = await request.body()
    payload = parse_dict_or_none(raw_body)

    # Schema mínimo do CC: session_id + hook_event_name. Se faltar, é typo de
    # config no `.claude/settings.json` do agente — fail-loud com 400 pra que o
    # CC não considere o hook OK silenciosamente. Mesmo assim registramos em
    # task_events pra audit.
    raw_text = raw_body.decode("utf-8", errors="replace") if raw_body else None
    if payload is None or "session_id" not in payload or "hook_event_name" not in payload:
        await db.insert_task_event(
            kind=f"hook:{event_kind}:invalid",
            payload=payload,
            raw_jsonl=raw_text,
        )
        raise HTTPException(
            status_code=400,
            detail="Payload inválido: esperado JSON com session_id e hook_event_name",
        )

    cwd = payload.get("cwd")
    slug = _slug_from_cwd(cwd, agents_config)

    # Mascara secrets e trunca strings > 8KB antes de gravar (util.redact_payload).
    # raw_text também passa pelo scrub — é o JSON bruto, mesmo risco.
    safe_payload = redact_payload(payload)
    safe_raw = redact_payload(raw_text) if raw_text else None

    event_id = await db.insert_task_event(
        kind=f"hook:{event_kind}",
        agent_slug=slug,
        payload=safe_payload,
        raw_jsonl=safe_raw,
    )

    if slug is not None:
        await db.upsert_agent_state(slug)
        lifecycle_status, lifecycle_detail = _hook_lifecycle(event_kind, payload)
        await db.update_agent_lifecycle(
            slug,
            status=lifecycle_status,
            detail=lifecycle_detail,
            event=f"hook:{event_kind}",
        )
        await db.touch_agent_run_heartbeat(slug, source_kind=f"hook:{event_kind}")
        await db.advance_task_from_lifecycle(
            slug,
            lifecycle_status=lifecycle_status,
            source_event=f"hook:{event_kind}",
        )

    return {
        "received": True,
        "event_id": event_id,
        "agent_slug": slug,
        "is_critical": event_kind in CRITICAL_EVENTS,
    }
