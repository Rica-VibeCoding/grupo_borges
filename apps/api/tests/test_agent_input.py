"""DS-2 / SubB — testes do endpoint `POST /api/agents/{slug}/input`."""
from __future__ import annotations

import asyncio
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
from services import codex_catalog, tmux_driver

_RECUSADO = tmux_driver.DeliveryResult(outcome="refused", reason="sessao_ausente")
#: Guardada no import porque `_scope_do_turno_fora` troca o nome no módulo.
_STOP_SCOPE_REAL = agents_router._stop_codex_turn_scope


@pytest.fixture(autouse=True)
def _catalogo_codex_fora(monkeypatch):
    """O painel lê o catálogo do binário `codex`, e este arquivo troca o
    `subprocess.Popen` do módulo — que é o mesmo objeto global que o
    `subprocess.run` do catálogo usa por dentro. Sem este corte, o teste do
    `next_fresh` morria dentro do `codex debug models`, não no que ele testa.
    """
    codex_catalog.limpar_cache()
    monkeypatch.setattr(codex_catalog, "_ler_do_cli", tuple)
    yield
    codex_catalog.limpar_cache()


@pytest.fixture(autouse=True)
def _scope_do_turno_fora(monkeypatch):
    """Nenhum teste toca o systemd da máquina.

    Sem handle de `Popen`, o `codex-stop` cai na segunda alça e roda
    `systemctl --user stop cockpit-codex-turn-tara.scope` — o nome REAL do
    scope da Tara. Rodar a suíte com um turno em voo o mataria. Quem precisa
    exercitar a alça faz o próprio `patch`, que vence esta fixture.
    """
    monkeypatch.setattr(agents_router, "_stop_codex_turn_scope", lambda slug: False)


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
    """Tara Codex retoma a thread do COCKPIT (`codex_thread_id`) e retorna já.

    Opção A (10/08): a thread a retomar é a do delegator cockpit, gravada no
    agent_state pelo evento `codex.thread.started` do wrapper — não a do
    telecodex (`find_latest_thread`), que a sessão interativa do tmux segura por
    lock (`~/.codex/thread-writer-locks/`) e recusa retomar.
    """
    app = _build_app(tmp_path, codex_for_tara=True)
    thread = SimpleNamespace(thread_id="019e9077-ccf1-7ee1-b8bb-25202f1ed3e2")
    with patch(
        "routers.agents.codex_reader.read_cockpit_thread_id", return_value=thread.thread_id
    ), \
         patch("routers.agents.codex_reader.resolve_thread", return_value=thread), \
         patch("routers.agents.subprocess.Popen") as popen, \
         patch("routers.agents.tmux_driver.send_message") as send_message:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/input",
                json={"text": "oi Tara", "idempotency_key": "k1"},
            )

    assert response.status_code == 200
    assert response.json()["tmux_delivered"] is True
    send_message.assert_not_called()
    popen.assert_called_once()
    cmd = popen.call_args.args[0]
    # Invocado via `bash <script>` — robusto a perda do bit +x em edição/linter.
    # O prefixo do `systemd-run` que carrega isso tem teste próprio
    # (`test_input_codex_nasce_em_scope_proprio_fora_do_cgroup_da_api`).
    inicio = cmd.index("bash")
    assert cmd[inicio : inicio + 4] == [
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
    thread = SimpleNamespace(thread_id="thread-voice")
    fake_stt = SimpleNamespace(returncode=0, stdout="olá Tara\n", stderr="")
    with patch("routers.agents.subprocess.run", return_value=fake_stt), \
         patch(
            "routers.agents.codex_reader.read_cockpit_thread_id", return_value=thread.thread_id
         ), \
         patch("routers.agents.codex_reader.resolve_thread", return_value=thread), \
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
         patch(
            "routers.agents.codex_reader.read_cockpit_thread_id", return_value=thread.thread_id
         ), \
         patch("routers.agents.codex_reader.resolve_thread", return_value=thread), \
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


def test_input_codex_next_fresh_armed_starts_new_thread_without_clearing_early(tmp_path: Path) -> None:
    """codex_next_fresh armado pelo painel → /input começa thread nova (sem
    --resume-thread). O flag NÃO zera no spawn (b85613d): a "nova conversa" só
    consumiu quando a thread nova nascer (`codex.thread.started`) — zerar aqui
    faria o feed devolver a thread VELHA no gap, o piscar do Rica em 10/08."""
    app = _build_app(tmp_path, codex_for_tara=True)
    app.state.db._update_agent_codex_state("tara", codex_next_fresh=1)
    # O inventário entra explícito porque o `/painel` passou a reportar `vida`
    # (10/08) e o lê do tmux. `routers.agents.subprocess` É o módulo global, e o
    # patch do `Popen` abaixo alcança o `libtmux` por tabela — sem isto o GET do
    # painel morre num `communicate()` mockado, num erro que não fala do teste.
    with patch("routers.agents.codex_reader.find_latest_thread", return_value=None) as find_thread, \
         patch(
             "routers.agents.tmux_driver.list_session_inventory",
             new=AsyncMock(return_value=tmux_driver.TmuxSessionInventory(set(), set())),
         ), \
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
            # Flag AINDA armado: a thread nova ainda não nasceu (o `codex exec`
            # está subindo). Enquanto armado, o /codex/messages devolve vazio.
            painel = client.get("/api/agents/tara/painel")

    assert painel.status_code == 200
    assert painel.json().get("codex_next_fresh") is True


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


def test_ciclo_de_vida_recusa_agente_codex(tmp_path: Path) -> None:
    """A Tara não fica de pé entre turnos — não há o que ligar nem desligar."""
    app = _build_app(tmp_path, codex_for_tara=True)
    with patch("routers.agents.tmux_driver.shutdown_agent", new=AsyncMock()) as desliga, \
         patch("routers.agents.tmux_driver.boot_agent", new=AsyncMock()) as liga:
        with TestClient(app) as client:
            desligou = client.post("/api/agents/tara/desligar", json={"confirm": True})
            ligou = client.post("/api/agents/tara/ligar")

    assert desligou.status_code == 409
    assert ligou.status_code == 409
    assert desligou.json()["detail"] == "ciclo_de_vida_somente_claude_code"
    desliga.assert_not_awaited()
    liga.assert_not_awaited()


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


class _FakeCodexProc:
    """Popen fake do turno em voo — `poll()` vivo, `wait()` limpo."""

    def __init__(self, pid: int = 7777):
        self.pid = pid
        self.waited = False

    def poll(self) -> None:
        return None

    def wait(self, timeout: int = 0) -> int:
        self.waited = True
        return 0


def test_codex_stop_mata_turno_em_voo_e_reconcilia_lifecycle(tmp_path: Path) -> None:
    """`POST /codex-stop` derruba o grupo do turno em voo e volta a ocioso.

    O turno nasce com `start_new_session=True` (grupo próprio); matar o grupo
    via `killpg` leva o `codex exec` filho junto — sem isto um kill no pai
    deixaria o run escrevendo no rollout sem dono (opção A, 10/08).
    """
    app = _build_app(tmp_path, codex_for_tara=True)
    app.state.db._update_agent_lifecycle(
        "tara", status="trabalhando", detail="turno iniciado", event="test.setup"
    )
    proc = _FakeCodexProc(pid=7777)
    agents_router._CODEX_RUN_PROCS["tara"] = proc
    with patch("routers.agents.os.killpg") as killpg, \
         patch("routers.agents.os.getpgid", return_value=7777):
        with TestClient(app) as client:
            response = client.post("/api/agents/tara/codex-stop")

    assert response.status_code == 200
    assert response.json() == {"stopped": True}
    killpg.assert_called_once_with(7777, signal.SIGTERM)
    assert proc.waited
    assert agents_router._CODEX_RUN_PROCS.get("tara") is None
    painel = asyncio.run(app.state.db.get_agent("tara"))
    assert painel["lifecycle_status"] == "ocioso"


def test_codex_stop_sem_turno_reconcilia_lifecycle_orfa(tmp_path: Path) -> None:
    """Sem turno em voo, um `trabalhando` órfão volta a `ocioso` — idempotente."""
    app = _build_app(tmp_path, codex_for_tara=True)
    app.state.db._update_agent_lifecycle(
        "tara", status="trabalhando", detail="turno sem dono", event="test.setup"
    )
    with patch("routers.agents.os.killpg") as killpg:
        with TestClient(app) as client:
            response = client.post("/api/agents/tara/codex-stop")

    assert response.status_code == 200
    assert response.json() == {"stopped": False, "reason": "no_turn_in_flight"}
    killpg.assert_not_called()
    painel = asyncio.run(app.state.db.get_agent("tara"))
    assert painel["lifecycle_status"] == "ocioso"


def test_codex_stop_limpa_status_line_de_ocupado(tmp_path: Path) -> None:
    """Parar o turno destrava o `/input` seguinte — não só o lifecycle.

    `_codex_turn_in_flight` tem duas réguas em OU. O stop consertava só o
    lifecycle e deixava o `status_line` congelado em `rodando: <comando>`, o
    último que a Tara executou antes do botão; daí todo `/input` levava 409 e o
    botão trancava o que veio destravar (Tara, 11/08).
    """
    app = _build_app(tmp_path, codex_for_tara=True)
    app.state.db._update_agent_codex_state(
        "tara", status_line='rodando: /bin/bash -lc "codex --help"'
    )
    proc = _FakeCodexProc(pid=7777)
    agents_router._CODEX_RUN_PROCS["tara"] = proc
    with patch("routers.agents.os.killpg"), \
         patch("routers.agents.os.getpgid", return_value=7777):
        with TestClient(app) as client:
            assert client.post("/api/agents/tara/codex-stop").status_code == 200
            # A régua que interessa: a próxima mensagem entra.
            with patch("routers.agents.codex_reader.find_latest_thread"), \
                 patch("routers.agents.subprocess.Popen"):
                depois = client.post(
                    "/api/agents/tara/input",
                    json={"text": "continua", "idempotency_key": "k-stop"},
                )

    assert asyncio.run(app.state.db.get_agent("tara"))["status_line"] is None
    assert depois.status_code != 409


def test_codex_stop_preserva_status_line_que_nao_e_ocupado(tmp_path: Path) -> None:
    """A última fala da Tara é vitrine do painel — o stop não pode apagá-la."""
    app = _build_app(tmp_path, codex_for_tara=True)
    app.state.db._update_agent_codex_state("tara", status_line="validei a skill")
    with patch("routers.agents.os.killpg"):
        with TestClient(app) as client:
            assert client.post("/api/agents/tara/codex-stop").status_code == 200

    painel = asyncio.run(app.state.db.get_agent("tara"))
    assert painel["status_line"] == "validei a skill"


def test_input_codex_nasce_em_scope_proprio_fora_do_cgroup_da_api(tmp_path: Path) -> None:
    """O turno nasce num scope transiente — não no cgroup do `cockpit-api`.

    `KillMode=control-group` (o default, `man systemd.kill`) mata TODO processo
    do cgroup da unit no restart, e `start_new_session=True` não protege: ele só
    chama `setsid()` (CPython, `Modules/_posixsubprocess.c`), que muda a sessão
    POSIX e não o cgroup. Três restarts em 11/08 mataram turno em voo.
    """
    app = _build_app(tmp_path, codex_for_tara=True)
    thread = SimpleNamespace(thread_id="thread-scope")
    with patch(
        "routers.agents.codex_reader.read_cockpit_thread_id", return_value=thread.thread_id
    ), \
         patch("routers.agents.codex_reader.resolve_thread", return_value=thread), \
         patch("routers.agents.subprocess.Popen") as popen, \
         patch("routers.agents.tmux_driver.send_message"):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/input",
                json={"text": "sobrevive", "idempotency_key": "k-scope"},
            )

    assert response.status_code == 200
    cmd = popen.call_args.args[0]
    assert cmd[:4] == ["systemd-run", "--user", "--scope", "--quiet"]
    # Nome determinístico: é a alça que o `codex-stop` usa quando o handle do
    # `Popen` morreu junto com o processo da API.
    assert cmd[4] == "--unit=cockpit-codex-turn-tara.scope"
    assert cmd[5:9] == [
        "bash",
        str(Path(__file__).resolve().parents[3] / "scripts" / "tara-codex"),
        "--delegator",
        "cockpit",
    ]
    # O `--` que delimita o texto continua sendo um só: o do wrapper.
    assert cmd.count("--") == 1


