# ruff: noqa: F811 — `bancada`, `palco` e `linha` vêm importadas e entram como parâmetro
"""F13 de `docs/conversas/PLANO.md` — o chat acompanha a troca de conversa.

Stream: `conversa-trocada` + replay da conversa nova na mesma conexão, e o
stream aberto depois da troca já abre nela. Feed: o turno do pedido de
estacionar sai com `origem: "cockpit"`. Conversas: a Nova e o Retomar
publicam a troca, com título, nota e o briefing que o gancho levou.
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from test_conversas_lista import ID_CUSTOM, ID_PROMPT, bancada  # noqa: F401
from test_conversas_nova import ID_NOVA, palco  # noqa: F401
from test_conversas_retomar import linha  # noqa: F401
from test_messages_stream import _build_app, _drive_stream, _insert_jsonl, agents_router

from routers import conversas as conversas_router
from services import operacao_conversa as operacao
from services import tmux_driver

PEDIDO = operacao.mensagem_de_estacionar("http://127.0.0.1:8000", "daniel", "retomar")


@pytest.fixture(autouse=True)
def _sem_tmux_de_verdade(monkeypatch):
    operacao.esquecer("daniel")
    monkeypatch.setattr(tmux_driver, "conversas_dos_processos", AsyncMock(return_value={}))
    yield
    operacao.esquecer("daniel")


def _troca(session_id: str, de: str | None = "sess-a", motivo: str = "retomar") -> dict:
    return {
        "session_id": session_id, "de": de, "de_titulo": "Saindo", "motivo": motivo,
        "titulo": "Voz em tempo real", "nota": "parou no STT", "briefing": None, "at": 1,
    }


def _no_meio(acao):
    """`asyncio.sleep` do stream que roda `acao` uma vez, no primeiro ciclo ao vivo."""
    real_sleep = asyncio.sleep
    feito = False

    async def dormir(_: float) -> None:
        nonlocal feito
        if not feito:
            feito = True
            acao()
        await real_sleep(0)

    return dormir


async def _ate_uuid(app, uuid: str) -> list[tuple[str, dict]]:
    """Dirige o stream até a `message` de `uuid`, passando por quantos replays houver."""
    disconnected = False

    async def is_disconnected() -> bool:
        return disconnected

    request = SimpleNamespace(app=app, is_disconnected=is_disconnected)
    response = await agents_router.stream_agent_messages(
        "daniel", request, session_id=None, limit=200, since_id=0, recentes=True,
    )
    events: list[tuple[str, dict]] = []

    async def coletar() -> None:
        async for chunk in response.body_iterator:
            nome, dado = str(chunk["event"]), json.loads(chunk["data"])
            events.append((nome, dado))
            if nome == "message" and dado.get("uuid") == uuid:
                return

    try:
        await asyncio.wait_for(coletar(), timeout=3.0)
    finally:
        disconnected = True
        await response.body_iterator.aclose()
    return events


# ---------- o stream troca de conversa ----------


@pytest.mark.asyncio
async def test_troca_emite_conversa_trocada_e_o_historico_da_nova(tmp_path) -> None:
    app, db = _build_app(tmp_path)
    # A retomada é mais VELHA: os ids dela ficam abaixo do cursor da que sai.
    _insert_jsonl(db, session_id="sess-b", uuid="b-1", text="conversa antiga")
    _insert_jsonl(db, session_id="sess-b", uuid="b-2", kind="assistant", text="resposta antiga")
    _insert_jsonl(db, session_id="sess-a", uuid="a-1", text="a que sai")

    with patch(
        "routers.agents.asyncio.sleep",
        new=_no_meio(lambda: operacao.publicar_troca("daniel", _troca("sess-b"))),
    ):
        _, _, events = await _drive_stream(app, recentes=True, stop_after="conversa-trocada")
    nomes = [n for n, _ in events]
    assert nomes.index("replay-end") < nomes.index("conversa-trocada")
    assert events[-1] == ("conversa-trocada", _troca("sess-b"))


@pytest.mark.asyncio
async def test_troca_serve_o_replay_e_o_ao_vivo_da_conversa_nova(tmp_path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-b", uuid="b-1", text="conversa antiga")
    _insert_jsonl(db, session_id="sess-a", uuid="a-1", text="a que sai")
    passo = 0
    real_sleep = asyncio.sleep

    async def dormir(_: float) -> None:
        nonlocal passo
        passo += 1
        if passo == 1:
            operacao.publicar_troca("daniel", _troca("sess-b"))
        elif passo == 2:
            _insert_jsonl(db, session_id="sess-b", uuid="b-ao-vivo", text="primeira depois")
            _insert_jsonl(db, session_id="sess-a", uuid="a-tarde", text="ok atrasado da que sai")
        elif passo == 3:
            _insert_jsonl(db, session_id="sess-b", uuid="b-fim", text="fim")
        await real_sleep(0)

    with patch("routers.agents.asyncio.sleep", new=dormir):
        events = await _ate_uuid(app, "b-fim")

    depois = events[[n for n, _ in events].index("conversa-trocada"):]
    assert [n for n, _ in depois[:2]] == ["conversa-trocada", "replay-start"]
    assert depois[1][1] == {"session_id": "sess-b", "total": 1}
    uuids = [p["uuid"] for n, p in depois if n == "message"]
    assert uuids == ["b-1", "b-ao-vivo", "b-fim"]  # nada da que saiu


@pytest.mark.asyncio
async def test_depois_da_troca_o_scan_nao_puxa_o_chat_de_volta(tmp_path) -> None:
    """O banco segue na que saiu até a nova ganhar mensagem: isso não é sessão nova."""
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="a-1", text="a que sai")

    with patch("routers.agents._MESSAGES_STREAM_SESSION_SCAN_S", 0), patch(
        "routers.agents._MESSAGES_STREAM_HEARTBEAT_S", 0.05
    ), patch(
        "routers.agents.asyncio.sleep",
        new=_no_meio(lambda: operacao.publicar_troca("daniel", _troca("sess-b"))),
    ):
        _, _, events = await _drive_stream(app, stop_after="heartbeat")

    nomes = [n for n, _ in events]
    assert "conversa-trocada" in nomes
    assert "session-reset" not in nomes


@pytest.mark.asyncio
async def test_clear_por_dentro_ainda_re_ancora(tmp_path) -> None:
    """O scan segue valendo quando o BANCO muda (um `/clear` digitado no pane)."""
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="a-1", text="antes")
    with patch("routers.agents._MESSAGES_STREAM_SESSION_SCAN_S", 0), patch(
        "routers.agents.asyncio.sleep",
        new=_no_meio(lambda: _insert_jsonl(db, session_id="sess-c", uuid="c-1", text="x")),
    ):
        _, _, events = await _drive_stream(app, stop_after="session-reset")
    assert events[-1][1]["session_id"] == "sess-c"


@pytest.mark.asyncio
async def test_stream_aberto_depois_da_troca_abre_na_nova_sem_mensagem(tmp_path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="a-1", text="a que sai")
    operacao.registrar_troca("daniel", "sess-a", "sess-nova")

    _, _, events = await _drive_stream(app, stop_after="replay-end")

    assert events[0] == ("replay-start", {"session_id": "sess-nova", "total": 0})
    assert not [n for n, _ in events if n == "message"]


@pytest.mark.asyncio
async def test_quem_pediu_uma_sessao_nao_troca(tmp_path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="a-1", text="histórico")
    with patch("routers.agents._MESSAGES_STREAM_HEARTBEAT_S", 0.05), patch(
        "routers.agents.asyncio.sleep",
        new=_no_meio(lambda: operacao.publicar_troca("daniel", _troca("sess-b"))),
    ):
        _, _, events = await _drive_stream(app, session_id="sess-a", stop_after="heartbeat")
    assert "conversa-trocada" not in [n for n, _ in events]


# ---------- origem: "cockpit" ----------


def _turno_de_estacionar(db, sessao: str = "sess-a") -> None:
    _insert_jsonl(db, session_id=sessao, uuid="fala", text="vamos ver o STT")
    _insert_jsonl(db, session_id=sessao, uuid="resp", kind="assistant", text="feito")
    _insert_jsonl(db, session_id=sessao, uuid="pedido", text=PEDIDO)
    _insert_jsonl(
        db, session_id=sessao, uuid="curl", kind="assistant",
        content=[{"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "curl"}}],
    )
    _insert_jsonl(
        db, session_id=sessao, uuid="resultado",
        content=[{"type": "tool_result", "tool_use_id": "t1", "content": "{}"}],
    )
    _insert_jsonl(db, session_id=sessao, uuid="ok", kind="assistant", text="ok")


@pytest.mark.asyncio
async def test_turno_do_pedido_de_estacionar_sai_com_origem_cockpit(tmp_path) -> None:
    app, db = _build_app(tmp_path)
    _turno_de_estacionar(db)
    _insert_jsonl(db, session_id="sess-a", uuid="volta", text="voltei, segue")
    _insert_jsonl(db, session_id="sess-a", uuid="segue", kind="assistant", text="seguindo")

    _, _, events = await _drive_stream(app, stop_after="replay-end")

    origem = {p["uuid"]: p.get("origem") for n, p in events if n == "message"}
    assert origem == {
        "fala": None, "resp": None,
        "pedido": "cockpit", "curl": "cockpit", "resultado": "cockpit", "ok": "cockpit",
        "volta": None, "segue": None,
    }


@pytest.mark.asyncio
async def test_escape_do_cockpit_no_turno_e_do_cockpit(tmp_path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="pedido", text=PEDIDO)
    _insert_jsonl(db, session_id="sess-a", uuid="corte", text="[Request interrupted by user]")
    _insert_jsonl(db, session_id="sess-a", uuid="nova-fala", text="[cockpit] outra coisa")

    _, _, events = await _drive_stream(app, stop_after="replay-end")

    origem = {p["uuid"]: p.get("origem") for n, p in events if n == "message"}
    # Só o prefixo do pedido abre o turno: outro "[cockpit]" é fala comum.
    assert origem == {"pedido": "cockpit", "corte": "cockpit", "nova-fala": None}


@pytest.mark.asyncio
async def test_origem_cockpit_vale_ao_vivo(tmp_path) -> None:
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="fala", text="oi")
    with patch(
        "routers.agents.asyncio.sleep",
        new=_no_meio(lambda: _insert_jsonl(db, session_id="sess-a", uuid="pedido", text=PEDIDO)),
    ):
        events = await _ate_uuid(app, "pedido")
    assert events[-1][1]["origem"] == "cockpit"


# ---------- a Nova e o Retomar publicam a troca ----------


async def test_nova_publica_a_troca_antes_de_pronta(palco) -> None:
    fases: list[str | None] = []
    publicar = operacao.publicar_troca

    def espiar(slug: str, payload: dict) -> None:
        fases.append(operacao.estado(slug).fase)
        publicar(slug, payload)

    with patch.object(operacao, "publicar_troca", espiar):
        r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 200, r.text
    trocas, _ = operacao.trocas_desde("pavan", 0)
    troca, = trocas
    assert fases == ["religando"]
    assert {k: troca[k] for k in ("session_id", "de", "de_titulo", "motivo", "titulo",
                                  "nota", "briefing")} == {
        "session_id": ID_NOVA, "de": ID_CUSTOM, "de_titulo": "Feed enxuto",
        "motivo": "nova", "titulo": None, "nota": None, "briefing": None,
    }


async def test_retomar_publica_titulo_nota_e_briefing_do_gancho(linha, monkeypatch) -> None:
    # A retomada já foi estacionada antes, com título e nota.
    await linha.palco.bancada.db.estacionar_conversa(
        "pavan", ID_PROMPT, "Voz em tempo real", "parou no STT", 1
    )
    monkeypatch.setattr(
        conversas_router.briefing_retorno, "montar", lambda *a, **k: "3 commits desde então"
    )
    boot = linha.falsa.boot_agent

    async def boot_com_gancho(sessao: str, resume_session_id: str | None = None) -> dict:
        resposta = await boot(sessao, resume_session_id)
        if resume_session_id:  # o SessionStart chama o briefing na largada
            r = await linha.cliente.get(
                f"/api/agents/pavan/conversas/{resume_session_id}/briefing"
            )
            assert r.json() == {"briefing": "3 commits desde então"}
        return resposta

    monkeypatch.setattr(tmux_driver, "boot_agent", boot_com_gancho)
    r = await linha.cliente.post(f"/api/agents/pavan/conversas/{ID_PROMPT}/retomar", json={})
    assert r.status_code == 200, r.text
    troca, = operacao.trocas_desde("pavan", 0)[0]
    assert {k: troca[k] for k in ("session_id", "de", "de_titulo", "motivo", "titulo",
                                  "nota", "briefing")} == {
        "session_id": ID_PROMPT, "de": ID_CUSTOM, "de_titulo": "Feed enxuto",
        "motivo": "retomar", "titulo": "Voz em tempo real", "nota": "parou no STT",
        "briefing": "3 commits desde então",
    }
    assert not operacao.briefing_entregue("pavan", ID_PROMPT)  # gasto na troca


async def test_retomar_sem_gancho_publica_briefing_nulo(linha) -> None:
    r = await linha.cliente.post(f"/api/agents/pavan/conversas/{ID_PROMPT}/retomar", json={})
    assert r.status_code == 200, r.text
    troca, = operacao.trocas_desde("pavan", 0)[0]
    assert (troca["session_id"], troca["briefing"]) == (ID_PROMPT, None)
    assert troca["titulo"]  # cai na ordem de queda, nunca vazio


async def test_retomar_que_falha_nao_publica_troca(linha) -> None:
    linha.falsa.falha_resume = ValueError("boom")
    r = await linha.cliente.post(f"/api/agents/pavan/conversas/{ID_PROMPT}/retomar", json={})
    assert r.status_code == 502
    assert operacao.trocas_desde("pavan", 0)[0] == []


# ---------- F13b: o reset do scan não atropela a troca ----------


@pytest.mark.asyncio
async def test_clear_da_nova_no_banco_antes_da_troca_nao_vira_session_reset(tmp_path) -> None:
    """Na Nova, o envelope do `/clear` (user com uuid) chega ao banco ainda em
    `religando`. O scan via o banco mudar e soltava `session-reset` para a
    conversa nova antes do `conversa-trocada` dela."""
    app, db = _build_app(tmp_path)
    _insert_jsonl(db, session_id="sess-a", uuid="a-1", text="a que sai")
    op = operacao.comecar("daniel")
    operacao.avancar(op, "religando")
    passo = 0
    real_sleep = asyncio.sleep

    async def dormir(_: float) -> None:
        nonlocal passo
        passo += 1
        if passo == 1:
            _insert_jsonl(
                db, session_id="sess-b", uuid="b-clear",
                text="<command-name>/clear</command-name>",
            )
        elif passo == 20:  # vários scans depois: a operação termina
            operacao.publicar_troca("daniel", _troca("sess-b", motivo="nova"))
            operacao.avancar(op, "pronta")
        await real_sleep(0)

    with patch("routers.agents._MESSAGES_STREAM_SESSION_SCAN_S", 0), patch(
        "routers.agents._MESSAGES_STREAM_HEARTBEAT_S", 0.2
    ), patch("routers.agents.asyncio.sleep", new=dormir):
        _, _, events = await _drive_stream(app, stop_after="heartbeat")

    nomes = [n for n, _ in events]
    assert "conversa-trocada" in nomes
    assert "session-reset" not in nomes
