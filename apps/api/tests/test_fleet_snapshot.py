from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import fleet as fleet_router
from services import tmux_driver


AGENT = {
    "slug": "daniel",
    "name": "Daniel Singh",
    "role": "reviewer",
    "emoji": "DS",
    "tmux_session": "daniel",
    "workspace_path": "/tmp/daniel",
    "cli_default": "claude_code",
    "model_default": "opus",
    "capabilities": [],
    "can_review": [],
}

TARA = {
    "slug": "tara",
    "name": "Tara Kaur",
    "role": "codex",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "codex",
    "model_default": "codex-gpt-5-6-sol",
    "capabilities": [],
    "can_review": [],
}


def _setup_db(tmp_path: Path) -> GrupoBorgesDB:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([AGENT])
    return db


def _create_task(
    db: GrupoBorgesDB,
    *,
    id: str,
    title: str,
    assignee: str,
    status: str,
) -> dict:
    return db._create_task(
        id=id,
        title=title,
        assignee=assignee,
        body=None,
        instance_id=None,
        origin_agent=None,
        skill_hint=None,
        status=status,
        priority=0,
        idempotency_key=None,
    )


def _agent_from_snapshot(snapshot: dict, slug: str) -> dict:
    return next(agent for agent in snapshot["agents"] if agent["slug"] == slug)


def test_fleet_snapshot_ignores_ready_and_backlog_tasks(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)
    _create_task(
        db,
        id="ready-task",
        title="Ready task",
        assignee="daniel",
        status="ready",
    )
    _create_task(
        db,
        id="backlog-task",
        title="Backlog task",
        assignee="daniel",
        status="backlog",
    )

    snapshot = db._fleet_snapshot(24, {"daniel"}, {"daniel"})

    assert _agent_from_snapshot(snapshot, "daniel")["current_task_id"] is None


def test_fleet_snapshot_uses_running_task_display_id(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)
    running = _create_task(
        db,
        id="running-task",
        title="Running task",
        assignee="daniel",
        status="running",
    )
    _create_task(
        db,
        id="ready-task",
        title="Ready task",
        assignee="daniel",
        status="ready",
    )

    snapshot = db._fleet_snapshot(24, {"daniel"}, {"daniel"})

    assert _agent_from_snapshot(snapshot, "daniel")["current_task_id"] == running["human_id"]


def test_fleet_route_hydrates_claude_context_pct_from_status_file(tmp_path: Path, monkeypatch) -> None:
    db = _setup_db(tmp_path)
    session_id = f"fleet-context-{int(time.time())}"
    db._insert_task_event(
        "jsonl:assistant",
        task_id=None,
        agent_slug="daniel",
        instance_id=None,
        payload={"uuid": f"uuid-{session_id}", "sessionId": session_id},
        raw_jsonl=None,
    )
    status_path = Path(f"/tmp/cc-status-{session_id}.json")
    status_path.write_text(
        json.dumps(
            {
                "context_window": {
                    "used_percentage": 42,
                },
            }
        ),
        encoding="utf-8",
    )

    async def fake_capture(_session_name: str) -> str:
        return "Opus 4.8 - Cascading... (3m 33s · 12.7k tokens)"

    async def fake_list_session_inventory() -> tmux_driver.TmuxSessionInventory:
        return tmux_driver.TmuxSessionInventory({"daniel"}, {"daniel"})

    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", fake_capture)
    monkeypatch.setattr(
        fleet_router.tmux_driver,
        "list_session_inventory",
        fake_list_session_inventory,
    )

    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")

    try:
        with TestClient(app) as client:
            response = client.get("/api/fleet")

        assert response.status_code == 200
        agent = _agent_from_snapshot(response.json(), "daniel")
        assert agent["context_pct"] == 42
    finally:
        status_path.unlink(missing_ok=True)


