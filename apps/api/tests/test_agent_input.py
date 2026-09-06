"""DS-2 / SubB — testes do endpoint `POST /api/agents/{slug}/input`."""
from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import agents as agents_router
from services import tmux_driver

_RECUSADO = tmux_driver.DeliveryResult(outcome="refused", reason="sessao_ausente")
_INCERTO = tmux_driver.DeliveryResult(
    outcome="uncertain", reason="envio_nao_confirmado"
)
#: Guardada no import porque `_scope_do_turno_fora` troca o nome no módulo.


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
    "cli_default": "claude_code",
    "model_default": "gpt-5.6-sol[1m]",
    "model_family": "codex-proxy",
    "capabilities": [],
    "can_review": [],
}


HIRO = {
    "slug": "hiro",
    "name": "Hiro Nakamura",
    "role": "dev",
    "emoji": "HN",
    "tmux_session": "hiro",
    "workspace_path": "/tmp/hiro",
    "cli_default": "claude_code",
    "model_default": "k3",
    "model_family": "kimi",
    "capabilities": [],
    "can_review": [],
}


def _build_app(
    tmp_path: Path,
    *,
    extra_agents: list[dict] | None = None,
) -> FastAPI:
    agents = [DANIEL, TARA, HIRO, *(extra_agents or [])]
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents(agents)
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": agents}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


def test_input_validates_max_length(tmp_path: Path) -> None:
    """`text` > 65536 chars → 422 (Pydantic, antes da impl real)."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/input",
            json={"text": "x" * 65537, "idempotency_key": "k1"},
        )
        assert response.status_code == 422


def test_input_aceita_um_log_colado(tmp_path: Path) -> None:
    """O tamanho que o limite antigo recusava calado tem que passar.

    8192 era o valor do stub e barrava colar um log; o teto real do caminho é o
    `MAX_ARG_STRLEN` do kernel, 128 KiB. Este teste é a régua do que o Rica faz
    de verdade — colar um trecho grande — e falha se alguém reduzir o limite sem
    medir o caminho de entrega de novo.
    """
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "x" * 20000, "idempotency_key": "k-log"},
            )
        assert response.status_code != 422


def test_input_rejects_empty_text(tmp_path: Path) -> None:
    """`text` vazio (min_length=1) → 422 já no stub."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/input",
            json={"text": "", "idempotency_key": "k1"},
        )
        assert response.status_code == 422


