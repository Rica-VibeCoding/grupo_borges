from __future__ import annotations

from pathlib import Path

from db.store import GrupoBorgesDB

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

AGORA = 1_790_000_000


def _db(tmp_path: Path) -> GrupoBorgesDB:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([AGENT])
    db._create_task(
        id="t1", title="t", assignee="daniel", body=None, instance_id=None,
        origin_agent=None, skill_hint=None, status="doing", priority=0,
        idempotency_key=None,
    )
    return db


def _evento(db: GrupoBorgesDB, created_at: int) -> None:
    with db._connect() as conn:
        conn.execute(
            "INSERT INTO task_events (task_id, agent_slug, kind, payload, created_at)"
            " VALUES ('t1', 'daniel', 'x', '{}', ?)",
            (created_at,),
        )
        conn.commit()


def test_pulso_poe_cada_evento_no_minuto_certo(tmp_path: Path) -> None:
    db = _db(tmp_path)
    for t in (AGORA, AGORA - 59, AGORA - 60, AGORA - 30 * 60 + 1, AGORA - 30 * 60):
        _evento(db, t)

    baldes, ultimo = db._event_pulse("daniel", AGORA, 30)

    assert len(baldes) == 30
    # Os dois do último minuto caem no balde final; o de exatos 60 s atrás, no
    # anterior; o da borda de 30 min abre a série e o de fora não entra.
    assert baldes[-1] == 2
    assert baldes[-2] == 1
    assert baldes[0] == 1
    assert sum(baldes) == 4
    assert ultimo == AGORA


def test_pulso_sem_evento_na_janela_ainda_diz_o_ultimo(tmp_path: Path) -> None:
    db = _db(tmp_path)
    _evento(db, AGORA - 3 * 3600)

    baldes, ultimo = db._event_pulse("daniel", AGORA, 30)

    assert baldes == [0] * 30
    assert ultimo == AGORA - 3 * 3600
