from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
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
    "role": "executor",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "claude_code",
    "model_default": "gpt-5.6-sol[1m]",
    "model_family": "codex-proxy",
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
                    "current_usage": {
                        "input_tokens": 12,
                        "output_tokens": 200,
                        "cache_creation_input_tokens": 800,
                        "cache_read_input_tokens": 154_000,
                    },
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
        # A pílula do composer mostra tamanho, não fração: os quatro campos de
        # `current_usage` somados, que é a mesma conta do painel do agente.
        assert agent["context_tokens"] == 155_012
    finally:
        status_path.unlink(missing_ok=True)


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


# A sparkline é a consulta mais cara da casa: 229 MB de escrita e 1,2 s por
# chamada de /api/fleet, medido em 15/08 no processo do uvicorn. O painel bate
# nela a cada ~1,7 s. Os três testes seguram as duas metades do conserto: não
# recalcular à toa, e nunca servir gráfico de outra janela.
#
# A régua é o próprio cache: recalcular SEMPRE reescreve a tupla, então a tupla
# intacta prova que a consulta não rodou. Comparar o desenho não provaria — ele
# é igual nos dois casos, que é justamente o motivo de existir validade.
def test_sparkline_nao_recalcula_dentro_da_validade(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)

    db._fleet_snapshot(24, {"daniel"}, {"daniel"})
    antes = db._sparkline_cache
    db._fleet_snapshot(24, {"daniel"}, {"daniel"})

    assert db._sparkline_cache is antes


def test_sparkline_vencida_recalcula(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)

    db._fleet_snapshot(24, {"daniel"}, {"daniel"})
    since, contagem, tokens, _ = db._sparkline_cache
    vencido = (since, contagem, tokens, 0.0)
    db._sparkline_cache = vencido
    db._fleet_snapshot(24, {"daniel"}, {"daniel"})

    assert db._sparkline_cache is not vencido
    assert db._sparkline_cache[3] > 0.0


def test_sparkline_de_outra_janela_nao_e_reaproveitada(tmp_path: Path) -> None:
    """Na virada da hora o `since_unix` muda: servir o cache velho desenharia
    24 h que já não são as últimas 24 h."""
    db = _setup_db(tmp_path)

    db._fleet_snapshot(24, {"daniel"}, {"daniel"})
    _, contagem, tokens, vence = db._sparkline_cache
    de_outra_janela = (0, contagem, tokens, vence)
    db._sparkline_cache = de_outra_janela
    db._fleet_snapshot(24, {"daniel"}, {"daniel"})

    assert db._sparkline_cache is not de_outra_janela
    assert db._sparkline_cache[0] != 0


def _app_com_tmux_falso(db: GrupoBorgesDB, monkeypatch) -> FastAPI:
    async def fake_list_session_inventory() -> tmux_driver.TmuxSessionInventory:
        return tmux_driver.TmuxSessionInventory(set(), set())

    monkeypatch.setattr(
        fleet_router.tmux_driver, "list_session_inventory", fake_list_session_inventory
    )
    app = FastAPI()
    app.state.db = db
    app.include_router(fleet_router.router, prefix="/api/fleet")
    return app


def test_sem_ordem_gravada_o_snapshot_nao_inventa_posicao(tmp_path: Path, monkeypatch) -> None:
    """A metade que prova que nada quebrou: quem nunca arrastou vê o de sempre."""
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])

    with TestClient(_app_com_tmux_falso(db, monkeypatch)) as client:
        response = client.get("/api/fleet")

    assert response.status_code == 200
    corpo = response.json()
    assert [a["slug"] for a in corpo["agents"]] == ["daniel", "tara"]
    assert all(a["ordem"] is None for a in corpo["agents"])


def test_ordem_arrastada_persiste_e_o_snapshot_sai_na_ordem_nova(
    tmp_path: Path, monkeypatch
) -> None:
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])

    with TestClient(_app_com_tmux_falso(db, monkeypatch)) as client:
        patch = client.patch("/api/fleet/ordem", json={"slugs": ["tara", "daniel"]})
        assert patch.status_code == 200
        assert patch.json()["source"] == "agent_state.ordem"

        response = client.get("/api/fleet")

    corpo = response.json()
    # Alfabético devolveria daniel primeiro; a ordem arrastada é que manda.
    assert [a["slug"] for a in corpo["agents"]] == ["tara", "daniel"]
    assert _agent_from_snapshot(corpo, "tara")["ordem"] == 0
    assert _agent_from_snapshot(corpo, "daniel")["ordem"] == 1


def test_ordem_recusa_slug_fora_da_frota_e_nao_grava_nada(tmp_path: Path, monkeypatch) -> None:
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])

    with TestClient(_app_com_tmux_falso(db, monkeypatch)) as client:
        recusa = client.patch("/api/fleet/ordem", json={"slugs": ["tara", "fantasma"]})
        assert recusa.status_code == 422
        assert "fantasma" in recusa.json()["detail"]

        # Recusa é tudo-ou-nada: a posição do `tara` que veio no mesmo pedido
        # não pode ter sido gravada.
        corpo = client.get("/api/fleet").json()

    assert all(a["ordem"] is None for a in corpo["agents"])


def test_ordem_recusa_slug_repetido(tmp_path: Path, monkeypatch) -> None:
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])

    with TestClient(_app_com_tmux_falso(db, monkeypatch)) as client:
        recusa = client.patch("/api/fleet/ordem", json={"slugs": ["tara", "tara"]})

    assert recusa.status_code == 422


def test_agente_novo_sem_ordem_cai_no_fim_sem_bagunçar_quem_foi_arrastado(
    tmp_path: Path, monkeypatch
) -> None:
    """A MISTURA: uns com posição gravada, outro que chegou depois com `NULL`.

    É o caso real de quem entra no `agents.yaml` já com a ordem definida. O
    `ORDER BY s.ordem IS NULL, s.ordem, a.slug` existe pra isto: quem tem número
    manda, quem não tem vai pro fim — em vez de o `NULL` se comportar como zero
    e roubar o topo.
    """
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])

    novo = dict(TARA, slug="hiro", name="Hiro Nakamura", tmux_session="hiro")

    with TestClient(_app_com_tmux_falso(db, monkeypatch)) as client:
        assert client.patch("/api/fleet/ordem", json={"slugs": ["tara", "daniel"]}).status_code == 200

        db._sync_agents([AGENT, TARA, novo])
        corpo = client.get("/api/fleet").json()

    assert [a["slug"] for a in corpo["agents"]] == ["tara", "daniel", "hiro"]
    assert [a["ordem"] for a in corpo["agents"]] == [0, 1, None]


def test_ordem_recusa_lista_incompleta(tmp_path: Path, monkeypatch) -> None:
    """Lista parcial gravaria posição REPETIDA.

    O `UPDATE` só toca quem veio; quem ficou de fora mantém o número velho. Com
    dois agentes em 0 e 1, um PATCH só com o segundo deixaria os dois em 0.
    """
    db = _setup_db(tmp_path)
    db._sync_agents([AGENT, TARA])

    with TestClient(_app_com_tmux_falso(db, monkeypatch)) as client:
        assert client.patch("/api/fleet/ordem", json={"slugs": ["tara", "daniel"]}).status_code == 200

        recusa = client.patch("/api/fleet/ordem", json={"slugs": ["daniel"]})
        assert recusa.status_code == 422
        assert "tara" in recusa.json()["detail"]

        # A ordem anterior continua de pé — recusa não grava metade.
        corpo = client.get("/api/fleet").json()

    assert [a["ordem"] for a in corpo["agents"]] == [0, 1]
