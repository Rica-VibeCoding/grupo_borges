from __future__ import annotations

import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import GrupoBorgesDB
from routers.codex_events import CodexEventCreate, _codex_lifecycle, _codex_state_update


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


DANIEL = {
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


def _setup_db(tmp_path: Path) -> GrupoBorgesDB:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL, TARA])
    return db


def _event(kind: str, payload: dict | None = None) -> CodexEventCreate:
    return CodexEventCreate(
        kind=kind,
        delegator_agent_slug="daniel",
        target_agent_slug="tara",
        payload=payload,
    )


def test_codex_events_update_agent_state(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)

    for event in (
        _event("tara.exec.started", {"started_at": 1_700_000_000, "label": "Opção C"}),
        _event("codex.turn.started"),
        _event(
            "codex.item.started",
            {"item": {"type": "command_execution", "command": "uv run pytest apps/api/tests"}},
        ),
        _event(
            "codex.item.completed",
            {"item": {"type": "agent_message", "text": "Backend completo com parser Codex."}},
        ),
        _event(
            "codex.turn.completed",
            {"usage": {"input_tokens": 32_000, "output_tokens": 100}},
        ),
        _event(
            "codex.event_msg",
            {
                "type": "token_count",
                "info": {
                    "last_token_usage": {
                        "input_tokens": 58_000,
                        "cached_input_tokens": 45_000,
                        "output_tokens": 650,
                        "reasoning_output_tokens": 290,
                        "total_tokens": 58_798,
                    },
                    "total_token_usage": {"total_tokens": 276_736},
                    "model_context_window": 258_400,
                },
                "rate_limits": {
                    "primary": {
                        "used_percent": 4.0,
                        "window_minutes": 10_080,
                        "resets_at": 1_786_196_095,
                    }
                },
            },
        ),
        _event("tara.exec.completed"),
    ):
        db._update_agent_codex_state("tara", **_codex_state_update(event))
    status, detail = _codex_lifecycle(_event("tara.exec.completed"))
    db._update_agent_lifecycle(
        "tara",
        status=status,
        detail=detail,
        event="tara.exec.completed",
    )

    agent = db._get_agent("tara")
    fleet_agent = next(
        agent
        for agent in db._fleet_snapshot(24, {"tara"}, {"tara"})["agents"]
        if agent["slug"] == "tara"
    )

    assert agent["executor_kind"] == "codex"
    assert agent["status_line"] == "ocioso"
    assert agent["active_task_label"] == "Opção C"
    assert agent["context_pct"] == 22.8
    assert fleet_agent["context_pct"] == 22.8
    assert agent["session_started_at"] == 1_700_000_000
    assert agent["last_assistant_message"] == "Backend completo com parser Codex."
    token_usage = json.loads(agent["token_usage_json"])
    assert token_usage["source"] == "codex.event_msg.token_count"
    assert token_usage["context_tokens"] == 58_798
    assert token_usage["model_context_window"] == 258_400
    assert token_usage["rate_limits"]["primary"]["window_minutes"] == 10_080
    assert agent["lifecycle_status"] == "ocioso"


def test_thread_started_guarda_o_id_do_run(tmp_path: Path) -> None:
    """O `thread.started` é o único evento do `exec --json` que traz o thread_id.

    Sem guardá-lo, o painel volta a procurar a thread pelo `workspace_path` — e o
    run sai com `-C <repo do dia>`, então a busca acha a thread do run anterior.
    """
    db = _setup_db(tmp_path)
    novo = "019fe7c0-5958-7a93-81ae-6281f51df69f"

    db._update_agent_codex_state("tara", **_codex_state_update(_event(
        "codex.thread.started", {"thread_id": "run-anterior", "started_at": 1_700_000_000}
    )))
    db._update_agent_codex_state("tara", **_codex_state_update(_event(
        "codex.thread.started", {"thread_id": novo, "started_at": 1_700_009_000}
    )))

    agent = db._get_agent("tara")
    assert agent["codex_thread_id"] == novo
    assert agent["session_started_at"] == 1_700_009_000


def test_thread_started_sem_id_nao_apaga_o_run_conhecido(tmp_path: Path) -> None:
    """Evento truncado não pode zerar o id — sem ele o painel perde a thread certa."""
    db = _setup_db(tmp_path)
    db._update_agent_codex_state("tara", codex_thread_id="run-em-curso")

    db._update_agent_codex_state("tara", **_codex_state_update(
        _event("codex.thread.started", {"started_at": 1_700_000_000})
    ))

    assert db._get_agent("tara")["codex_thread_id"] == "run-em-curso"


def test_thread_started_consome_a_nova_conversa_armada(tmp_path: Path) -> None:
    """A "nova conversa" (`codex_next_fresh`) só consumiu quando a thread nova
    NASCEU (`codex.thread.started`). É o que impede o piscar: enquanto o flag
    está armado, `/codex/messages` devolve vazio — zerar antes mostraria a
    thread velha no gap entre o spawn e o nascimento da nova (Rica, 10/08)."""
    db = _setup_db(tmp_path)
    novo = "019fe7c0-5958-7a93-81ae-6281f51df69f"
    db._update_agent_codex_state("tara", codex_next_fresh=1)

    db._update_agent_codex_state("tara", **_codex_state_update(
        _event("codex.thread.started", {"thread_id": novo, "started_at": 1_700_000_000})
    ))

    agent = db._get_agent("tara")
    assert agent["codex_thread_id"] == novo
    assert agent["codex_next_fresh"] == 0


def test_codex_failed_marks_lifecycle_offline(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)

    event = _event("tara.exec.failed", {"error": "processo abortou"})
    db._update_agent_codex_state("tara", **_codex_state_update(event))
    status, detail = _codex_lifecycle(event)
    db._update_agent_lifecycle(
        "tara",
        status=status,
        detail=detail,
        event="tara.exec.failed",
    )

    agent = db._get_agent("tara")
    fleet_agent = next(
        agent
        for agent in db._fleet_snapshot(24, set(), set())["agents"]
        if agent["slug"] == "tara"
    )

    assert agent["executor_kind"] == "codex"
    assert agent["status_line"] == "falhou: processo abortou"
    assert agent["lifecycle_status"] == "offline"
    assert fleet_agent["status"] == "offline"


def test_fleet_snapshot_keeps_new_fields_null_for_claude_code(tmp_path: Path) -> None:
    db = _setup_db(tmp_path)

    daniel = next(
        agent
        for agent in db._fleet_snapshot(24, {"daniel"}, {"daniel"})["agents"]
        if agent["slug"] == "daniel"
    )

    assert daniel["executor_kind"] is None
    assert daniel["status_line"] is None
    assert daniel["active_task_label"] is None
    assert daniel["context_pct"] is None
    assert daniel["session_started_at"] is None
    assert daniel["last_assistant_message"] is None
    assert daniel["token_usage_json"] is None