def test_fleet_route_hydrates_codex_tokens_used_from_native_thread(tmp_path: Path, monkeypatch) -> None:
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])
    db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        context_pct=100.0,
        codex_next_fresh=1,
    )
    rollout = tmp_path / "rollout.jsonl"
    rollout.write_text(
        json.dumps(
            {
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "last_token_usage": {
                            "total_tokens": 58_798,
                        },
                        "model_context_window": 258_400,
                    },
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )

    async def fake_capture(_session_name: str) -> str:
        return "GPT-5.6 Sol - 00:03:03"

    async def fake_list_session_inventory() -> tmux_driver.TmuxSessionInventory:
        return tmux_driver.TmuxSessionInventory(
            {"daniel", "tara"}, {"daniel", "tara"}
        )

    def fake_resolve_thread(*, thread_id: str | None, cwd: str, **_kwargs):
        # Agente que ainda não reportou `thread.started` continua caindo no cwd.
        assert thread_id is None
        assert cwd == "/tmp/tara"
        return SimpleNamespace(tokens_used=9_712_154, rollout_path=rollout)

    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", fake_capture)
    monkeypatch.setattr(
        fleet_router.tmux_driver,
        "list_session_inventory",
        fake_list_session_inventory,
    )
    # Opção A (10/08): sem thread do delegator cockpit, o card segue no cwd —
    # o arquivo real `~/.tara/threads/cockpit.txt` da máquina não pode vazar pro teste.
    monkeypatch.setattr(fleet_router.codex_reader, "read_cockpit_thread_id", lambda: None)
    monkeypatch.setattr(fleet_router.codex_reader, "resolve_thread", fake_resolve_thread)

    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")

    with TestClient(app) as client:
        response = client.get("/api/fleet")

    assert response.status_code == 200
    agent = _agent_from_snapshot(response.json(), "tara")
    assert agent["codex_tokens_used"] == 9_712_154
    assert agent["codex_next_fresh"] is True
    assert agent["context_pct"] == 22.8


def _prepara_card_codex(tmp_path: Path, monkeypatch, *, medido_em: int, iniciou_em: int) -> FastAPI:
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])
    db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        codex_thread_id="thread-do-run",
        session_started_at=iniciou_em,
    )
    rollout = tmp_path / "rollout.jsonl"
    rollout.write_text(
        json.dumps(
            {
                "type": "event_msg",
                "timestamp": datetime.fromtimestamp(medido_em, tz=timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
                "payload": {
                    "type": "token_count",
                    "info": {
                        "last_token_usage": {"total_tokens": 161_907},
                        "model_context_window": 258_400,
                    },
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )

    async def fake_list_session_inventory() -> tmux_driver.TmuxSessionInventory:
        return tmux_driver.TmuxSessionInventory({"daniel", "tara"}, {"daniel", "tara"})

    monkeypatch.setattr(
        fleet_router.tmux_driver, "list_session_inventory", fake_list_session_inventory
    )
    monkeypatch.setattr(
        fleet_router.codex_reader,
        "resolve_thread",
        lambda **_kwargs: SimpleNamespace(tokens_used=161_907, rollout_path=rollout),
    )

    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")
    return app


def test_fleet_card_marca_contexto_medido_antes_da_sessao_como_velho(
    tmp_path: Path, monkeypatch
) -> None:
    """Metade (a): número de run anterior não pode sair do back com cara de atual."""
    agora = int(time.time())
    app = _prepara_card_codex(tmp_path, monkeypatch, medido_em=agora - 2_200, iniciou_em=agora - 1_000)

    with TestClient(app) as client:
        agent = _agent_from_snapshot(client.get("/api/fleet").json(), "tara")

    assert agent["context_stale"] is True
    assert agent["context_updated_at"] == agora - 2_200
    # O número segue entregue: esconder deixaria o card sem dizer se é zero ou falta de leitura.
    assert agent["context_pct"] == 62.7


def test_fleet_card_mantem_contexto_de_quem_trabalha_como_atual(
    tmp_path: Path, monkeypatch
) -> None:
    """Metade (b): medida do run em curso continua valendo como atual."""
    agora = int(time.time())
    app = _prepara_card_codex(tmp_path, monkeypatch, medido_em=agora - 30, iniciou_em=agora - 1_000)

    with TestClient(app) as client:
        agent = _agent_from_snapshot(client.get("/api/fleet").json(), "tara")

    assert agent["context_stale"] is False
    assert agent["context_pct"] == 62.7


def test_fleet_card_marca_pct_sem_carimbo_como_velho(tmp_path: Path, monkeypatch) -> None:
    """Run recém-começado ainda não mediu nada — o que sobra é o pct velho do banco.

    Era o pior caso do defeito: número de outro run, sem idade nenhuma, saindo com
    cara de leitura de agora.
    """
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])
    db._update_agent_codex_state("tara", executor_kind="codex", context_pct=100.0)

    async def fake_list_session_inventory() -> tmux_driver.TmuxSessionInventory:
        return tmux_driver.TmuxSessionInventory({"daniel", "tara"}, {"daniel", "tara"})

    monkeypatch.setattr(
        fleet_router.tmux_driver, "list_session_inventory", fake_list_session_inventory
    )
    monkeypatch.setattr(fleet_router.codex_reader, "resolve_thread", lambda **_kwargs: None)

    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")

    with TestClient(app) as client:
        agent = _agent_from_snapshot(client.get("/api/fleet").json(), "tara")

    assert agent["context_pct"] == 100.0
    assert agent["context_updated_at"] is None
    assert agent["context_stale"] is True


def test_fleet_lists_tmux_inventory_once_per_snapshot(tmp_path: Path, monkeypatch) -> None:
    db = _setup_db(tmp_path)
    calls = 0

    async def fake_list_session_inventory() -> tmux_driver.TmuxSessionInventory:
        nonlocal calls
        calls += 1
        return tmux_driver.TmuxSessionInventory({"daniel"}, {"daniel"})

    async def fake_capture(_session_name: str) -> None:
        return None

    monkeypatch.setattr(
        fleet_router.tmux_driver,
        "list_session_inventory",
        fake_list_session_inventory,
    )
    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", fake_capture)

    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")

    with TestClient(app) as client:
        response = client.get("/api/fleet")

    assert response.status_code == 200
    assert calls == 1


def test_fleet_nao_publica_contexto_de_sessao_morta(tmp_path: Path, monkeypatch) -> None:
    """Depois do `/clear` a sessão nova ainda não escreveu statusline — e o
    card publicava o percentual da sessão que morreu (o Rica viu 16% no
    Canário). Sem número da sessão ATUAL, o honesto é zero."""
    db = _setup_db(tmp_path)
    morta = f"fleet-morta-{int(time.time())}"
    viva = f"fleet-viva-{int(time.time())}"
    for session_id in (morta, viva):
        db._insert_task_event(
            "jsonl:assistant",
            task_id=None,
            agent_slug="daniel",
            instance_id=None,
            payload={"uuid": f"uuid-{session_id}", "sessionId": session_id},
            raw_jsonl=None,
        )
    status_path = Path(f"/tmp/cc-status-{morta}.json")
    status_path.write_text(
        json.dumps({"updated_at": 1786388459, "context_window": {"used_percentage": 16}}),
        encoding="utf-8",
    )

    async def fake_capture(_session_name: str) -> str:
        return "Opus 4.8 - 33:03 - [█░░░░░░░░░] 16%"

    async def fake_list_session_inventory() -> tmux_driver.TmuxSessionInventory:
        return tmux_driver.TmuxSessionInventory({"daniel"}, {"daniel"})

    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", fake_capture)
    monkeypatch.setattr(
        fleet_router.tmux_driver, "list_session_inventory", fake_list_session_inventory
    )

    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")

    try:
        with TestClient(app) as client:
            response = client.get("/api/fleet")
        agent = _agent_from_snapshot(response.json(), "daniel")
        assert agent["context_pct"] == 0
    finally:
        status_path.unlink(missing_ok=True)


def test_fleet_carimba_a_hora_em_que_o_contexto_foi_medido(tmp_path: Path, monkeypatch) -> None:
    """Número sem carimbo não pode envelhecer — era por isso que o card nunca
    dizia 'antigo' no caminho Claude Code."""
    db = _setup_db(tmp_path)
    session_id = f"fleet-carimbo-{int(time.time())}"
    db._insert_task_event(
        "jsonl:assistant",
        task_id=None,
        agent_slug="daniel",
        instance_id=None,
        payload={"uuid": f"uuid-{session_id}", "sessionId": session_id},
        raw_jsonl=None,
    )
    medido_em = int(time.time())
    status_path = Path(f"/tmp/cc-status-{session_id}.json")
    status_path.write_text(
        json.dumps({"updated_at": medido_em, "context_window": {"used_percentage": 42}}),
        encoding="utf-8",
    )

    async def fake_capture(_session_name: str) -> str:
        return "Opus 4.8 - 01:00 - [█░░░░░░░░░] 9%"

    async def fake_list_session_inventory() -> tmux_driver.TmuxSessionInventory:
        return tmux_driver.TmuxSessionInventory({"daniel"}, {"daniel"})

    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", fake_capture)
    monkeypatch.setattr(
        fleet_router.tmux_driver, "list_session_inventory", fake_list_session_inventory
    )

    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")

    try:
        with TestClient(app) as client:
            response = client.get("/api/fleet")
        agent = _agent_from_snapshot(response.json(), "daniel")
        assert agent["context_pct"] == 42
        assert agent["context_updated_at"] == medido_em
        assert agent["context_stale"] is False
    finally:
        status_path.unlink(missing_ok=True)
