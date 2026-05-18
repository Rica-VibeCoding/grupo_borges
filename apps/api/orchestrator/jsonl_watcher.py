"""
JsonlWatcher — observa append-only writes em JSONLs do Claude Code.

Watcheia ~/.claude/projects/ (raiz, recursivo). Filtra por:
  - extensão .jsonl
  - encoded-cwd (subpasta) que bate com workspace_path de algum agente conhecido

Inicialização (start):
  - Pré-popula `_offsets` com o tamanho atual de cada JSONL conhecido.
    Isso evita o cenário de OOM onde o watcher acabou de subir e o primeiro
    Change.modified faria leitura de 0 → tail num arquivo de centenas de MB,
    com replay de todo histórico no DB.

Por arquivo, mantém último offset lido. Em cada Change.modified, lê só os
bytes novos, parseia linhas completas e dispara para o DB:
  - insert_task_event(kind=f"jsonl:{type}", agent_slug=slug, payload=parsed, raw_jsonl=line)
  - upsert_agent_state(slug, jsonl_path=path)

Encoded-cwd format do CC (validado contra ~/.claude/projects/ real em PC e VPS):
  todo char fora de [A-Za-z0-9-] vira '-', sem consolidar consecutivos.
    /home/clawd/repos/ze_claude/daniel       → -home-clawd-repos-ze-claude-daniel
    C:\\...\\projetos\\ze claude\\daniel     → C--Users-...-projetos-ze-claude-daniel
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

from watchfiles import Change, awatch

from orchestrator.checkpoint_parser import checkpoint_hash, parse_checkpoint
from util import parse_dict_or_none

logger = logging.getLogger(__name__)

_NON_ENCODED_CHAR = re.compile(r"[^A-Za-z0-9-]")
_subagent_state: dict[str, dict[str, dict[str, Any]]] = {}
_subagent_status_events: dict[str, list[dict[str, Any]]] = {}
_subagent_event_seq = 0
# Reverse lookup pra fechamento de subagent: quando o assistant principal
# emite `tool_use {name: "Task", id: TUID}`, o JSONL do CC depois entrega o
# tool_result referenciando esse TUID (não a uuid da msg). Pra correlacionar
# tool_result → parent_uuid (uuid da msg que disparou o Task), guardamos
# {slug → {tool_use_id → parent_uuid}}. Populado em assistant.tool_use Task,
# consumido em user.tool_result, limpo no fechamento.
_subagent_task_tool_use: dict[str, dict[str, str]] = {}
# {slug → {agentId → parent_uuid}} — pro caso ASYNC (Agent run_in_background),
# o fim do subagent vem como queue-operation enqueue com task-notification,
# que só tem agentId pra identificar de qual subagent é. Esse mapa traduz
# pro parent_uuid armazenado em _subagent_state.
_subagent_agent_to_parent: dict[str, dict[str, str]] = {}
# {slug → {agentId}} — quando a task-notification do CC chega ANTES de
# vermos o primeiro sidechain do subagent (subagent ultra-rápido onde o
# JsonlWatcher leu o final do arquivo antes do meio), guardamos aqui pra
# fechar assim que o primeiro sidechain chegar.
_subagent_pending_close: dict[str, set[str]] = {}


def encoded_cwd(workspace_path: str) -> str:
    return _NON_ENCODED_CHAR.sub("-", workspace_path)


def _short_text(value: object, *, limit: int = 80) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    if not text:
        return None
    return text if len(text) <= limit else f"{text[: limit - 3]}..."


def _content_blocks(payload: dict) -> list[dict]:
    message = payload.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    if isinstance(content, list):
        return [block for block in content if isinstance(block, dict)]
    return []


def _now_ms() -> int:
    return int(time.time() * 1000)


def _jsonl_bool(payload: dict, *keys: str) -> bool:
    return any(bool(payload.get(key)) for key in keys)


def _jsonl_value(payload: dict, *keys: str) -> Any:
    for key in keys:
        value = payload.get(key)
        if value is not None:
            return value
    return None


def _append_subagent_status(slug: str, payload: dict[str, Any]) -> None:
    global _subagent_event_seq
    _subagent_event_seq += 1
    event = {"seq": _subagent_event_seq, **payload}
    events = _subagent_status_events.setdefault(slug, [])
    events.append(event)
    del events[:-200]


def _tool_result_ids(payload: dict) -> set[str]:
    ids: set[str] = set()
    for block in _content_blocks(payload):
        if block.get("type") != "tool_result":
            continue
        tool_use_id = block.get("tool_use_id")
        if isinstance(tool_use_id, str) and tool_use_id:
            ids.add(tool_use_id)
    # tool_use_id_match: chave custom opcional pro caller informar diretamente
    # qual tool_use_id está sendo fechado, sem precisar mergulhar em content[].
    # Mantida pra evolução defensiva — payloads sintéticos de teste/cli a usam.
    match = payload.get("tool_use_id_match")
    if isinstance(match, str) and match:
        ids.add(match)
    return ids


def _register_subagent_tool_use(slug: str, payload: dict) -> None:
    # Assistant principal emitiu `tool_use {name: "Task"|"Agent", id: TUID}`.
    # Registra TUID → uuid da própria msg, pra que o tool_result subsequente
    # (que só carrega TUID, não parent_uuid) consiga fechar o subagent quando
    # for o caso síncrono (Task). Caso async (Agent run_in_background) o fim
    # real vem por `assistant.isSidechain + stop_reason=end_turn` — ver
    # `_close_subagent_by_agent_id` abaixo.
    msg_uuid = payload.get("uuid")
    if not isinstance(msg_uuid, str) or not msg_uuid:
        return
    for block in _content_blocks(payload):
        if block.get("type") != "tool_use":
            continue
        if block.get("name") not in ("Task", "Agent"):
            continue
        tool_use_id = block.get("id")
        if isinstance(tool_use_id, str) and tool_use_id:
            _subagent_task_tool_use.setdefault(slug, {})[tool_use_id] = msg_uuid


_TASK_NOTIF_ID_RE = re.compile(r"<task-id>\s*([A-Za-z0-9_-]+)\s*</task-id>")


def _close_subagent_by_agent_id(slug: str, agent_id: str, now: int) -> None:
    parent_uuid = _subagent_agent_to_parent.get(slug, {}).get(agent_id)
    if not parent_uuid:
        return
    active_by_parent = _subagent_state.get(slug, {})
    state = active_by_parent.pop(parent_uuid, None)
    if state is None:
        return
    _append_subagent_status(
        slug,
        {
            "parent_uuid": parent_uuid,
            "status": "completed",
            "started_at_ms": state["started_at_ms"],
            "duration_ms": max(0, now - state["started_at_ms"]),
            "last_seen_ms": state["last_seen_ms"],
        },
    )
    _subagent_agent_to_parent.get(slug, {}).pop(agent_id, None)


def _maybe_close_subagent_via_task_notification(slug: str, payload: dict, now: int) -> None:
    # Fim do subagent ASYNC (Agent run_in_background): CC enfileira um evento
    # `queue-operation` no JSONL principal com content `<task-notification>
    # <task-id>X</task-id> <status>completed</status>...` — é o sinal oficial
    # de fim do subagent quando o caller é assíncrono. (stop_reason="end_turn"
    # NÃO é emitido pelo CC pra subagents async, confirmado em E2E vivo.)
    content = payload.get("content")
    if not isinstance(content, str) or "<task-notification>" not in content:
        return
    match = _TASK_NOTIF_ID_RE.search(content)
    if not match:
        return
    agent_id = match.group(1)
    parent_uuid = _subagent_agent_to_parent.get(slug, {}).get(agent_id)
    if parent_uuid:
        _close_subagent_by_agent_id(slug, agent_id, now)
        return
    # Race: task-notification chegou antes de qualquer sidechain do agentId
    # (subagent ultra-rápido). Marca pra fechar assim que o sidechain entrar.
    _subagent_pending_close.setdefault(slug, set()).add(agent_id)


def update_subagent_state_from_jsonl(
    slug: str,
    payload: dict | None,
    event_type: str,
    *,
    now_ms: int | None = None,
) -> None:
    """Atualiza estado in-memory de subagents ativos a partir de uma linha JSONL."""
    if not payload:
        return
    now = now_ms if now_ms is not None else _now_ms()

    if event_type == "assistant":
        _register_subagent_tool_use(slug, payload)

    parent_uuid = _jsonl_value(payload, "parentUuid", "parent_uuid")
    agent_id = payload.get("agentId") if isinstance(payload.get("agentId"), str) else None
    if (
        _jsonl_bool(payload, "isSidechain", "is_sidechain")
        and isinstance(parent_uuid, str)
        and parent_uuid
    ):
        active_by_parent = _subagent_state.setdefault(slug, {})
        state = active_by_parent.get(parent_uuid)
        if state is None:
            state = {"started_at_ms": now, "last_seen_ms": now}
            active_by_parent[parent_uuid] = state
            if agent_id:
                _subagent_agent_to_parent.setdefault(slug, {})[agent_id] = parent_uuid
            _append_subagent_status(
                slug,
                {
                    "parent_uuid": parent_uuid,
                    "status": "active",
                    "started_at_ms": state["started_at_ms"],
                    "last_seen_ms": state["last_seen_ms"],
                },
            )
            # Race-handling: se a task-notification chegou ANTES desse
            # primeiro sidechain, fecha já agora (emit completed back-to-back).
            if agent_id and agent_id in _subagent_pending_close.get(slug, set()):
                _subagent_pending_close[slug].discard(agent_id)
                _close_subagent_by_agent_id(slug, agent_id, now)
                return
        else:
            state["last_seen_ms"] = now
            if agent_id and agent_id not in _subagent_agent_to_parent.setdefault(slug, {}):
                _subagent_agent_to_parent[slug][agent_id] = parent_uuid

    # Caso 1: fim do subagent ASYNC — queue-operation enqueue com
    # content `<task-notification><task-id>X</task-id>...`. Esse é o sinal
    # oficial do CC.
    if event_type == "queue-operation" and payload.get("operation") == "enqueue":
        _maybe_close_subagent_via_task_notification(slug, payload, now)
        return

    if event_type != "user":
        return
    active_by_parent = _subagent_state.get(slug)
    if not active_by_parent:
        return
    # Caso 2: fim do subagent SÍNCRONO (Task tool clássico) — tool_result
    # carrega tool_use_id; via _subagent_task_tool_use traduzimos pra
    # parent_uuid. Mantemos o match direto pra payloads sintéticos onde
    # tool_use_id já é o parent_uuid (ver testes).
    completed_ids = _tool_result_ids(payload)
    tool_use_map = _subagent_task_tool_use.get(slug, {})
    candidate_parents: set[str] = set(completed_ids)
    for tuid in completed_ids:
        mapped_parent = tool_use_map.get(tuid)
        if mapped_parent:
            candidate_parents.add(mapped_parent)
    for completed_parent in candidate_parents & set(active_by_parent):
        state = active_by_parent.pop(completed_parent)
        _append_subagent_status(
            slug,
            {
                "parent_uuid": completed_parent,
                "status": "completed",
                "started_at_ms": state["started_at_ms"],
                "duration_ms": max(0, now - state["started_at_ms"]),
                "last_seen_ms": state["last_seen_ms"],
            },
        )
    # GC: tira do map os TUIDs cujo parent já fechou (ou nunca esteve ativo)
    for tuid in list(tool_use_map.keys()):
        mapped = tool_use_map.get(tuid)
        if mapped and mapped not in active_by_parent:
            tool_use_map.pop(tuid, None)


def subagent_active_snapshot(
    slug: str,
    *,
    task_id: str | None = None,
) -> list[dict[str, Any]]:
    # task_id filtra subsessões tool-spawned daquela task (LB-9 Bloco 3 popover).
    # Nativas CC (sem task_id no state) ficam fora quando o filtro é aplicado —
    # o popover só renderiza tool-spawned mesmo.
    return [
        {
            "parent_uuid": parent_uuid,
            "status": "active",
            "started_at_ms": state["started_at_ms"],
            "last_seen_ms": state["last_seen_ms"],
            # Campos extras presentes só em subsessões spawned by tool (LB-9)
            **{
                k: state[k]
                for k in (
                    "task_id", "session_name", "worktree_path",
                    "workspace_path", "visibility", "spawned_by_tool",
                )
                if k in state
            },
        }
        for parent_uuid, state in _subagent_state.get(slug, {}).items()
        if task_id is None or state.get("task_id") == task_id
    ]


def register_spawned_subagent(
    slug: str,
    subsession_id: str,
    *,
    task_id: str,
    session_name: str,
    worktree_path: str,
    workspace_path: str,
    visibility: bool,
    agent_slug: str,
    now_ms: int | None = None,
) -> None:
    """Registra subsessão criada via tool MCP spawn_subsession no estado in-memory."""
    now = now_ms if now_ms is not None else _now_ms()
    active_by_parent = _subagent_state.setdefault(slug, {})
    active_by_parent[subsession_id] = {
        "started_at_ms": now,
        "last_seen_ms": now,
        "task_id": task_id,
        "session_name": session_name,
        "worktree_path": worktree_path,
        "workspace_path": workspace_path,
        "visibility": visibility,
        "agent_slug": agent_slug,
        "spawned_by_tool": True,
    }
    _append_subagent_status(
        slug,
        {
            "parent_uuid": subsession_id,
            "status": "starting",
            "started_at_ms": now,
            "last_seen_ms": now,
            "task_id": task_id,
            "session_name": session_name,
            "visibility": visibility,
            "spawned_by_tool": True,
        },
    )


def subagent_status_events_since(
    slug: str,
    after_seq: int,
) -> tuple[list[dict[str, Any]], int]:
    events = [
        event
        for event in _subagent_status_events.get(slug, [])
        if int(event.get("seq", 0)) > after_seq
    ]
    latest_seq = after_seq
    if events:
        latest_seq = max(int(event["seq"]) for event in events)
    return events, latest_seq


def count_active_subsessions_for_task(task_id: str) -> int:
    """Conta subsessões tool-spawned ativas para um task_id específico."""
    count = 0
    for slug_state in _subagent_state.values():
        for state in slug_state.values():
            if state.get("spawned_by_tool") and state.get("task_id") == task_id:
                count += 1
    return count


def mark_stalled_subagents(slug: str, *, now_ms: int | None = None) -> list[dict[str, Any]]:
    # Stalled é emitido UMA VEZ por parent_uuid: removemos do state após emitir
    # pra evitar (1) re-emissão a cada scan de 10s e (2) crescimento monotônico
    # do dict quando subagent crasha sem tool_result. Itera sobre snapshot pra
    # mutar dict no loop.
    #
    # TTL: spawned_by_tool = 600s (10min — não têm JSONL, só expiram por tempo).
    #      nativo CC = 30s (JSONL atualiza last_seen_ms a cada evento).
    now = now_ms if now_ms is not None else _now_ms()
    stalled: list[dict[str, Any]] = []
    slug_state = _subagent_state.get(slug, {})
    for parent_uuid in list(slug_state.keys()):
        state = slug_state[parent_uuid]
        ttl_ms = 600_000 if state.get("spawned_by_tool") else 30_000
        if now - state["last_seen_ms"] <= ttl_ms:
            continue
        payload: dict[str, Any] = {
            "parent_uuid": parent_uuid,
            "status": "stalled",
            "started_at_ms": state["started_at_ms"],
            "last_seen_ms": state["last_seen_ms"],
            "duration_ms": max(0, now - state["started_at_ms"]),
        }
        # Inclui campos de cleanup para subsessões tool-spawned
        for field in ("worktree_path", "workspace_path", "session_name", "spawned_by_tool", "task_id"):
            if field in state:
                payload[field] = state[field]
        _append_subagent_status(slug, payload)
        stalled.append(payload)
        slug_state.pop(parent_uuid, None)
    return stalled


def mark_completed_when_tmux_gone(
    alive_tmux_sessions: set[str],
    *,
    now_ms: int | None = None,
) -> list[dict[str, Any]]:
    """Tool-spawned cuja tmux session sumiu = terminou limpo, marca como completed.

    Antes desse check, claude --bg que encerrava normalmente ficava grudado em
    _subagent_state até o TTL 600s do mark_stalled. Popover do task continuava
    mostrando subsessão "ativa" durante esses 10min.

    Chamado pelo SubsessionSweeper a cada tick com snapshot atual do tmux.
    Retorna entries com status:"completed" (mesmo formato de mark_stalled) para
    o sweeper drenar (kill_tmux no-op + cleanup_worktree).
    """
    now = now_ms if now_ms is not None else _now_ms()
    completed: list[dict[str, Any]] = []
    for slug in list(_subagent_state.keys()):
        slug_state = _subagent_state[slug]
        for parent_uuid in list(slug_state.keys()):
            state = slug_state[parent_uuid]
            if not state.get("spawned_by_tool"):
                continue
            session_name = state.get("session_name", "")
            if not session_name or session_name in alive_tmux_sessions:
                continue
            payload: dict[str, Any] = {
                "parent_uuid": parent_uuid,
                "status": "completed",
                "started_at_ms": state["started_at_ms"],
                "last_seen_ms": state["last_seen_ms"],
                "duration_ms": max(0, now - state["started_at_ms"]),
            }
            for field in ("worktree_path", "workspace_path", "session_name", "spawned_by_tool", "task_id"):
                if field in state:
                    payload[field] = state[field]
            _append_subagent_status(slug, payload)
            completed.append(payload)
            slug_state.pop(parent_uuid, None)
    return completed


def mark_stalled_all_slugs(*, now_ms: int | None = None) -> list[dict[str, Any]]:
    """Varre todos os slugs e retorna todas as entradas stalled.

    Usado pelo SubsessionSweeper periódico — não pelo SSE tick por slug.
    """
    all_stalled: list[dict[str, Any]] = []
    for slug in list(_subagent_state.keys()):
        all_stalled.extend(mark_stalled_subagents(slug, now_ms=now_ms))
    return all_stalled


def reset_subagent_state_for_tests() -> None:
    global _subagent_event_seq
    _subagent_state.clear()
    _subagent_status_events.clear()
    _subagent_task_tool_use.clear()
    _subagent_agent_to_parent.clear()
    _subagent_pending_close.clear()
    _subagent_event_seq = 0


# DS-64 F4-3 A4 — sessão nova do CC = JSONL novo. Sem reset, subagents
# active da sessão antiga continuam grudados no `_subagent_state[slug]`
# (UI mostra spinner pra subagent que já morreu). Limpa só índices por
# slug; `_subagent_event_seq` é global (não tem por slug) e segue.
def reset_subagent_state_for_slug(slug: str) -> None:
    _subagent_state.pop(slug, None)
    _subagent_status_events.pop(slug, None)
    _subagent_task_tool_use.pop(slug, None)
    _subagent_agent_to_parent.pop(slug, None)
    _subagent_pending_close.pop(slug, None)


def _jsonl_lifecycle(payload: dict | None, event_type: str) -> tuple[str | None, str | None]:
    if not payload:
        return None, None
    if event_type == "user":
        message = payload.get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return "trabalhando", "mensagem do usuário"
            if any(
                block.get("type") == "text"
                and isinstance(block.get("text"), str)
                and block.get("text", "").strip()
                for block in _content_blocks(payload)
            ):
                return "trabalhando", "mensagem do usuário"
        return None, None
    if event_type == "summary":
        return None, None
    if event_type == "result":
        outcome = _short_text(payload.get("outcome"), limit=80)
        return "ocioso", outcome or "sessão finalizada"
    if event_type == "assistant":
        message = payload.get("message")
        if not isinstance(message, dict):
            return None, None
        stop_reason = _short_text(message.get("stop_reason"), limit=40)
        if stop_reason == "end_turn":
            return "ocioso", "passou a bola"
        if any(block.get("type") == "tool_use" for block in _content_blocks(payload)):
            return "trabalhando", "tool_use"
        return None, None
    if event_type == "system" and payload.get("subtype") == "turn_duration":
        return "ocioso", "passou a bola"
    return None, None


class JsonlWatcher:
    def __init__(
        self,
        *,
        claude_projects_dir: str,
        agents: list[dict],
        db,  # GrupoBorgesDB — não importamos pra evitar ciclo
    ) -> None:
        self._root = Path(claude_projects_dir)
        self._root_resolved = self._root.resolve() if self._root.exists() else self._root
        self._db = db
        self._slug_by_encoded: dict[str, str] = {
            encoded_cwd(a["workspace_path"]): a["slug"] for a in agents
        }
        self._offsets: dict[str, int] = {}
        # F4-3 A4 — último JSONL processado por slug. Mudança = nova sessão
        # CC → reseta subagent state pro slug pra não carregar fantasmas.
        self._last_jsonl_by_slug: dict[str, str] = {}
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        await asyncio.to_thread(self._prepopulate_offsets)
        self._task = asyncio.create_task(self._run(), name="jsonl-watcher")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # ---------- internals ----------

    def _prepopulate_offsets(self) -> None:
        """Marca cada JSONL existente como 'já lido até o tamanho atual'.

        Sem isso, no primeiro Change.modified leríamos do byte 0 — replay
        gigante e potencial OOM. Também loga warning se nenhum dos slugs
        configurados tem pasta correspondente (config provavelmente errada).
        """
        if not self._root.exists():
            logger.warning("JSONL watcher: %s não existe — watcher inativo", self._root)
            return

        found_slugs: set[str] = set()
        for encoded, slug in self._slug_by_encoded.items():
            agent_dir = self._root / encoded
            if not agent_dir.is_dir():
                continue
            found_slugs.add(slug)
            for jsonl in agent_dir.rglob("*.jsonl"):
                try:
                    self._offsets[str(jsonl)] = jsonl.stat().st_size
                except OSError:
                    continue

        missing = set(self._slug_by_encoded.values()) - found_slugs
        if missing:
            logger.warning(
                "JSONL watcher: nenhuma pasta encoded-cwd encontrada em %s pros agentes: %s",
                self._root,
                sorted(missing),
            )

    async def _run(self) -> None:
        if not self._root.exists():
            return  # já avisado em _prepopulate_offsets
        try:
            async for changes in awatch(
                str(self._root),
                stop_event=self._stop,
                watch_filter=self._filter,
                recursive=True,
            ):
                for change_type, raw_path in changes:
                    if change_type != Change.modified:
                        continue
                    await self._process_jsonl(Path(raw_path))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("JSONL watcher crashed")

    def _filter(self, change: Change, path: str) -> bool:
        if not path.endswith(".jsonl"):
            return False
        return self._slug_for_path(path) is not None

    def _slug_for_path(self, path: str) -> str | None:
        try:
            rel = Path(path).resolve().relative_to(self._root_resolved)
        except ValueError:
            return None
        return self._slug_by_encoded.get(rel.parts[0]) if rel.parts else None

    async def _process_jsonl(self, path: Path) -> None:
        slug = self._slug_for_path(str(path))
        if slug is None:
            return
        last_offset = self._offsets.get(str(path), 0)
        try:
            new_lines, new_offset = await asyncio.to_thread(
                _read_appended, path, last_offset
            )
        except FileNotFoundError:
            return
        if not new_lines:
            return
        self._offsets[str(path)] = new_offset

        # F4-3 A4 — detecta sessão CC nova (JSONL path diferente do último
        # visto pro slug) e zera subagent state antes de processar a
        # primeira rajada. Pré-popula no boot evita reset no primeiro tick.
        previous_path = self._last_jsonl_by_slug.get(slug)
        if previous_path is not None and previous_path != str(path):
            reset_subagent_state_for_slug(slug)
        self._last_jsonl_by_slug[slug] = str(path)

        for line in new_lines:
            payload = parse_dict_or_none(line)
            event_type = str((payload or {}).get("type") or "unknown")
            update_subagent_state_from_jsonl(slug, payload, event_type)
            await self._db.insert_task_event(
                kind=f"jsonl:{event_type}",
                agent_slug=slug,
                payload=payload,
                raw_jsonl=line,
            )
            lifecycle_status, lifecycle_detail = _jsonl_lifecycle(payload, event_type)
            if lifecycle_status is not None:
                await self._db.update_agent_lifecycle(
                    slug,
                    status=lifecycle_status,
                    detail=lifecycle_detail,
                    event=f"jsonl:{event_type}",
                )
            await self._db.touch_agent_run_heartbeat(
                slug,
                source_kind=f"jsonl:{event_type}",
            )
            if lifecycle_status is not None:
                await self._db.advance_task_from_lifecycle(
                    slug,
                    lifecycle_status=lifecycle_status,
                    source_event=f"jsonl:{event_type}",
                )
            # Fonte 3 (JSONL lossless): detectar STATE: em texto de mensagens assistant
            if event_type == "assistant" and payload:
                await self._try_detect_checkpoint(slug, payload)

        await self._db.upsert_agent_state(slug, jsonl_path=str(path))

    async def _try_detect_checkpoint(self, slug: str, payload: dict) -> None:
        """Detecta STATE: no texto de mensagem assistant e aciona record_checkpoint."""
        text = _extract_assistant_text(payload)
        if not text:
            return
        cp = parse_checkpoint(text)
        if cp is None:
            return
        # Busca a task running mais recente deste agente como target
        running_tasks = await self._db.list_tasks(assignee=slug, status="running", limit=1)
        if not running_tasks:
            return
        task_id = running_tasks[0]["id"]
        chash = checkpoint_hash(
            state=cp["state"],
            summary=cp.get("summary"),
            files_changed=cp.get("files_changed"),
            next_step=cp.get("next_step"),
        )
        await self._db.record_checkpoint(
            task_id=task_id,
            agent_slug=slug,
            state=cp["state"],
            summary=cp.get("summary"),
            files_changed=cp.get("files_changed"),
            next_step=cp.get("next_step"),
            handoff_to=cp.get("handoff_to"),
            content_hash=chash,
            source="jsonl_watcher",
        )


def _extract_assistant_text(payload: dict) -> str | None:
    """Extrai texto de um evento JSONL assistant. Retorna None se não tiver texto."""
    message = payload.get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str):
        return content or None
    if isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return "\n".join(p for p in parts if p) or None
    return None


def _read_appended(path: Path, offset: int) -> tuple[list[str], int]:
    """Lê do offset até o último \\n do arquivo. Retorna (linhas_completas, novo_offset).

    Linha incompleta no final (CC ainda escrevendo) fica pra próxima iteração.
    Se o arquivo encolheu (truncado/recriado), reinicia do zero.
    """
    with path.open("rb") as f:
        f.seek(0, 2)
        size = f.tell()
        if size == offset:
            return [], offset
        if size < offset:
            offset = 0  # truncated — reset
        f.seek(offset)
        data = f.read(size - offset)
    if not data:
        return [], size
    last_newline = data.rfind(b"\n")
    if last_newline == -1:
        return [], offset  # nada completo ainda
    consumed_bytes = data[: last_newline + 1]
    new_offset = offset + len(consumed_bytes)
    text = consumed_bytes.decode("utf-8", errors="replace")
    lines = [ln for ln in text.split("\n") if ln.strip()]
    return lines, new_offset
