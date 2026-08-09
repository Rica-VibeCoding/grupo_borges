from __future__ import annotations

import json
import sqlite3
from types import SimpleNamespace
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import GrupoBorgesDB
from routers import agents as agents_router
from services import tmux_driver


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


def _insert_session_event(db: GrupoBorgesDB, session_id: str, agent_slug: str = "daniel") -> None:
    db._insert_task_event(
        "jsonl:assistant",
        task_id=None,
        agent_slug=agent_slug,
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
        assert body["contexto"]["stale"] is False
        assert body["model"] == {
            "value": "fable",
            "allowed": ["fable", "opus", "sonnet", "haiku"],
            "source": str(quota_path),
            "session_may_diverge": False,
            "runtime_switch": True,
        }
        assert body["effort"]["value"] == "high"
        assert body["permission"]["mode"] == "plan"
    finally:
        quota_path.unlink(missing_ok=True)


def test_agent_painel_expoe_canal_de_entrega_bloqueado(
    tmp_path: Path, monkeypatch
) -> None:
    _write_settings(
        tmp_path,
        monkeypatch,
        {"effortLevel": "high", "permissions": {"defaultMode": "plan"}},
    )
    app = _build_app(tmp_path)
    channel = {
        "estado": "bloqueado",
        "entregando": False,
        "motivo": "input_ocupado_ou_travado",
        "mensagem": "O campo de mensagem do agente está ocupado ou travado.",
        "recusas_consecutivas": 3,
        "bloqueado_desde": 1_754_400_000,
        "bloqueado_ha_segundos": 720,
        "ultima_tentativa_em": 1_754_400_720,
        "acao_recomendada": "Use 'Destravar agente' antes de enviar novamente.",
    }

    with patch(
        "routers.agents.tmux_driver.get_delivery_channel_state",
        return_value=channel,
    ):
        with TestClient(app) as client:
            response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    assert response.json()["canal_entrega"] == channel


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


def test_agent_painel_codex_usa_token_count_para_contexto_e_quotas(
    tmp_path: Path, monkeypatch
) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    app.state.db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        context_pct=22.8,
        token_usage_json=json.dumps(
            {
                "source": "codex.event_msg.token_count",
                "usage": {
                    "input_tokens": 58_000,
                    "cached_input_tokens": 45_000,
                    "output_tokens": 650,
                    "reasoning_output_tokens": 290,
                    "total_tokens": 58_798,
                },
                "model_context_window": 258_400,
                "context_tokens": 58_798,
                "context_pct": 22.8,
                "rate_limits": {
                    "primary": {
                        "used_percent": 4.0,
                        "window_minutes": 10_080,
                        "resets_at": int(time.time()) + 6 * 24 * 3600,
                    }
                },
                "observed_at": int(time.time()),
            }
        ),
    )

    monkeypatch.setattr(
        agents_router.codex_reader,
        "find_latest_thread",
        lambda *_args: SimpleNamespace(
            reasoning_effort=None,
            model="gpt-5.6-sol",
            tokens_used=999_999_999,
            updated_at_ms=int(time.time() * 1000),
        ),
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/tara/painel")

    assert response.status_code == 200
    body = response.json()
    assert body["codex_native"] is True
    assert body["contexto"]["model"] == "gpt-5.6-sol"
    assert body["contexto"]["tokens"]["total"] == 58_798
    assert body["contexto"]["context_window"] == 258_400
    assert body["contexto"]["pct"] == 22.8
    assert body["quotas"]["status"] == "available"
    assert body["quotas"]["seven_day"]["used_percentage"] == 4.0
    assert body["quotas"]["five_hour"] is None


def _codex_token_usage_json(*, observed_at: int | None) -> str:
    payload: dict[str, Any] = {
        "source": "codex.event_msg.token_count",
        "usage": {"total_tokens": 58_798},
        "model_context_window": 258_400,
        "context_tokens": 58_798,
        "context_pct": 22.8,
        "rate_limits": {
            "primary": {
                "used_percent": 4.0,
                "window_minutes": 10_080,
                "resets_at": int(time.time()) + 6 * 24 * 3600,
            }
        },
    }
    if observed_at is not None:
        payload["observed_at"] = observed_at
    return json.dumps(payload)


@pytest.mark.parametrize(
    ("observed_at_delta", "status_esperado"),
    [
        (-9 * 3600, "stale"),
        (None, "unknown"),
    ],
)
def test_agent_painel_codex_nao_carimba_cota_velha_como_atual(
    tmp_path: Path, monkeypatch, observed_at_delta: int | None, status_esperado: str
) -> None:
    """Cota da Tara parada há horas não pode aparecer como medida agora.

    O `updated_at` vinha de `time.time()` na LEITURA — a cota nunca envelhecia.
    Payload legado (sem `observed_at`) vira `unknown`, não `available`.
    """
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    agora = int(time.time())
    app.state.db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        token_usage_json=_codex_token_usage_json(
            observed_at=None if observed_at_delta is None else agora + observed_at_delta
        ),
    )

    monkeypatch.setattr(
        agents_router.codex_reader,
        "find_latest_thread",
        lambda *_args: SimpleNamespace(
            reasoning_effort=None,
            model="gpt-5.6-sol",
            tokens_used=0,
            updated_at_ms=agora * 1000,
        ),
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/tara/painel")

    quotas = response.json()["quotas"]
    assert quotas["status"] == status_esperado
    assert quotas["stale_after_seconds"] == 300
    # o dado em si continua entregue — o que muda é a idade declarada
    assert quotas["seven_day"]["used_percentage"] == 4.0
    if observed_at_delta is None:
        assert quotas["updated_at"] is None
    else:
        assert quotas["updated_at"] == agora + observed_at_delta


def test_agent_painel_codex_cai_para_rollout_quando_state_nao_tem_token_count(
    tmp_path: Path, monkeypatch
) -> None:
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    rollout = tmp_path / "tara-rollout.jsonl"
    rollout.write_text(
        '{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":58798},"model_context_window":258400},"rate_limits":{"primary":{"used_percent":4.0,"window_minutes":10080,"resets_at":1893456000}}}}\n',
        encoding="utf-8",
    )

    monkeypatch.setattr(
        agents_router.codex_reader,
        "find_latest_thread",
        lambda *_args: SimpleNamespace(
            reasoning_effort=None,
            model="gpt-5.6-sol",
            tokens_used=500_700,
            updated_at_ms=int(time.time() * 1000),
            rollout_path=str(rollout),
        ),
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/tara/painel")

    assert response.status_code == 200
    body = response.json()
    assert body["contexto"]["tokens"]["total"] == 58_798
    assert body["contexto"]["context_window"] == 258_400
    assert body["contexto"]["pct"] == 22.8
    assert body["quotas"]["seven_day"]["used_percentage"] == 4.0


def _escreve_rollout(path: Path, *, total_tokens: int, observed_at: int) -> None:
    carimbo = datetime.fromtimestamp(observed_at, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    path.write_text(
        json.dumps(
            {
                "type": "event_msg",
                "timestamp": carimbo,
                "payload": {
                    "type": "token_count",
                    "info": {
                        "last_token_usage": {"total_tokens": total_tokens},
                        "model_context_window": 258_400,
                    },
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )


def _make_codex_state_db(tmp_path: Path, rows: list[tuple]) -> Path:
    db = tmp_path / "state.sqlite"
    conn = sqlite3.connect(db)
    conn.execute(
        """
        CREATE TABLE threads (
            id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL,
            title TEXT NOT NULL, model TEXT, reasoning_effort TEXT,
            tokens_used INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0, updated_at_ms INTEGER, created_at_ms INTEGER
        )
        """
    )
    conn.executemany("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    conn.close()
    return db


def _cenario_dois_runs(tmp_path: Path, monkeypatch, agora: int) -> None:
    """Thread do run anterior no workspace cadastrado × thread do run que roda agora.

    Reproduz o mundo real: `tara-codex ... -C /repo/do/dia` cria a thread com o cwd
    do RUN. O workspace cadastrado (`/tmp/tara`) fica com a thread do run passado.
    """
    morto = tmp_path / "rollout-morto.jsonl"
    vivo = tmp_path / "rollout-vivo.jsonl"
    _escreve_rollout(morto, total_tokens=220_911, observed_at=agora - 2_200)
    _escreve_rollout(vivo, total_tokens=161_907, observed_at=agora - 30)
    db = _make_codex_state_db(
        tmp_path,
        [
            ("morto", str(morto), "/tmp/tara", "run anterior", "gpt-5.6-terra", None,
             220_911, 0, 1, (agora - 2_200) * 1000, (agora - 9_000) * 1000),
            ("vivo", str(vivo), "/tmp/repo-do-dia", "run atual", "gpt-5.6-luna", None,
             161_907, 0, 2, (agora - 30) * 1000, (agora - 1_000) * 1000),
        ],
    )
    monkeypatch.setenv("CODEX_STATE_DB", str(db))
    monkeypatch.setattr(agents_router.codex_reader, "TELECODEX_CONTEXTS", tmp_path / "sem-telecodex.json")


def test_agent_painel_codex_segue_a_thread_do_run_vivo(tmp_path: Path, monkeypatch) -> None:
    """O card tem de mostrar o contexto de QUEM ESTÁ RODANDO.

    A thread é escolhida pelo id que o `thread.started` do run entregou, não pelo
    `workspace_path` cadastrado — o run roda em `-C <outro repo>` e a busca por cwd
    devolvia a thread do run anterior, com o número e o modelo dela.
    """
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    agora = int(time.time())
    _cenario_dois_runs(tmp_path, monkeypatch, agora)
    app.state.db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        codex_thread_id="vivo",
        session_started_at=agora - 1_000,
    )

    with TestClient(app) as client:
        body = client.get("/api/agents/tara/painel").json()

    contexto = body["contexto"]
    assert contexto["model"] == "gpt-5.6-luna"
    assert contexto["tokens"]["total"] == 161_907
    assert contexto["pct"] == 62.7
    assert contexto["updated_at"] == agora - 30
    assert contexto["stale"] is False


def _cenario_esforco_codex(tmp_path: Path, monkeypatch, agora: int, *, no_run: str) -> None:
    """Um run vivo só, com o esforço que o Codex de fato gravou nele."""
    rollout = tmp_path / "rollout-esforco.jsonl"
    _escreve_rollout(rollout, total_tokens=1_000, observed_at=agora - 10)
    db = _make_codex_state_db(
        tmp_path,
        [
            ("vivo", str(rollout), "/tmp/repo-do-dia", "run atual", "gpt-5.6-luna",
             no_run, 1_000, 0, 1, (agora - 10) * 1000, (agora - 100) * 1000),
        ],
    )
    monkeypatch.setenv("CODEX_STATE_DB", str(db))
    monkeypatch.setattr(
        agents_router.codex_reader, "TELECODEX_CONTEXTS", tmp_path / "sem-telecodex.json"
    )


def test_agent_painel_codex_mostra_o_esforco_do_run_e_o_pedido_ao_lado(
    tmp_path: Path, monkeypatch
) -> None:
    """Metade (a): a troca que não pegou fica visível.

    O painel gravou `low` em `agent_state`, mas o run em execução foi criado com
    `high`. Servir o `low` esconde exatamente o caso em que a escolha do Rica não
    chegou ao motor — o número na tela tem de ser o do run, com o pedido ao lado.
    """
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    agora = int(time.time())
    _cenario_esforco_codex(tmp_path, monkeypatch, agora, no_run="high")
    app.state.db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        codex_thread_id="vivo",
        codex_reasoning_effort="low",
        session_started_at=agora - 100,
    )

    with TestClient(app) as client:
        effort = client.get("/api/agents/tara/painel").json()["effort"]

    assert effort["value"] == "high"
    assert effort["requested"] == "low"
    assert effort["source"] == "codex.threads.reasoning_effort"
    assert effort["session_may_diverge"] is False


def test_agent_painel_codex_esforco_que_bate_nao_vira_divergencia(
    tmp_path: Path, monkeypatch
) -> None:
    """Metade (b): quem está alinhado não passa a mostrar ressalva nenhuma.

    Mesmo caminho de leitura do teste acima, com o run usando o que foi pedido —
    `requested` e `value` iguais é o sinal de que não há nada a dizer.
    """
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    agora = int(time.time())
    _cenario_esforco_codex(tmp_path, monkeypatch, agora, no_run="max")
    app.state.db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        codex_thread_id="vivo",
        codex_reasoning_effort="max",
        session_started_at=agora - 100,
    )

    with TestClient(app) as client:
        effort = client.get("/api/agents/tara/painel").json()["effort"]

    assert effort["value"] == "max"
    assert effort["requested"] == "max"
    assert effort["session_may_diverge"] is False


def test_agent_painel_codex_sem_thread_legivel_cai_no_pedido(
    tmp_path: Path, monkeypatch
) -> None:
    """Fonte viva ausente não pode piorar o que já se mostrava.

    Sem thread para ler, o painel volta ao valor pedido e volta a avisar que a
    sessão pode divergir — nunca fica em branco.
    """
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    monkeypatch.setenv("CODEX_STATE_DB", str(tmp_path / "state-que-nao-existe.sqlite"))
    app.state.db._update_agent_codex_state(
        "tara", executor_kind="codex", codex_reasoning_effort="high"
    )

    with TestClient(app) as client:
        effort = client.get("/api/agents/tara/painel").json()["effort"]

    assert effort["value"] == "high"
    assert effort["requested"] is None
    assert effort["source"] == "agent_state.codex_reasoning_effort"
    assert effort["session_may_diverge"] is True


def test_agent_painel_codex_marca_contexto_de_run_anterior_como_velho(
    tmp_path: Path, monkeypatch
) -> None:
    """Sem id do run vivo, o painel ainda cai na thread por cwd — mas não mente.

    Medida anterior ao início da sessão é de outro run: velha por definição, mesmo
    que o relógio ainda não tenha passado do limite de idade. E o número CONTINUA
    entregue — quem esconde dado deixa o Rica sem saber se é zero ou falta de leitura.
    """
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    agora = int(time.time())
    _cenario_dois_runs(tmp_path, monkeypatch, agora)
    app.state.db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        session_started_at=agora - 1_000,
    )

    with TestClient(app) as client:
        body = client.get("/api/agents/tara/painel").json()

    contexto = body["contexto"]
    assert contexto["stale"] is True
    assert contexto["pct"] == 85.5
    assert contexto["updated_at"] == agora - 2_200


def test_agent_painel_codex_contexto_declara_a_fonte_real(tmp_path: Path, monkeypatch) -> None:
    """`source` carimbava `agent_state.token_usage_json` mesmo lendo o rollout.

    O `token_usage_json` gravado por `codex.turn.completed` é recusado pelo filtro
    de origem, e o número sai do JSONL — dizer o contrário mandou a investigação
    deste defeito pro arquivo errado.
    """
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    agora = int(time.time())
    _cenario_dois_runs(tmp_path, monkeypatch, agora)
    app.state.db._update_agent_codex_state(
        "tara",
        executor_kind="codex",
        codex_thread_id="vivo",
        token_usage_json=json.dumps({"source": "codex.turn.completed", "usage": {"input_tokens": 156_763_087}}),
    )

    with TestClient(app) as client:
        body = client.get("/api/agents/tara/painel").json()

    assert body["contexto"]["source"] == str(tmp_path / "rollout-vivo.jsonl")


def test_agent_painel_contexto_fallback_para_sessao_antiga(tmp_path: Path, monkeypatch) -> None:
    """Sessão mais nova sem cc-status (curta/headless): painel mostra o último
    contexto conhecido da sessão anterior, marcado stale — não esvazia."""
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    suffix = int(time.time())
    old_session = f"ds135-fallback-old-{suffix}"
    new_session = f"ds135-fallback-new-{suffix}"
    _insert_session_event(app.state.db, old_session)
    _insert_session_event(app.state.db, new_session)
    old_path = Path(f"/tmp/cc-status-{old_session}.json")
    old_path.write_text(
        json.dumps(
            {
                "updated_at": int(time.time()) - 3600,
                "model": {"id": "claude-opus-4-8", "display_name": "Opus 4.8"},
                "context_window": {
                    "context_window_size": 200_000,
                    "used_percentage": 42,
                    "current_usage": {
                        "input_tokens": 80_000,
                        "output_tokens": 4_000,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 0,
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    Path(f"/tmp/cc-status-{new_session}.json").unlink(missing_ok=True)

    try:
        with TestClient(app) as client:
            response = client.get("/api/agents/daniel/painel")

        assert response.status_code == 200
        body = response.json()
        contexto = body["contexto"]
        assert contexto["available"] is True
        assert contexto["stale"] is True
        assert contexto["pct"] == 42
        assert contexto["tokens"]["total"] == 84_000
        assert contexto["source"] == f"/tmp/cc-status-{old_session}.json"
        assert body["model"] == {
            "value": "opus",
            "allowed": ["fable", "opus", "sonnet", "haiku"],
            "source": "agent.model_default",
            "session_may_diverge": True,
            "runtime_switch": True,
        }
        # quotas herda o mesmo arquivo antigo: status "stale" (badge no front)
        assert body["quotas"]["status"] == "stale"
    finally:
        old_path.unlink(missing_ok=True)


def test_agent_painel_contexto_indisponivel_sem_arquivo_em_nenhuma_sessao(
    tmp_path: Path, monkeypatch
) -> None:
    """Nenhuma sessão com cc-status: comportamento antigo — available=False."""
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    session_id = f"ds135-nofile-{int(time.time())}"
    _insert_session_event(app.state.db, session_id)
    Path(f"/tmp/cc-status-{session_id}.json").unlink(missing_ok=True)

    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    contexto = response.json()["contexto"]
    assert contexto["available"] is False
    assert contexto["stale"] is False


def test_agent_painel_quotas_kimi_mapeia_usages(tmp_path: Path, monkeypatch) -> None:
    """Hiro (família kimi): quotas vêm do /coding/v1/usages — janela de 300min
    vira 5h e o `usage` top-level vira 7d, mesmo shape do CC."""
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    app.state.settings = SimpleNamespace(kimi_api_key="sk-kimi-teste")
    _insert_session_event(app.state.db, "ds135-kimi-quota", agent_slug="hiro")
    reset_5h = "2026-07-24T18:50:40.377739Z"
    reset_7d = "2026-07-26T03:50:40.377739Z"

    async def fake_usages(api_key: str) -> dict:
        assert api_key == "sk-kimi-teste"
        return {
            "usage": {"limit": "100", "used": "90", "remaining": "10", "resetTime": reset_7d},
            "limits": [
                {
                    "window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
                    "detail": {"limit": "100", "used": "20", "remaining": "80", "resetTime": reset_5h},
                }
            ],
        }

    monkeypatch.setattr(agents_router, "_get_kimi_usages", fake_usages)
    with TestClient(app) as client:
        response = client.get("/api/agents/hiro/painel")

    assert response.status_code == 200
    quotas = response.json()["quotas"]
    assert quotas["status"] == "available"
    assert quotas["source"] == "https://api.kimi.com/coding/v1/usages"
    assert quotas["five_hour"]["used_percentage"] == 20.0
    assert quotas["five_hour"]["resets_at"] == int(
        datetime(2026, 7, 24, 18, 50, 40, tzinfo=timezone.utc).timestamp()
    )
    assert quotas["seven_day"]["used_percentage"] == 90.0
    assert quotas["seven_day"]["resets_at"] == int(
        datetime(2026, 7, 26, 3, 50, 40, tzinfo=timezone.utc).timestamp()
    )


def test_agent_painel_quotas_kimi_falha_no_fetch_cai_pro_cc_status(
    tmp_path: Path, monkeypatch
) -> None:
    """Fetch do usages quebrado: cai no caminho antigo (cc-status -> missing)."""
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    app.state.settings = SimpleNamespace(kimi_api_key="sk-kimi-teste")
    _insert_session_event(app.state.db, "ds135-kimi-down", agent_slug="hiro")
    Path("/tmp/cc-status-ds135-kimi-down.json").unlink(missing_ok=True)

    async def fake_usages_down(api_key: str) -> None:
        return None

    monkeypatch.setattr(agents_router, "_get_kimi_usages", fake_usages_down)
    with TestClient(app) as client:
        response = client.get("/api/agents/hiro/painel")

    assert response.status_code == 200
    assert response.json()["quotas"]["status"] == "missing"


def test_agent_painel_contexto_arquivo_velho_marca_stale(tmp_path: Path, monkeypatch) -> None:
    """Sessão atual com cc-status velho (> 5min, agente dormindo): stale=True."""
    _write_settings(tmp_path, monkeypatch, {})
    app = _build_app(tmp_path)
    session_id = f"ds135-oldfile-{int(time.time())}"
    _insert_session_event(app.state.db, session_id, agent_slug="hiro")
    cc_path = Path(f"/tmp/cc-status-{session_id}.json")
    cc_path.write_text(
        json.dumps(
            {
                "updated_at": int(time.time()) - 600,
                "model": {"id": "k3", "display_name": "k3"},
                "context_window": {
                    "context_window_size": 1_048_576,
                    "used_percentage": 5,
                    "current_usage": {
                        "input_tokens": 50_000,
                        "output_tokens": 0,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 0,
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    try:
        with TestClient(app) as client:
            response = client.get("/api/agents/hiro/painel")

        assert response.status_code == 200
        contexto = response.json()["contexto"]
        assert contexto["available"] is True
        assert contexto["stale"] is True
        assert contexto["context_window"] == 1_048_576
    finally:
        cc_path.unlink(missing_ok=True)


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


def test_agent_painel_patch_effort_claude_runtime_preserva_settings(
    tmp_path: Path, monkeypatch
) -> None:
    settings = {
        "effortLevel": "medium",
        "theme": "dark",
        "nested": {"keep": True},
    }
    _write_settings(tmp_path, monkeypatch, settings)
    app = _build_app(tmp_path)
    session_id = f"effort-runtime-{int(time.time())}"
    _insert_session_event(app.state.db, session_id)
    status_path = Path(f"/tmp/cc-status-{session_id}.json")
    status_path.write_text(
        json.dumps(
            {
                "updated_at": int(time.time()),
                "effort": {"level": "xhigh"},
            }
        ),
        encoding="utf-8",
    )

    try:
        with patch(
            "routers.agents.tmux_driver.send_message",
            return_value=tmux_driver.DELIVERED,
        ) as send, patch(
            "routers.agents.tmux_driver.press_enter", return_value=True
        ):
            with TestClient(app) as client:
                response = client.patch(
                    "/api/agents/daniel/effort", json={"effort": "xhigh"}
                )

        assert response.status_code == 200
        body = response.json()
        assert body == {
            "slug": "daniel",
            "effort": "xhigh",
            "source": str(status_path),
            "session_may_diverge": False,
            "written": True,
            "tmux_delivered": True,
            "confirmed": True,
            "runtime_switch": True,
        }
        send.assert_called_once_with("daniel", "/effort xhigh")
        persisted = json.loads(
            (tmp_path / ".claude" / "settings.json").read_text(encoding="utf-8")
        )
        assert persisted == settings
    finally:
        status_path.unlink(missing_ok=True)


def test_agent_painel_patch_effort_auto_eh_aceito_no_runtime(
    tmp_path: Path, monkeypatch
) -> None:
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)
    before = agents_router._CCStatus(
        "effort-auto-session", None, {"updated_at": 1, "effort": {"level": "high"}}
    )
    after = agents_router._CCStatus(
        "effort-auto-session",
        Path("/tmp/cc-status-effort-auto-session.json"),
        {"updated_at": 2, "effort": {"level": "xhigh"}},
    )

    with patch(
        "routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED
    ) as send, patch(
        "routers.agents.tmux_driver.press_enter", return_value=True
    ), patch("routers.agents._load_cc_status", side_effect=[before, after]), patch(
        "routers.agents.asyncio.sleep", new_callable=AsyncMock
    ):
        with TestClient(app) as client:
            response = client.patch(
                "/api/agents/daniel/effort", json={"effort": "auto"}
            )

    assert response.status_code == 200
    assert response.json()["effort"] == "auto"
    assert response.json()["confirmed"] is True
    send.assert_called_once_with("daniel", "/effort auto")


def test_agent_painel_patch_effort_invalido(tmp_path: Path, monkeypatch) -> None:
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/daniel/effort", json={"effort": "ultra-high"})

    assert response.status_code == 422


def test_agent_painel_nao_le_auto_como_nivel_da_statusline(
    tmp_path: Path, monkeypatch
) -> None:
    """`auto` é argumento de `/effort`, não nível reportado.

    A doc do statusline documenta `effort.level` como low/medium/high/xhigh/max
    e trata `auto` como *reset to the model default* — a palavra nunca chega no
    JSON (o `_poll_claude_effort` já dizia isso). Validar a leitura pela lista do
    seletor, que oferece `auto`, faria o painel servir como nível em vigor uma
    palavra que nenhum motor reporta.
    """
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)
    session_id = f"effort-auto-lido-{int(time.time())}"
    _insert_session_event(app.state.db, session_id)
    status_path = Path(f"/tmp/cc-status-{session_id}.json")
    status_path.write_text(
        json.dumps({"updated_at": int(time.time()), "effort": {"level": "auto"}}),
        encoding="utf-8",
    )

    try:
        with TestClient(app) as client:
            body = client.get("/api/agents/daniel/painel").json()
    finally:
        status_path.unlink(missing_ok=True)

    assert body["effort"]["value"] == "medium"
    assert body["effort"]["source"] == str(tmp_path / ".claude" / "settings.json")


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
    assert body["model"] is None
    assert body["effort"]["value"] == "xhigh"
    assert body["effort"]["allowed"] == ["low", "medium", "high", "xhigh", "max"]
    assert body["codex_native"] is True


def test_agent_painel_codex_effort_permite_max(tmp_path: Path, monkeypatch) -> None:
    """Codex 0.146+ — `max` é o teto do gpt-5.6-luna (catálogo `codex debug
    models`), igual ao `_AGENT_PAINEL_ALLOWED_EFFORTS`. Espelha o caso Kimi."""
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/tara/effort", json={"effort": "max"})
        painel = client.get("/api/agents/tara/painel")

    assert response.status_code == 200
    assert response.json()["effort"] == "max"
    assert painel.status_code == 200
    body = painel.json()
    assert body["effort"]["value"] == "max"
    assert "max" in body["effort"]["allowed"]


def test_agent_painel_codex_effort_rejeita_fora_da_lista(tmp_path: Path, monkeypatch) -> None:
    """Valor fora da escada codex cai no 422 do SCHEMA (Pydantic, que já
    aceitava max), nunca chega à allowlist do router."""
    _write_settings(tmp_path, monkeypatch, {"effortLevel": "medium"})
    app = _build_app(tmp_path)

    with TestClient(app) as client:
        response = client.patch("/api/agents/tara/effort", json={"effort": "ultra"})

    assert response.status_code == 422
    # detail é a lista de erros do Pydantic, não o código custom do router —
    # com a allowlist == enum, a guarda codex_effort_not_allowed ficou inalcançável.
    assert "codex_effort_not_allowed" not in str(response.json())


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
