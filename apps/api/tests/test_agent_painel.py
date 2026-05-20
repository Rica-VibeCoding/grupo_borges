from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import GrupoBorgesDB
from routers import agents as agents_router


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


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


def _write_settings(tmp_path: Path, monkeypatch, payload: dict) -> None:
    claude_home = tmp_path / ".claude"
    claude_home.mkdir()
    (claude_home / "settings.json").write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(agents_router, "_CLAUDE_HOME", claude_home)


def _insert_session_event(db: GrupoBorgesDB, session_id: str) -> None:
    db._insert_task_event(
        "jsonl:assistant",
        task_id=None,
        agent_slug="daniel",
        instance_id=None,
        payload={"uuid": f"uuid-{session_id}", "sessionId": session_id},
        raw_jsonl=None,
    )


def test_agent_painel_calcula_contexto(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "high"})
    app = _build_app(tmp_path)
    app.state.db._update_agent_codex_state(
        "daniel",
        token_usage_json=json.dumps(
            {
                "input_tokens": 120_000,
                "output_tokens": 1_500,
                "cache_creation_input_tokens": 3_000,
                "cache_read_input_tokens": 50_000,
                "context_window_size": 200_000,
            }
        ),
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    body = response.json()
    assert body["contexto"]["available"] is True
    assert body["contexto"]["tokens"] == {
        "input": 120_000,
        "output": 1_500,
        "cache_creation": 3_000,
        "cache_read": 50_000,
        "total": 174_500,
    }
    assert body["contexto"]["pct"] == 87.25
    assert body["contexto"]["model_family"] == "opus"
    assert body["effort"]["value"] == "high"


def test_agent_painel_quota_missing_without_file(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    _insert_session_event(app.state.db, "ds135-missing")
    Path("/tmp/cc-status-ds135-missing.json").unlink(missing_ok=True)

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    quotas = response.json()["quotas"]
    assert quotas["status"] == "missing"
    assert quotas["session_id"] == "ds135-missing"
    assert quotas["source"] == "/tmp/cc-status-ds135-missing.json"


def test_agent_painel_parse_quota_file(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    session_id = f"ds135-{int(time.time())}"
    _insert_session_event(app.state.db, session_id)
    quota_path = Path(f"/tmp/cc-status-{session_id}.json")
    quota_path.write_text(
        json.dumps(
            {
                "updated_at": int(time.time()),
                "rate_limits": {
                    "five_hour": {
                        "reset_at": 1_779_157_200,
                        "remaining_seconds": 7_200,
                        "used_pct": 64.2,
                    },
                    "seven_day": {
                        "reset_at": 1_779_668_400,
                        "remaining_seconds": 518_400,
                        "used_pct": 33.8,
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    try:
        assert response.status_code == 200
        quotas = response.json()["quotas"]
        assert quotas["status"] == "available"
        assert quotas["session_id"] == session_id
        assert quotas["five_hour"]["remaining_seconds"] == 7_200
        assert quotas["five_hour"]["used_pct"] == 64.2
        assert quotas["seven_day"]["reset_at"] == 1_779_668_400
    finally:
        quota_path.unlink(missing_ok=True)


def test_agent_painel_404(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.get("/api/agents/inexistente/painel")

    assert response.status_code == 404


def test_agent_painel_patch_effort_atualiza_settings(tmp_path: Path, monkeypatch) -> None:
    settings = {
        "effortLevel": "medium",
        "theme": "dark",
        "nested": {"keep": True},
    }
    _write_settings(tmp_path, monkeypatch, settings)
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/daniel/effort", json={"effort": "xhigh"})

    assert response.status_code == 200
    body = response.json()
    settings_path = tmp_path / ".claude" / "settings.json"
    assert body == {
        "slug": "daniel",
        "effort": "xhigh",
        "source": str(settings_path),
        "session_may_diverge": True,
        "written": True,
    }
    persisted = json.loads(settings_path.read_text(encoding="utf-8"))
    assert persisted["effortLevel"] == "xhigh"
    assert persisted["theme"] == "dark"
    assert persisted["nested"] == {"keep": True}


def test_agent_painel_patch_effort_invalido(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/daniel/effort", json={"effort": "ultra-high"})

    assert response.status_code == 422


def test_agent_painel_patch_effort_404(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/inexistente/effort", json={"effort": "high"})

    assert response.status_code == 404