def test_codex_stop_alcanca_turno_que_sobreviveu_a_restart_da_api(tmp_path: Path) -> None:
    """Turno vivo sem handle em memória ainda é parado — pela unit do scope.

    Depois que o turno passou a morar em scope próprio, um restart da API deixa
    ele VIVO com o `_CODEX_RUN_PROCS` zerado. Sem a segunda alça, o botão
    "Parar turno" responderia `no_turn_in_flight` com o turno rodando.
    """
    app = _build_app(tmp_path, codex_for_tara=True)
    app.state.db._update_agent_lifecycle(
        "tara", status="trabalhando", detail="turno iniciado", event="test.setup"
    )
    agents_router._CODEX_RUN_PROCS.pop("tara", None)
    with patch("routers.agents._stop_codex_turn_scope", return_value=True) as stop_scope:
        with TestClient(app) as client:
            response = client.post("/api/agents/tara/codex-stop")

    assert response.status_code == 200
    assert response.json() == {"stopped": True}
    stop_scope.assert_called_once_with("tara")
    painel = asyncio.run(app.state.db.get_agent("tara"))
    assert painel["lifecycle_status"] == "ocioso"


def test_stop_codex_turn_scope_nao_chama_systemctl_com_scope_inativo() -> None:
    """Sem scope ativo, o stop não dispara `systemctl stop` — devolve False.

    O `is-active` é o que separa "turno vivo sem handle" de "turno que já
    terminou": sem ele o botão relataria `stopped` em cima de nada.
    """
    with patch("routers.agents.subprocess.run") as run:
        run.return_value = SimpleNamespace(returncode=3, stdout="inactive\n", stderr="")
        assert _STOP_SCOPE_REAL("tara") is False

    assert run.call_count == 1
    assert run.call_args.args[0] == [
        "systemctl",
        "--user",
        "is-active",
        "cockpit-codex-turn-tara.scope",
    ]


