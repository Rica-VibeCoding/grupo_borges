from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta, timezone
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

TARA = {
    "slug": "tara",
    "name": "Tara Kaur",
    "role": "executor",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "codex",
    "model_default": "gpt-5.5",
    "capabilities": [],
    "can_review": [],
}

HIRO = {
    "slug": "hiro",
    "name": "Hiro Nakamura",
    "role": "dev",
    "emoji": "🧪",
    "tmux_session": "hiro",
    "workspace_path": "/tmp/hiro",
    "cli_default": "claude_code",
    "model_default": "k3",
    "model_family": "kimi",
    "capabilities": [],
    "can_review": [],
}


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL, TARA, HIRO])
    db._update_agent_codex_state("tara", executor_kind="codex")
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL, TARA, HIRO]}
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
    _write_settings(
        tmp_path,
        monkeypatch,
        {"effortLevel": "high", "permissions": {"defaultMode": "plan"}},
    )
    app = _build_app(tmp_path)
    session_id = f"ds135-contexto-{int(time.time())}"
    _insert_session_event(app.state.db, session_id)
    quota_path = Path(f"/tmp/cc-status-{session_id}.json")
    quota_path.write_text(
        json.dumps(
            {
                "updated_at": int(time.time()),
                "model": {"id": "claude-fable-5", "display_name": "Fable 5"},
                "context_window": {
                    "context_window_size": 200_000,
                    "used_percentage": 87,
                    "remaining_percentage": 13,
                    "current_usage": {
                        "input_tokens": 120_000,
                        "output_tokens": 1_500,
                        "cache_creation_input_tokens": 3_000,
                        "cache_read_input_tokens": 50_000,
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    try:
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
        assert body["contexto"]["pct"] == 87
        assert body["contexto"]["context_window"] == 200_000
        assert body["contexto"]["model_family"] == "fable"
        assert body["effort"]["value"] == "high"
        assert body["permission"]["mode"] == "plan"
    finally:
        quota_path.unlink(missing_ok=True)


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
                        "resets_at": int(time.time()) + 7_200,
                        "used_percentage": 64,
                    },
                    "seven_day": {
                        "resets_at": int(time.time()) + 518_400,
                        "used_percentage": 33,
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
        assert quotas["five_hour"]["used_percentage"] == 64
        assert 7_000 <= quotas["five_hour"]["remaining_seconds"] <= 7_200
        assert quotas["seven_day"]["used_percentage"] == 33
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


def test_agent_painel_codex_effort_permite_xhigh(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/tara/effort", json={"effort": "xhigh"})
        painel = client.get("/api/agents/tara/painel")

    assert response.status_code == 200
    assert response.json() == {
        "slug": "tara",
        "effort": "xhigh",
        "source": "agent_state.codex_reasoning_effort",
        "session_may_diverge": True,
        "written": True,
    }
    assert painel.status_code == 200
    body = painel.json()
    assert body["effort"]["value"] == "xhigh"
    assert body["effort"]["allowed"] == ["low", "medium", "high", "xhigh"]
    assert body["codex_native"] is True


def test_agent_painel_codex_effort_rejeita_max(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/tara/effort", json={"effort": "max"})

    assert response.status_code == 422
    assert response.json()["detail"] == "codex_effort_not_allowed"


def test_agent_painel_kimi_effort_permite_max(tmp_path: Path, monkeypatch) -> None:
    """Kimi (Hiro) — effort persiste em agent_state (env de boot), allowed é a
    trinca do motor (low/high/max), NÃO toca o settings.json global."""
    settings_dir = tmp_path / ".claude"
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/hiro/effort", json={"effort": "max"})
        painel = client.get("/api/agents/hiro/painel")

    assert response.status_code == 200
    assert response.json() == {
        "slug": "hiro",
        "effort": "max",
        "source": "agent_state.kimi_reasoning_effort",
        "session_may_diverge": True,
        "written": True,
    }
    assert painel.status_code == 200
    body = painel.json()
    assert body["effort"]["value"] == "max"
    assert body["effort"]["allowed"] == ["low", "high", "max"]
    # settings global intocado — o valor "medium" é dos agentes Anthropic.
    assert json.loads((settings_dir / "settings.json").read_text())["effortLevel"] == "medium"


def test_agent_painel_kimi_effort_rejeita_medium(tmp_path: Path, monkeypatch) -> None:
    """Kimi (Hiro) — medium/xhigh não existem no motor (só low/high/max)."""
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/hiro/effort", json={"effort": "medium"})

    assert response.status_code == 422
    assert response.json()["detail"] == "kimi_effort_not_allowed"


def test_agent_painel_patch_effort_404(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/inexistente/effort", json={"effort": "high"})

    assert response.status_code == 404


def test_agent_painel_ler_permission_mode_atual(tmp_path: Path, monkeypatch) -> None:
    _write_settings(
        tmp_path,
        monkeypatch,
        {"permissions": {"defaultMode": "bypassPermissions"}},
    )
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    body = response.json()
    settings_path = tmp_path / ".claude" / "settings.json"
    assert body["permission"] == {
        "mode": "bypassPermissions",
        "source": str(settings_path),
        "session_may_diverge": True,
    }


def test_agent_painel_patch_permission_mode_preserva_settings(tmp_path: Path, monkeypatch) -> None:
    settings = {
        "effortLevel": "medium",
        "permissions": {"defaultMode": "ask", "extra": "keep"},
        "theme": "dark",
    }
    _write_settings(tmp_path, monkeypatch, settings)
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/daniel/permission-mode", json={"mode": "plan"})

    assert response.status_code == 200
    settings_path = tmp_path / ".claude" / "settings.json"
    assert response.json() == {
        "slug": "daniel",
        "mode": "plan",
        "source": str(settings_path),
        "session_may_diverge": True,
        "written": True,
    }
    persisted = json.loads(settings_path.read_text(encoding="utf-8"))
    assert persisted["permissions"] == {"defaultMode": "plan", "extra": "keep"}
    assert persisted["effortLevel"] == "medium"
    assert persisted["theme"] == "dark"


def test_agent_painel_patch_permission_mode_invalido(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {"permissions": {"defaultMode": "ask"}})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/daniel/permission-mode", json={"mode": "danger"})

    assert response.status_code == 422


def _write_agent_view_job(
    tmp_path: Path,
    job_id: str,
    payload: dict,
) -> None:
    jobs_dir = tmp_path / ".claude" / "jobs" / job_id
    jobs_dir.mkdir(parents=True, exist_ok=True)
    (jobs_dir / "state.json").write_text(json.dumps(payload), encoding="utf-8")


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _now_iso_z() -> str:
    return _iso_z(datetime.now(timezone.utc))


def test_agent_painel_subagents_lista_agent_view_jobs(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    now_iso = _now_iso_z()
    older_iso = _iso_z(datetime.now(timezone.utc) - timedelta(minutes=1))
    _write_agent_view_job(
        tmp_path,
        "alpha",
        {
            "state": "working",
            "name": "alpha task",
            "sessionId": "sess-alpha",
            "cwd": "/tmp/fora-do-workspace/sub",
            "createdAt": "2026-05-19T12:00:00.000Z",
            "updatedAt": now_iso,
        },
    )
    _write_agent_view_job(
        tmp_path,
        "bravo",
        {
            "state": "blocked",
            "name": "bravo task",
            "sessionId": "sess-bravo",
            "cwd": "/tmp/daniel",
            "createdAt": "2026-05-19T11:00:00.000Z",
            "updatedAt": older_iso,
        },
    )
    _write_agent_view_job(
        tmp_path,
        "charlie",
        {
            "state": "idle",
            "name": "inativo",
            "sessionId": "sess-charlie",
            "cwd": "/tmp/other-agent",
            "createdAt": "2026-05-19T12:00:00.000Z",
            "updatedAt": now_iso,
        },
    )
    _write_agent_view_job(
        tmp_path,
        "delta",
        {
            "state": "completed",
            "name": "ja terminou",
            "sessionId": "sess-delta",
            "cwd": "/tmp/daniel",
            "createdAt": "2026-05-19T10:00:00.000Z",
            "updatedAt": now_iso,
        },
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    subagents = response.json()["subagents"]
    assert subagents["count"] == 2
    assert subagents["active_count"] == 2
    items = subagents["items"]
    assert len(items) == 2
    assert items[0]["sessionId"] == "sess-alpha"
    assert items[0]["state"] == "working"
    assert items[0]["name"] == "alpha task"
    assert items[0]["context_pct"] is None
    assert items[0]["context_window_size"] is None
    assert items[0]["started_at"] is not None
    assert items[1]["sessionId"] == "sess-bravo"
    assert items[1]["state"] == "blocked"


def test_agent_painel_subagents_inclui_jobs_de_outros_cwds(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    _write_agent_view_job(
        tmp_path,
        "fora",
        {
            "state": "needs_input",
            "name": "outro cwd",
            "sessionId": "sess-fora",
            "cwd": "/opt/outro-projeto",
            "createdAt": "2026-05-19T13:00:00.000Z",
            "updatedAt": _now_iso_z(),
        },
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    subagents = response.json()["subagents"]
    assert subagents["count"] == 1
    assert subagents["active_count"] == 1
    assert subagents["items"][0]["sessionId"] == "sess-fora"
    assert subagents["items"][0]["cwd"] == "/opt/outro-projeto"
    assert subagents["items"][0]["state"] == "needs_input"


def test_agent_painel_subagents_le_cc_status(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    sub_session = f"ds135-sub-{int(time.time())}"
    _write_agent_view_job(
        tmp_path,
        "echo",
        {
            "state": "working",
            "name": "with cc status",
            "sessionId": sub_session,
            "cwd": "/tmp/daniel",
            "createdAt": "2026-05-19T12:00:00.000Z",
            "updatedAt": _now_iso_z(),
        },
    )
    cc_path = Path(f"/tmp/cc-status-{sub_session}.json")
    cc_path.write_text(
        json.dumps(
            {
                "updated_at": int(time.time()),
                "model": {"id": "claude-opus-4-8", "display_name": "Opus 4.8"},
                "context_window": {
                    "context_window_size": 200_000,
                    "used_percentage": 72,
                    "current_usage": {
                        "input_tokens": 100_000,
                        "output_tokens": 2_000,
                        "cache_creation_input_tokens": 1_000,
                        "cache_read_input_tokens": 40_000,
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    try:
        with TestClient(app) as client:
            response = client.get("/api/agents/daniel/painel")

        assert response.status_code == 200
        items = response.json()["subagents"]["items"]
        assert len(items) == 1
        entry = items[0]
        assert entry["sessionId"] == sub_session
        assert entry["cwd"] == "/tmp/daniel"
        assert entry["model"] == "Opus 4.8"
        assert entry["context_pct"] == 72
        assert entry["context_window_size"] == 200_000
        assert entry["context_tokens"] == 143_000
    finally:
        cc_path.unlink(missing_ok=True)


def test_agent_painel_subagents_vazio_quando_sem_jobs(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    subagents = response.json()["subagents"]
    assert subagents == {"count": 0, "active_count": 0, "items": []}


def test_agent_painel_subagents_inclui_job_recente(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    recent_iso = _iso_z(datetime.now(timezone.utc) - timedelta(minutes=5))
    _write_agent_view_job(
        tmp_path,
        "recente",
        {
            "state": "working",
            "name": "vivo",
            "sessionId": "sess-recente",
            "cwd": "/tmp/daniel",
            "createdAt": "2026-05-19T12:00:00.000Z",
            "updatedAt": recent_iso,
        },
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    subagents = response.json()["subagents"]
    assert subagents["count"] == 1
    assert subagents["items"][0]["sessionId"] == "sess-recente"


def test_infer_sender_from_cwd_mapping() -> None:
    """Unit: cobre todo o mapeamento cwd → sender, incluindo subdirs e
    cwds desconhecidos. Testado direto no helper pra não esbarrar no cap
    de items do endpoint."""
    infer = agents_router._infer_sender_from_cwd
    assert infer("/home/clawd/repos/ze_claude/daniel") == "Daniel"
    assert infer("/home/clawd/repos/ze_claude/daniel/sub/dir") == "Daniel"
    assert infer("/home/clawd/repos/ze_claude/pavan") == "Pavan"
    assert infer("/home/clawd/repos/ze_claude/lucas") == "Lucas"
    assert infer("/home/clawd/repos/ze_claude/vinicius") == "Vinicius"
    assert infer("/home/clawd/repos/ze_claude/felipe") == "Felipe"
    assert infer("/home/clawd/repos/ze_claude/barsi") == "Barsi"
    assert infer("/home/clawd/repos/ze_claude/miga_dani") == "Miga"
    assert infer("/home/clawd/repos/grupo_borges") == "Pavan"
    assert infer("/home/clawd/repos/grupo_borges/apps/web") == "Pavan"
    assert infer("/opt/somewhere-else") is None
    assert infer(None) is None
    assert infer("") is None
    # Não confunde prefixo parcial sem `/` separador.
    assert infer("/home/clawd/repos/ze_claude/daniel-other") is None


def test_agent_painel_subagents_infer_sender_from_cwd(tmp_path: Path, monkeypatch) -> None:
    """End-to-end: o endpoint inclui `sender` em cada subagent item.
    Importante: o `cwd` em si não aparece mais na UI, mas o backend continua
    expondo o campo — o frontend só lê `sender`."""
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    now_iso = _now_iso_z()
    _write_agent_view_job(
        tmp_path,
        "daniel-spawn",
        {
            "state": "working",
            "name": "spawn por daniel",
            "sessionId": "sess-daniel-spawn",
            "cwd": "/home/clawd/repos/ze_claude/daniel/sub",
            "createdAt": "2026-05-19T12:00:00.000Z",
            "updatedAt": now_iso,
        },
    )
    _write_agent_view_job(
        tmp_path,
        "cockpit-spawn",
        {
            "state": "working",
            "name": "spawn por pavan no cockpit",
            "sessionId": "sess-cockpit",
            "cwd": "/home/clawd/repos/grupo_borges/apps/web",
            "createdAt": "2026-05-19T12:00:00.000Z",
            "updatedAt": now_iso,
        },
    )
    _write_agent_view_job(
        tmp_path,
        "desconhecido",
        {
            "state": "working",
            "name": "fora dos workspaces",
            "sessionId": "sess-desconhecido",
            "cwd": "/opt/random",
            "createdAt": "2026-05-19T12:00:00.000Z",
            "updatedAt": now_iso,
        },
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    items = response.json()["subagents"]["items"]
    by_session = {item["sessionId"]: item for item in items}
    assert by_session["sess-daniel-spawn"]["sender"] == "Daniel"
    assert by_session["sess-cockpit"]["sender"] == "Pavan"
    assert by_session["sess-desconhecido"]["sender"] is None


def test_agent_painel_subagents_descarta_job_velho(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    stale_iso = _iso_z(datetime.now(timezone.utc) - timedelta(minutes=30))
    _write_agent_view_job(
        tmp_path,
        "zumbi",
        {
            "state": "blocked",
            "name": "morto",
            "sessionId": "sess-zumbi",
            "cwd": "/tmp/daniel",
            "createdAt": "2026-05-19T12:00:00.000Z",
            "updatedAt": stale_iso,
        },
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    subagents = response.json()["subagents"]
    assert subagents == {"count": 0, "active_count": 0, "items": []}