def test_input_requires_idempotency_key(tmp_path: Path) -> None:
    """Falta `idempotency_key` → 422 (Pydantic obriga o campo)."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/input",
            json={"text": "oi"},
        )
        assert response.status_code == 422


def test_input_stt_preserves_voice_origin_without_exposing_marker_in_draft(
    tmp_path: Path,
) -> None:
    app = _build_app(tmp_path)
    with patch.object(
        app.state.db,
        "create_message_origin",
        new=AsyncMock(return_value="origin-stt"),
    ) as create_origin, patch(
        "routers.agents.tmux_driver.send_message",
        return_value=tmux_driver.DELIVERED,
    ) as send_message:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={
                    "text": "texto revisado",
                    "idempotency_key": "stt-revisado",
                    "origin": "stt",
                },
            )

    assert response.status_code == 200, response.text
    send_message.assert_awaited_once_with("daniel", "🎙 texto revisado")
    create_origin.assert_awaited_once_with(
        agent_slug="daniel",
        executor_kind="tmux",
        expected_text="🎙 texto revisado",
        meta={"kind": "stt", "raw_text": "🎙 texto revisado"},
    )


def test_input_returns_additive_event_boundary_before_tmux_send(tmp_path: Path) -> None:
    """A fronteira é lida antes da operação que pode gerar o eco do envio."""
    app = _build_app(tmp_path)
    order: list[str] = []

    async def max_event_id() -> int:
        order.append("boundary")
        return 37

    async def send_message(_session: str, _text: str) -> tmux_driver.DeliveryResult:
        order.append("send")
        return tmux_driver.DELIVERED

    app.state.db.max_event_id = max_event_id
    with patch(
        "routers.agents.tmux_driver.send_message",
        new=AsyncMock(side_effect=send_message),
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi Daniel", "idempotency_key": "boundary-claude"},
            )

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "tmux_delivered": True,
        "sent_at": body["sent_at"],
        "event_boundary_id": 37,
    }
    assert isinstance(body["sent_at"], int)
    assert order == ["boundary", "send"]


@pytest.mark.parametrize(
    ("resultado", "desfecho", "motivo", "seguro_reenviar"),
    [
        (_RECUSADO, "refused", "sessao_ausente", True),
        (_INCERTO, "uncertain", "envio_nao_confirmado", False),
    ],
)
def test_input_returns_structured_409_when_delivery_fails(
    tmp_path: Path,
    resultado: tmux_driver.DeliveryResult,
    desfecho: str,
    motivo: str,
    seguro_reenviar: bool,
) -> None:
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message", return_value=resultado):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi", "idempotency_key": "k1"},
            )
            assert response.status_code == 409
            assert response.json()["detail"] == {
                "code": "agent_pane_unavailable",
                "delivery_outcome": desfecho,
                "reason": motivo,
                "safe_to_resend": seguro_reenviar,
            }


def test_input_returns_tmux_delivered_true(tmp_path: Path) -> None:
    """Caminho feliz: send_message=True → 200 + `tmux_delivered: True` + `sent_at` int."""
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi", "idempotency_key": "k1"},
            )
            assert response.status_code == 200
            body = response.json()
            assert body["tmux_delivered"] is True
            assert isinstance(body["sent_at"], int)


def test_input_clear_arma_rename_apos_clear_em_background(tmp_path: Path) -> None:
    """`/clear` literal arma `_rename_apos_clear` sem esperar a sessão nova nascer.

    Pedido do Rica (14/08): o `/clear` cria sessão nova no CC e o `/rename` de
    antes fica órfão — quer que a sessão reapareça já com o nome do agente,
    sozinho, sem campo pra digitar.
    """
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED
    ) as send_message, patch(
        "routers.agents._rename_apos_clear", new=AsyncMock()
    ) as rename_apos_clear:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "/clear", "idempotency_key": "k-clear"},
            )

    assert response.status_code == 200
    send_message.assert_called_once_with("daniel", "/clear")
    rename_apos_clear.assert_called_once_with(app.state.db, "daniel", "daniel", "Daniel Singh", None)


def test_input_clear_com_nome_arma_rename_customizado_em_background(tmp_path: Path) -> None:
    """`/clear <nome>` reaplica o nome pedido na sessão nova, não o do agente."""
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED
    ) as send_message, patch(
        "routers.agents._rename_apos_clear", new=AsyncMock()
    ) as rename_apos_clear:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "/clear revisão do deploy", "idempotency_key": "k-clear-nome"},
            )

    assert response.status_code == 200
    send_message.assert_called_once_with("daniel", "/clear revisão do deploy")
    rename_apos_clear.assert_called_once_with(
        app.state.db,
        "daniel",
        "daniel",
        "revisão do deploy",
        None,
    )


def test_list_agent_commands_varre_project_user_e_plugin(tmp_path: Path, monkeypatch) -> None:
    """O composer recebe os comandos efetivos do workspace, usuário e plugins."""
    workspace = tmp_path / "workspace"
    project_commands = workspace / ".claude" / "commands"
    user_claude = tmp_path / "claude-user"
    user_commands = user_claude / "commands"
    plugin_commands = user_claude / "plugins" / "meu-plugin" / "commands"
    for commands_dir in (project_commands, user_commands, plugin_commands):
        commands_dir.mkdir(parents=True)

    (project_commands / "deploy.md").write_text(
        "---\ndescription: Sobe a produção\n---\n# Deploy\n",
        encoding="utf-8",
    )
    (user_commands / "revisar.md").write_text(
        "---\ndescription: Revisa o diff atual\n---\n# Revisar\n",
        encoding="utf-8",
    )
    (plugin_commands / "release.md").write_text(
        "---\ndescription: |\n  Prepara uma release\n---\n# Release\n",
        encoding="utf-8",
    )
    # A varredura de plugin só entra pelo que está em `installed_plugins.json`
    # (mesmo filtro do `list_agent_mcp`) — sem esta entrada o `/release` não
    # aparece, porque não existe plugin "instalado" nenhum no fixture.
    plugins_dir = user_claude / "plugins"
    plugins_dir.mkdir(parents=True, exist_ok=True)
    (plugins_dir / "installed_plugins.json").write_text(
        json.dumps(
            {
                "version": 2,
                "plugins": {
                    "meu-plugin@local": [
                        {"scope": "user", "installPath": str(plugin_commands.parent)}
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(agents_router, "_CLAUDE_HOME", user_claude)
    app = _build_app(
        tmp_path,
        extra_agents=[{**DANIEL, "slug": "comandos", "workspace_path": str(workspace)}],
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/comandos/commands")

    assert response.status_code == 200
    comandos = {(item["comando"], item["origem"]): item for item in response.json()}
    assert comandos[("/clear", "native")]["descricao"]
    assert comandos[("/deploy", "project")]["descricao"] == "Sobe a produção"
    assert comandos[("/revisar", "user")]["descricao"] == "Revisa o diff atual"
    assert comandos[("/release", "plugin")]["descricao"] == "Prepara uma release"


def test_list_agent_commands_ignora_plugin_nao_instalado_e_desabilitado(
    tmp_path: Path, monkeypatch
) -> None:
    """Clone de marketplace e plugin desligado não viram comando na bolha.

    `_CONFIRMED` pela auditoria de 15/08: varrer `~/.claude/plugins/**` cru
    listava clone de catálogo nunca instalado e duplicava plugin cacheado em
    vários escopos — o filtro passa a exigir presença em
    `installed_plugins.json` e `enabledPlugins` != false.
    """
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    user_claude = tmp_path / "claude-user"
    instalado_commands = user_claude / "plugins" / "cache" / "instalado" / "commands"
    orfao_commands = user_claude / "plugins" / "marketplaces" / "catalogo" / "orfao" / "commands"
    desligado_commands = user_claude / "plugins" / "cache" / "desligado" / "commands"
    for commands_dir in (instalado_commands, orfao_commands, desligado_commands):
        commands_dir.mkdir(parents=True)
        (commands_dir / "cmd.md").write_text(
            "---\ndescription: teste\n---\n# Cmd\n", encoding="utf-8"
        )

    (user_claude / "plugins" / "installed_plugins.json").write_text(
        json.dumps(
            {
                "plugins": {
                    "instalado@local": [
                        {"scope": "user", "installPath": str(instalado_commands.parent)}
                    ],
                    "desligado@local": [
                        {"scope": "user", "installPath": str(desligado_commands.parent)}
                    ],
                }
            }
        ),
        encoding="utf-8",
    )
    (user_claude / "settings.json").write_text(
        json.dumps({"enabledPlugins": {"desligado@local": False}}), encoding="utf-8"
    )
    monkeypatch.setattr(agents_router, "_CLAUDE_HOME", user_claude)
    app = _build_app(
        tmp_path,
        extra_agents=[{**DANIEL, "slug": "comandos", "workspace_path": str(workspace)}],
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/comandos/commands")

    assert response.status_code == 200
    comandos_plugin = [item for item in response.json() if item["origem"] == "plugin"]
    assert len(comandos_plugin) == 1
    assert comandos_plugin[0]["comando"] == "/cmd"


def test_input_texto_comum_nao_arma_rename_apos_clear(tmp_path: Path) -> None:
    """Só o `/clear` literal dispara o rename automático — texto comum não."""
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED
    ), patch("routers.agents._rename_apos_clear", new=AsyncMock()) as rename_apos_clear:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi Daniel", "idempotency_key": "k-oi"},
            )

    assert response.status_code == 200
    rename_apos_clear.assert_not_called()


def test_rename_apos_clear_manda_rename_quando_sessao_nova_aparece(monkeypatch) -> None:
    """Espera o `sessionId` mudar e só então manda `/rename <nome do agente>`."""
    monkeypatch.setattr(agents_router, "_CLEAR_RENAME_POLL_S", 0.01)
    monkeypatch.setattr(agents_router, "_CLEAR_RENAME_TIMEOUT_S", 1.0)
    db = SimpleNamespace(
        latest_jsonl_session_id=AsyncMock(side_effect=["antigo", "antigo", "novo-id"])
    )
    with patch(
        "routers.agents.tmux_driver.send_message", new=AsyncMock(return_value=tmux_driver.DELIVERED)
    ) as send_message:
        asyncio.run(
            agents_router._rename_apos_clear(db, "daniel", "daniel", "Daniel Singh", "antigo")
        )

    send_message.assert_called_once_with("daniel", "/rename Daniel Singh")


def test_rename_apos_clear_desiste_apos_timeout_sem_sessao_nova(monkeypatch) -> None:
    """Sessão nunca troca de id (pane travado, `/clear` não pegou) → desiste sem mandar nada."""
    monkeypatch.setattr(agents_router, "_CLEAR_RENAME_POLL_S", 0.01)
    monkeypatch.setattr(agents_router, "_CLEAR_RENAME_TIMEOUT_S", 0.05)
    db = SimpleNamespace(latest_jsonl_session_id=AsyncMock(return_value="antigo"))
    with patch("routers.agents.tmux_driver.send_message", new=AsyncMock()) as send_message:
        asyncio.run(
            agents_router._rename_apos_clear(db, "daniel", "daniel", "Daniel Singh", "antigo")
        )

    send_message.assert_not_called()


@pytest.mark.parametrize(
    ("driver_result", "expected_delivered"),
    [
        ({"tmux_delivered": True, "degrau": 2, "acao": "input_vazio"}, True),
        ({"tmux_delivered": True, "degrau": 3, "acao": "enter"}, True),
        ({"tmux_delivered": True, "degrau": 4, "acao": "recolar_enter"}, True),
        (
            {
                "tmux_delivered": False,
                "degrau": 5,
                "acao": "submissao_nao_confirmada",
            },
            False,
        ),
    ],
)
def test_destrava_reports_the_step_that_resolved_or_failed(
    tmp_path: Path,
    driver_result: dict[str, bool | int | str],
    expected_delivered: bool,
) -> None:
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.recover_input",
        new=AsyncMock(return_value=driver_result),
    ) as recover:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/destrava")

    assert response.status_code == 200
    body = response.json()
    assert body["tmux_delivered"] is expected_delivered
    assert body["degrau"] == driver_result["degrau"]
    assert body["acao"] == driver_result["acao"]
    assert isinstance(body["sent_at"], int)
    recover.assert_awaited_once_with("daniel")


@pytest.mark.parametrize(
    ("driver_result", "expect_cleared"),
    [
        ({"tmux_delivered": True, "degrau": 2, "acao": "input_vazio"}, True),
        ({"tmux_delivered": True, "degrau": 3, "acao": "enter"}, True),
        ({"tmux_delivered": True, "degrau": 4, "acao": "recolar_enter"}, True),
        (
            {"tmux_delivered": False, "degrau": 5, "acao": "submissao_nao_confirmada"},
            False,
        ),
    ],
)
def test_destrava_limpa_lifecycle_preso_so_quando_confirmado(
    tmp_path: Path,
    driver_result: dict[str, bool | int | str],
    expect_cleared: bool,
) -> None:
    """Achado de 16/08 (Maestro): o pane pode ser recuperado com o card ainda
    preso em `trabalhando` — `lifecycle_status` não expira sozinho. Falha do
    degrau preserva o estado: não afirmar que o agente está livre quando o
    pane não confirmou."""
    app = _build_app(tmp_path)
    app.state.db._update_agent_lifecycle(
        "daniel", status="trabalhando", detail="mensagem do usuário", event="jsonl:user"
    )
    with patch(
        "routers.agents.tmux_driver.recover_input",
        new=AsyncMock(return_value=driver_result),
    ):
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/destrava")

    assert response.status_code == 200
    with app.state.db._connect() as conn:
        row = conn.execute(
            "SELECT lifecycle_status FROM agent_state WHERE slug = 'daniel'"
        ).fetchone()
    assert (row["lifecycle_status"] is None) is expect_cleared


def test_relaunch_requires_explicit_confirmation(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        missing = client.post("/api/agents/daniel/relaunch", json={})
        denied = client.post("/api/agents/daniel/relaunch", json={"confirm": False})
        coerced = client.post("/api/agents/daniel/relaunch", json={"confirm": "true"})

    assert missing.status_code == 422
    assert denied.status_code == 400
    assert denied.json()["detail"] == "confirmacao_explicita_obrigatoria"
    assert coerced.status_code == 422


def test_relaunch_fails_without_resumable_conversation(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    app.state.db.latest_jsonl_session_id = AsyncMock(return_value=None)

    with TestClient(app) as client:
        response = client.post("/api/agents/daniel/relaunch", json={"confirm": True})

    assert response.status_code == 409
    assert response.json()["detail"] == "resume_session_not_found"


def test_relaunch_rejects_non_native_model_backend_before_lookup(tmp_path: Path) -> None:
    """`model_family` fora de {None, anthropic, kimi} — família hipotética sem
    mecanismo de preservação de env conhecido — segue barrada antes do lookup."""
    gpt_agent = {**HIRO, "slug": "gpt-agent", "model_family": "gpt"}
    app = _build_app(tmp_path, extra_agents=[gpt_agent])
    app.state.db.latest_jsonl_session_id = AsyncMock()
    with patch(
        "routers.agents.tmux_driver.restart_claude_with_resume",
        new=AsyncMock(),
    ) as restart:
        with TestClient(app) as client:
            response = client.post("/api/agents/gpt-agent/relaunch", json={"confirm": True})

    assert response.status_code == 409
    assert response.json()["detail"] == "relaunch_requer_backend_anthropic_nativo"
    app.state.db.latest_jsonl_session_id.assert_not_awaited()
    restart.assert_not_awaited()


def test_relaunch_allows_kimi_model_family_past_the_guard(tmp_path: Path) -> None:
    """Hiro (`model_family: kimi`) não é mais barrado aqui — as 7 `ANTHROPIC_*`
    agora viajam como env preservada (ver `_PRESERVED_ENV_VARS` no tmux_driver),
    então o guard só precisa proteger famílias sem esse mecanismo."""
    app = _build_app(tmp_path)
    app.state.db.latest_jsonl_session_id = AsyncMock(return_value="019e9077-ccf1-7ee1-b8bb-25202f1ed3e2")
    with patch(
        "routers.agents.tmux_driver.restart_claude_with_resume",
        new=AsyncMock(return_value={"confirmed": True, "attempted": True}),
    ) as restart:
        with TestClient(app) as client:
            response = client.post("/api/agents/hiro/relaunch", json={"confirm": True})

    assert response.status_code == 200
    assert response.json()["tmux_delivered"] is True
    app.state.db.latest_jsonl_session_id.assert_awaited_once_with("hiro")
    restart.assert_awaited_once()


def test_input_reports_busy_tmux_session_honestly(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.send_message",
        new=AsyncMock(side_effect=agents_router.tmux_driver.TmuxSessionBusyError("busy")),
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi", "idempotency_key": "busy-1"},
            )

    assert response.status_code == 409
    assert response.json()["detail"] == "agent_tmux_busy"


def test_relaunch_resumes_exact_session_and_reports_confirmation(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"
    app.state.db.latest_jsonl_session_id = AsyncMock(return_value=session_id)
    with patch(
        "routers.agents.tmux_driver.restart_claude_with_resume",
        new=AsyncMock(return_value={"attempted": True, "confirmed": True}),
    ) as restart:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/relaunch", json={"confirm": True})

    assert response.status_code == 200
    body = response.json()
    assert body["tmux_delivered"] is True
    assert body["attempted"] is True
    assert body["session_id"] == session_id
    restart.assert_awaited_once_with(
        "daniel",
        "/tmp/daniel",
        "opus",
        session_id,
    )


def test_relaunch_de_cliente_velho_com_resume_false_preserva_a_conversa(
    tmp_path: Path,
) -> None:
    """O Restart saiu em 10/08 e com ele o campo `resume`.

    Uma aba antiga do cockpit ainda manda `resume: false` no corpo. O campo
    deixou de existir no modelo, então o valor é ignorado e a requisição cai no
    caminho ÚNICO — que retoma a conversa. Falha para o lado seguro: preserva em
    vez de apagar, e nunca chama `delete_jsonl_events`.
    """
    app = _build_app(tmp_path)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"
    app.state.db.latest_jsonl_session_id = AsyncMock(return_value=session_id)
    app.state.db.delete_jsonl_events = AsyncMock()
    with patch(
        "routers.agents.tmux_driver.restart_claude_with_resume",
        new=AsyncMock(return_value={"attempted": True, "confirmed": True}),
    ) as restart:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/relaunch",
                json={"confirm": True, "resume": False},
            )

    assert response.status_code == 200
    assert response.json()["session_id"] == session_id
    restart.assert_awaited_once_with("daniel", "/tmp/daniel", "opus", session_id)
    app.state.db.delete_jsonl_events.assert_not_awaited()


def test_relaunch_resume_defaults_to_true_when_field_omitted(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    session_id = "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2"
    app.state.db.latest_jsonl_session_id = AsyncMock(return_value=session_id)
    with patch(
        "routers.agents.tmux_driver.restart_claude_with_resume",
        new=AsyncMock(return_value={"attempted": True, "confirmed": True}),
    ) as restart:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/relaunch", json={"confirm": True})

    assert response.status_code == 200
    restart.assert_awaited_once()


# ---------------------------------------------------------------------------
# Desligar / Ligar — o ciclo de vida do agente (10/08)
# ---------------------------------------------------------------------------


def _inventario(sessoes: set[str], claudes: set[str]):
    """Patch do inventário do tmux, que o `/painel` lê pra reportar `vida`."""
    return patch(
        "routers.agents.tmux_driver.list_session_inventory",
        new=AsyncMock(return_value=tmux_driver.TmuxSessionInventory(sessoes, claudes)),
    )


def test_desligar_para_os_scopes_antes_de_encerrar_a_sessao(tmp_path: Path) -> None:
    """O valor do botão está no que ele mata ALÉM da sessão tmux.

    Em 09/08 dois `bun server.ts` do plugin telegram, órfãos de sessão já morta,
    queimavam 34% de CPU cada há nove horas. O endpoint precisa reportar os
    cgroups parados — é a prova de que o `kill-session` não foi tudo o que houve.
    """
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.shutdown_agent",
        new=AsyncMock(
            return_value={
                "attempted": True,
                "sessao_encerrada": True,
                "scopes_parados": ["run-rd7d84c.scope"],
                "scopes_resistiram": [],
            }
        ),
    ) as desliga:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/desligar", json={"confirm": True})

    assert response.status_code == 200
    body = response.json()
    assert body["tmux_delivered"] is True
    assert body["sessao_encerrada"] is True
    assert body["scopes_parados"] == ["run-rd7d84c.scope"]
    desliga.assert_awaited_once_with("daniel")


def test_desligar_de_agente_ja_fora_do_ar_e_sucesso_idempotente(tmp_path: Path) -> None:
    """`attempted:false` (não havia sessão) NÃO é falha: o estado final é o pedido."""
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.shutdown_agent",
        new=AsyncMock(
            return_value={
                "attempted": False,
                "sessao_encerrada": False,
                "scopes_parados": [],
            }
        ),
    ):
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/desligar", json={"confirm": True})

    assert response.status_code == 200
    body = response.json()
    assert body["attempted"] is False
    assert body["tmux_delivered"] is True


def test_desligar_avisa_quando_um_scope_resiste(tmp_path: Path) -> None:
    """Cgroup que sobreviveu ao `stop` é CPU queimando que ninguém vê."""
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.shutdown_agent",
        new=AsyncMock(
            return_value={
                "attempted": True,
                "sessao_encerrada": True,
                "scopes_parados": [],
                "scopes_resistiram": ["run-rteimoso.scope"],
            }
        ),
    ):
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/desligar", json={"confirm": True})

    assert response.status_code == 200
    assert response.json()["tmux_delivered"] is False


def test_desligar_exige_confirmacao_explicita(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.shutdown_agent", new=AsyncMock()) as desliga:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/desligar", json={"confirm": False})

    assert response.status_code == 400
    assert response.json()["detail"] == "confirmacao_explicita_obrigatoria"
    desliga.assert_not_awaited()


def test_ligar_nao_exige_confirmacao(tmp_path: Path) -> None:
    """Ligar não destrói nada — é toque simples, como o destrava."""
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.boot_agent",
        new=AsyncMock(return_value={"attempted": True, "confirmed": True}),
    ) as liga:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/ligar")

    assert response.status_code == 200
    assert response.json()["tmux_delivered"] is True
    liga.assert_awaited_once_with("daniel")


def test_ligar_com_boot_ja_em_curso_devolve_409(tmp_path: Path) -> None:
    """A unit nomeada do `systemd-run` é o trava-duplo: o segundo clique não
    pode subir uma segunda sessão do mesmo agente."""
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.boot_agent",
        new=AsyncMock(side_effect=agents_router.tmux_driver.TmuxSessionBusyError("já em curso")),
    ):
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/ligar")

    assert response.status_code == 409
    assert "ligar_em_curso" in response.json()["detail"]


def test_painel_separa_desligado_de_casca_morta(tmp_path: Path) -> None:
    """O `AgentStatus` só tem `offline` pra tudo; o painel precisa das DUAS
    metades porque elas divergem — e é a segunda (sessão viva, CLI morto) que
    fazia Destravar e Resume falharem em silêncio."""
    app = _build_app(tmp_path)

    with _inventario(set(), set()):
        with TestClient(app) as client:
            desligado = client.get("/api/agents/daniel/painel").json()

    with _inventario({"daniel"}, set()):
        with TestClient(app) as client:
            casca_morta = client.get("/api/agents/daniel/painel").json()

    with _inventario({"daniel"}, {"daniel"}):
        with TestClient(app) as client:
            vivo = client.get("/api/agents/daniel/painel").json()

    assert desligado["vida"] == {"sessao": False, "processo": False}
    assert casca_morta["vida"] == {"sessao": True, "processo": False}
    assert vivo["vida"] == {"sessao": True, "processo": True}


def test_painel_com_tmux_ilegivel_preserva_os_controles(tmp_path: Path) -> None:
    """Falha de observação não pode virar "desligado".

    Um `list-panes` que não rodou trocaria os botões do Rica pelo Ligar no meio
    de um agente vivo — o mesmo motivo pelo qual o `list_session_inventory`
    propaga erro em vez de devolver conjunto vazio.
    """
    app = _build_app(tmp_path)
    with patch(
        "routers.agents.tmux_driver.list_session_inventory",
        new=AsyncMock(side_effect=agents_router.libtmux_exc.LibTmuxException("sem server")),
    ):
        with TestClient(app) as client:
            response = client.get("/api/agents/daniel/painel")

    assert response.status_code == 200
    assert response.json()["vida"] == {"sessao": True, "processo": True}