def test_codex_new_thread_arma_fresh_sem_telecodex(tmp_path: Path) -> None:
    """'Nova conversa' (opção A) arma `codex_next_fresh` — sem depender do daemon
    telecodex, que só controla a sessão interativa do tmux."""
    app = _build_app(tmp_path, codex_for_tara=True)
    with TestClient(app) as client:
        response = client.patch("/api/agents/tara/codex-new-thread", json={"armed": True})

    assert response.status_code == 200
    body = response.json()
    assert body["armed"] is True
    assert body["thread_started"] is False
    painel = asyncio.run(app.state.db.get_agent("tara"))
    assert painel["codex_next_fresh"]


def test_codex_new_thread_rejeita_nao_codex(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        response = client.patch("/api/agents/daniel/codex-new-thread", json={"armed": True})

    assert response.status_code == 400
    assert response.json()["detail"] == "not_a_codex_agent"


def test_codex_messages_vazias_enquanto_nova_conversa_armada(tmp_path: Path) -> None:
    """"Nova conversa" armada (`codex_next_fresh`) descarta a conversa atual na
    UI: o feed devolve vazio até a próxima thread nascer — mesmo efeito do
    /clear no CC (72e67bd/732f685). Sem o flag, o histórico da thread volta."""
    app = _build_app(tmp_path, codex_for_tara=True)
    db: GrupoBorgesDB = app.state.db
    asyncio.run(db.update_agent_codex_state("tara", codex_next_fresh=1))

    with TestClient(app) as client:
        response = client.get("/api/agents/tara/codex/messages")

    assert response.status_code == 200
    body = response.json()
    assert body["thread_id"] is None
    assert body["messages"] == []
    assert body["hidden_count"] == 0


def test_codex_messages_sem_flag_consultam_a_thread(tmp_path: Path) -> None:
    """Sem nova conversa armada, o endpoint resolve a thread do cockpit (lida do
    store) e devolve o histórico — o retorno-vazio do teste acima não pode
    vazar para o caso normal."""
    app = _build_app(tmp_path, codex_for_tara=True)
    thread = SimpleNamespace(
        thread_id="019e9077-ccf1-7ee1-b8bb-25202f1ed3e2",
        rollout_path="",
        cwd="/tmp/tara",
        title="t",
        model="gpt-5.6-terra",
        reasoning_effort=None,
        tokens_used=0,
        updated_at_ms=None,
        created_at_ms=None,
    )

    def _fake_conversation(*_a, **_k):
        return thread, []

    with patch("routers.agents.codex_reader.read_cockpit_thread_id", return_value=thread.thread_id), \
         patch("routers.agents.codex_reader.read_latest_conversation", side_effect=_fake_conversation):
        with TestClient(app) as client:
            response = client.get("/api/agents/tara/codex/messages")

    assert response.status_code == 200
    body = response.json()
    assert body["thread_id"] == thread.thread_id
    assert body["messages"] == []
