"""DS-2 / SubB — testes do endpoint `POST /api/agents/{slug}/input`."""
from __future__ import annotations

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
    "role": "codex",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "codex",
    "model_default": "codex-gpt-5-6-sol",
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
    codex_for_tara: bool = False,
    extra_agents: list[dict] | None = None,
) -> FastAPI:
    agents = [DANIEL, TARA, HIRO, *(extra_agents or [])]
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents(agents)
    if codex_for_tara:
        db._update_agent_codex_state(
            "tara",
            executor_kind="codex",
            status_line="ocioso",
        )
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": agents}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


def test_input_validates_max_length(tmp_path: Path) -> None:
    """`text` > 8192 chars → 422 (Pydantic, antes da impl real)."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/daniel/input",
            json={"text": "x" * 8193, "idempotency_key": "k1"},
        )
        assert response.status_code == 422


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


def test_input_codex_with_thread_spawns_resume_wrapper(tmp_path: Path) -> None:
    """Tara Codex retoma a thread atual e retorna imediatamente."""
    app = _build_app(tmp_path, codex_for_tara=True)
    thread = SimpleNamespace(thread_id="019e9077-ccf1-7ee1-b8bb-25202f1ed3e2")
    with patch("routers.agents.codex_reader.find_latest_thread", return_value=thread) as find_thread, \
         patch("routers.agents.subprocess.Popen") as popen, \
         patch("routers.agents.tmux_driver.send_message") as send_message:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/input",
                json={"text": "oi Tara", "idempotency_key": "k1"},
            )

    assert response.status_code == 200
    assert response.json()["tmux_delivered"] is True
    find_thread.assert_called_once_with("/tmp/tara")
    send_message.assert_not_called()
    popen.assert_called_once()
    cmd = popen.call_args.args[0]
    # Invocado via `bash <script>` — robusto a perda do bit +x em edição/linter.
    assert cmd[:4] == [
        "bash",
        str(Path(__file__).resolve().parents[3] / "scripts" / "tara-codex"),
        "--delegator",
        "cockpit",
    ]
    assert "--resume-thread" in cmd
    assert "019e9077-ccf1-7ee1-b8bb-25202f1ed3e2" in cmd
    assert cmd[-4:] == ["-C", "/tmp/tara", "--", "oi Tara"]


def test_input_codex_turn_in_flight_returns_409(tmp_path: Path) -> None:
    """Tara trabalhando não aceita outro turno concorrente."""
    app = _build_app(tmp_path, codex_for_tara=True)
    app.state.db._update_agent_lifecycle(
        "tara", status="trabalhando", detail="turno iniciado", event="test.setup"
    )
    with patch("routers.agents.codex_reader.find_latest_thread") as find_thread, \
         patch("routers.agents.subprocess.Popen") as popen:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/input",
                json={"text": "oi Tara", "idempotency_key": "k1"},
            )

    assert response.status_code == 409
    assert response.json()["detail"] == "codex_turn_in_flight"
    find_thread.assert_not_called()
    popen.assert_not_called()


def test_input_claude_still_uses_tmux_not_codex(tmp_path: Path) -> None:
    """Agente Claude Code preserva caminho tmux original."""
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED) as send_message, \
         patch("routers.agents.subprocess.Popen") as popen:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi Daniel", "idempotency_key": "k1"},
            )

    assert response.status_code == 200
    send_message.assert_called_once_with("daniel", "oi Daniel")
    popen.assert_not_called()


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


def test_input_reads_event_boundary_before_codex_spawn(tmp_path: Path) -> None:
    """O caminho Codex respeita a mesma fronteira causal do caminho tmux."""
    app = _build_app(tmp_path, codex_for_tara=True)
    order: list[str] = []

    async def max_event_id() -> int:
        order.append("boundary")
        return 91

    async def spawn(*_args: object, **_kwargs: object) -> None:
        order.append("spawn")

    app.state.db.max_event_id = max_event_id
    with patch(
        "routers.agents._spawn_codex_agent_turn",
        new=AsyncMock(side_effect=spawn),
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/input",
                json={"text": "oi Tara", "idempotency_key": "boundary-codex"},
            )

    assert response.status_code == 200
    assert response.json()["tmux_delivered"] is True
    assert response.json()["event_boundary_id"] == 91
    assert order == ["boundary", "spawn"]


def test_voice_codex_spawns_wrapper_not_tmux(tmp_path: Path) -> None:
    """Áudio para Tara Codex vira prompt transcrito via tara-codex."""
    app = _build_app(tmp_path, codex_for_tara=True)
    fake_stt = SimpleNamespace(returncode=0, stdout="olá Tara\n", stderr="")
    thread = SimpleNamespace(thread_id="thread-voice")
    with patch("routers.agents.subprocess.run", return_value=fake_stt), \
         patch("routers.agents.codex_reader.find_latest_thread", return_value=thread), \
         patch("routers.agents.subprocess.Popen") as popen, \
         patch("routers.agents.tmux_driver.send_message") as send_message:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/voice",
                files={"audio": ("voice.webm", b"fakebytes", "audio/webm")},
            )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["transcribed"] == "olá Tara"
    assert body["tmux_delivered"] is True
    send_message.assert_not_called()
    popen.assert_called_once()
    cmd = popen.call_args.args[0]
    assert "--resume-thread" in cmd
    assert "thread-voice" in cmd
    assert cmd[-4:] == ["-C", "/tmp/tara", "--", "olá Tara"]


def test_image_codex_spawns_wrapper_with_image_before_prompt(tmp_path: Path) -> None:
    """Imagem para Tara Codex passa `-i <path>` antes do separador `--`."""
    app = _build_app(tmp_path, codex_for_tara=True)
    thread = SimpleNamespace(thread_id="thread-image")
    png_1x1 = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
        b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
        b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00"
        b"\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    with patch("routers.agents._AGENT_UPLOADS_BASE", tmp_path / "uploads"), \
         patch("routers.agents.codex_reader.find_latest_thread", return_value=thread), \
         patch("routers.agents.subprocess.Popen") as popen, \
         patch("routers.agents.tmux_driver.send_message") as send_message:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/image",
                data={"caption": "descreva"},
                files={"file": ("image.png", png_1x1, "image/png")},
            )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tmux_delivered"] is True
    assert body["path"].endswith(".png")
    send_message.assert_not_called()
    popen.assert_called_once()
    cmd = popen.call_args.args[0]
    separator_index = cmd.index("--")
    image_index = cmd.index("-i")
    assert image_index < separator_index
    assert cmd[image_index + 1] == body["path"]
    assert cmd[-1] == "descreva"


def test_input_codex_next_fresh_armed_starts_new_thread_and_clears(tmp_path: Path) -> None:
    """codex_next_fresh armado pelo painel → /input começa thread nova (sem
    --resume-thread) e zera o flag depois de consumir."""
    app = _build_app(tmp_path, codex_for_tara=True)
    app.state.db._update_agent_codex_state("tara", codex_next_fresh=1)
    with patch("routers.agents.codex_reader.find_latest_thread", return_value=None) as find_thread, \
         patch("routers.agents.subprocess.Popen") as popen:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/input",
                json={"text": "começa do zero", "idempotency_key": "kf"},
            )
            assert response.status_code == 200
            # Fresh: não busca thread anterior nem passa --resume-thread.
            find_thread.assert_not_called()
            cmd = popen.call_args.args[0]
            assert "--resume-thread" not in cmd
            # Flag consumido: painel volta a reportar não-armado (esse GET pode
            # chamar find_thread — por isso o assert_not_called veio antes).
            painel = client.get("/api/agents/tara/painel")

    assert painel.status_code == 200
    assert painel.json().get("codex_next_fresh") is False


def test_input_returns_409_when_pane_offline(tmp_path: Path) -> None:
    """Quando `tmux_driver.send_message` retorna False (pane fora do CLI esperado),
    endpoint deve devolver 409 — não 200/500.
    """
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.send_message", return_value=_RECUSADO):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/input",
                json={"text": "oi", "idempotency_key": "k1"},
            )
            assert response.status_code == 409


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


def test_relaunch_with_resume_false_skips_jsonl_lookup_and_boots_fresh(
    tmp_path: Path,
) -> None:
    """`resume: false` é o boot sem `--resume` — perder o contexto é o pedido,
    então nem faz sentido consultar o JSONL antes (ele nem precisa existir)."""
    app = _build_app(tmp_path)
    app.state.db.latest_jsonl_session_id = AsyncMock()
    app.state.db.delete_jsonl_events = AsyncMock(return_value=7)
    with patch(
        "routers.agents.tmux_driver.restart_claude_fresh",
        new=AsyncMock(return_value={"attempted": True, "confirmed": True}),
    ) as restart_fresh, patch("routers.agents.publish_session_reset") as publish_reset:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/relaunch",
                json={"confirm": True, "resume": False},
            )

    assert response.status_code == 200
    body = response.json()
    assert body["tmux_delivered"] is True
    assert body["attempted"] is True
    assert body["session_id"] is None
    app.state.db.latest_jsonl_session_id.assert_not_awaited()
    app.state.db.delete_jsonl_events.assert_awaited_once_with("daniel")
    publish_reset.assert_called_once_with(
        "daniel",
        {
            "slug": "daniel",
            "at": ANY,
            "reason": "relaunch-fresh",
            "deleted": 7,
        },
    )
    restart_fresh.assert_awaited_once_with("daniel", "/tmp/daniel", "opus")


def test_relaunch_fresh_failure_keeps_jsonl_and_does_not_publish_reset(
    tmp_path: Path,
) -> None:
    app = _build_app(tmp_path)
    app.state.db.delete_jsonl_events = AsyncMock()
    with patch(
        "routers.agents.tmux_driver.restart_claude_fresh",
        new=AsyncMock(side_effect=agents_router.tmux_driver.TmuxSessionBusyError("busy")),
    ), patch("routers.agents.publish_session_reset") as publish_reset:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/relaunch",
                json={"confirm": True, "resume": False},
            )

    assert response.status_code == 409
    app.state.db.delete_jsonl_events.assert_not_awaited()
    publish_reset.assert_not_called()


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
