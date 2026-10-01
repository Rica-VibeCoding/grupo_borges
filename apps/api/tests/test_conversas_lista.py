"""F2 de `docs/conversas/PLANO.md` — `GET /api/agents/{slug}/conversas`.

As fixtures em `tests/fixtures/conversas/` são JSONL de verdade, das sondas da
F1 (Omarchy, CC 2.1.284), encurtados: sem anexos, sem assinatura de thinking,
caminhos trocados pelos da VPS. As variantes de título saem da mesma conversa,
tirando ou trocando a linha do metadado.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from orchestrator.jsonl_watcher import encoded_cwd
from routers import agents as agents_router
from routers import conversas as conversas_router
from services import conversas as conversas_service

FIXTURES = Path(__file__).parent / "fixtures" / "conversas"

PAVAN = {
    "slug": "pavan",
    "name": "José Pavan",
    "role": "orquestrador",
    "emoji": "JP",
    "tmux_session": "pavan",
    "workspace_path": "/home/clawd/repos/ze_claude/pavan",
    "cli_default": "claude_code",
    "model_default": "opus",
    "capabilities": [],
    "can_review": [],
}
DANIEL = {**PAVAN, "slug": "daniel", "name": "Daniel Singh", "tmux_session": "daniel",
          "workspace_path": "/home/clawd/repos/ze_claude/daniel"}
CODEX = {**PAVAN, "slug": "hiro", "name": "Hiro", "tmux_session": "hiro",
         "workspace_path": "/home/clawd/repos/hiro", "cli_default": "codex"}

ID_CUSTOM = "11111111-1111-4111-8111-111111111111"
ID_NOME = "22222222-2222-4222-8222-222222222222"
ID_PROMPT = "33333333-3333-4333-8333-333333333333"
ID_PRIMEIRA = "44444444-4444-4444-8444-444444444444"
ID_CLEAR = "55555555-5555-4555-8555-555555555555"
ID_TRUNCADA = "66666666-6666-4666-8666-666666666666"

_DIA = 24 * 3600


def _instalar(pasta: Path, fixture: str, session_id: str, *, idade_s: float) -> Path:
    destino = pasta / f"{session_id}.jsonl"
    shutil.copyfile(FIXTURES / fixture, destino)
    quando = time.time() - idade_s
    os.utime(destino, (quando, quando))
    return destino


@pytest.fixture
def bancada(tmp_path: Path, monkeypatch):
    """App com Pavan e Daniel, a pasta do Pavan com as seis fixtures (todas de 1 dia)."""
    projects = tmp_path / "projects"
    pasta = projects / encoded_cwd(PAVAN["workspace_path"])
    pasta.mkdir(parents=True)
    for fixture, sid in (
        ("titulo-custom.jsonl", ID_CUSTOM),
        ("titulo-nome-do-agente.jsonl", ID_NOME),
        ("titulo-prompt.jsonl", ID_PROMPT),
        ("titulo-primeira.jsonl", ID_PRIMEIRA),
        ("limpa-pelo-clear.jsonl", ID_CLEAR),
        ("truncada.jsonl", ID_TRUNCADA),
    ):
        _instalar(pasta, fixture, sid, idade_s=_DIA)

    agentes = [PAVAN, DANIEL, CODEX]
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents(agentes)
    atuais: dict[str, str | None] = {"pavan": None, "daniel": None}
    db.latest_jsonl_session_id = AsyncMock(side_effect=lambda slug: atuais.get(slug))
    vivas: set[str] = {"pavan", "daniel"}
    monkeypatch.setattr(
        conversas_router.tmux_driver, "list_session_names", AsyncMock(side_effect=lambda: vivas)
    )
    #: `sessão → (--resume, largada)` dos Claudes vivos; vazio = ninguém retomado.
    processos: dict[str, tuple[str, float]] = {}
    monkeypatch.setattr(
        conversas_router.tmux_driver, "conversas_dos_processos",
        AsyncMock(side_effect=lambda: dict(processos)),
    )

    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": agentes}
    app.state.settings = SimpleNamespace(claude_projects_dir=str(projects))
    app.include_router(agents_router.router, prefix="/api/agents")
    app.include_router(conversas_router.router, prefix="/api/agents")
    return SimpleNamespace(
        app=app, db=db, pasta=pasta, atuais=atuais, vivas=vivas, agentes=agentes,
        processos=processos,
    )


def _get(bancada, slug: str = "pavan", **params) -> dict:
    with TestClient(bancada.app) as client:
        resposta = client.get(f"/api/agents/{slug}/conversas", params=params)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def _por_id(corpo: dict) -> dict[str, dict]:
    return {c["id"]: c for c in corpo["conversas"]}


def _meta(bancada, session_id: str, **campos) -> None:
    colunas = ["slug", "session_id", *campos]
    with sqlite3.connect(bancada.db.db_path) as conn:
        conn.execute(
            f"INSERT INTO conversa_meta ({', '.join(colunas)}) "
            f"VALUES ({', '.join('?' for _ in colunas)})",
            ("pavan", session_id, *campos.values()),
        )


def test_titulo_cai_pela_ordem_do_contrato(bancada) -> None:
    itens = _por_id(_get(bancada, curtas=1))

    assert (itens[ID_CUSTOM]["titulo"], itens[ID_CUSTOM]["titulo_origem"]) == (
        "sonda-titulo", "custom",
    )
    # custom-title "José Pavan" é o nome do agente: vale por ausente.
    assert (itens[ID_NOME]["titulo"], itens[ID_NOME]["titulo_origem"]) == (
        "Palavra-senha da sonda", "ai",
    )
    assert (itens[ID_PROMPT]["titulo"], itens[ID_PROMPT]["titulo_origem"]) == (
        "Qual é a senha nova desta largada? Responda só a senha.", "prompt",
    )
    assert itens[ID_PRIMEIRA]["titulo_origem"] == "primeira"
    assert itens[ID_PRIMEIRA]["titulo"].startswith("Responda só: ok. E qual é a palavra-senha")
    # Só comando local (`/clear`): nada aproveitável, mas nunca vazio.
    assert itens[ID_CLEAR]["titulo"] == "Conversa 55555555"
    assert all(c["titulo"] for c in itens.values())


def test_titulo_estacionado_vence_tudo_e_nota_vem_junto(bancada) -> None:
    _meta(bancada, ID_CUSTOM, titulo="Feed enxuto", nota="parou no teste; falta o build")
    item = _por_id(_get(bancada))[ID_CUSTOM]
    assert (item["titulo"], item["titulo_origem"]) == ("Feed enxuto", "estacionada")
    assert item["nota"] == "parou no teste; falta o build"


@pytest.mark.parametrize("nome", ["Pavan", "José Pavan", "jose pavan", "PAVAN"])
def test_variantes_do_nome_do_agente_contam_como_ausente(nome: str) -> None:
    nomes = conversas_service.nomes_do_agente(PAVAN)
    resumo = conversas_service._Resumo(custom=nome, ai="Ajuste do feed")
    assert conversas_service._titulo(ID_CUSTOM, resumo, None, nomes) == ("Ajuste do feed", "ai")


def test_arquivo_truncado_e_linha_quebrada_nao_derrubam_a_lista(bancada) -> None:
    corpo = _get(bancada, curtas=1)
    itens = _por_id(corpo)
    assert len(itens) == 6
    truncada = itens[ID_TRUNCADA]
    assert (truncada["titulo"], truncada["titulo_origem"]) == ("titulo-2", "custom")
    # "Responda só: ok". O system-reminder do /rename não é turno.
    assert truncada["turnos"] == 1


def test_curtas_escondidas_por_padrao_e_contadas(bancada) -> None:
    padrao = _get(bancada)
    ids = {c["id"] for c in padrao["conversas"]}
    assert ID_CLEAR not in ids and ID_TRUNCADA not in ids
    assert padrao["escondidas_curtas"] == 2
    assert _por_id(_get(bancada, curtas=1))[ID_CUSTOM]["turnos"] == 3

    com_curtas = _get(bancada, curtas=1)
    assert {ID_CLEAR, ID_TRUNCADA} <= {c["id"] for c in com_curtas["conversas"]}
    assert com_curtas["escondidas_curtas"] == 0


def test_curta_que_e_a_atual_ou_tem_estrela_nao_some(bancada) -> None:
    bancada.atuais["pavan"] = ID_CLEAR
    _meta(bancada, ID_TRUNCADA, estrela=1)
    corpo = _get(bancada)
    ids = {c["id"] for c in corpo["conversas"]}
    assert {ID_CLEAR, ID_TRUNCADA} <= ids
    assert corpo["escondidas_curtas"] == 0


def test_janela_de_30_dias_mais_as_estrelas(bancada) -> None:
    velha = "77777777-7777-4777-8777-777777777777"
    velha_com_estrela = "88888888-8888-4888-8888-888888888888"
    _instalar(bancada.pasta, "titulo-custom.jsonl", velha, idade_s=31 * _DIA)
    _instalar(bancada.pasta, "titulo-custom.jsonl", velha_com_estrela, idade_s=300 * _DIA)
    _meta(bancada, velha_com_estrela, estrela=1)

    itens = _por_id(_get(bancada))
    assert velha not in itens
    assert itens[velha_com_estrela]["estrela"] is True

    so_estrela = _get(bancada, filtro="estrela")
    assert [c["id"] for c in so_estrela["conversas"]] == [velha_com_estrela]


def test_ordem_da_mais_recente_para_a_mais_antiga(bancada) -> None:
    _instalar(bancada.pasta, "titulo-prompt.jsonl", ID_PROMPT, idade_s=3600)
    _instalar(bancada.pasta, "titulo-custom.jsonl", ID_CUSTOM, idade_s=5 * _DIA)
    datas = [c["atualizada_em"] for c in _get(bancada)["conversas"]]
    assert datas == sorted(datas, reverse=True)
    assert _get(bancada)["conversas"][0]["id"] == ID_PROMPT


def test_sem_arquivo_mexido_pendencia_zero_e_filtro_pendencia_vem_vazio(bancada) -> None:
    # F7: as sondas não mexeram em arquivo de repositório (o caso com git está
    # em `test_conversas_briefing`).
    assert all(c["pendencia"] == 0 for c in _get(bancada)["conversas"])
    assert _get(bancada, filtro="pendencia")["conversas"] == []


def test_busca_no_titulo_e_na_nota_sem_acento(bancada) -> None:
    _meta(bancada, ID_PROMPT, nota="Faltou a migração do banco")
    assert [c["id"] for c in _get(bancada, q="palavra senha")["conversas"]] == []
    # ai-title de uma, primeira mensagem da outra.
    assert {c["id"] for c in _get(bancada, q="PALAVRA-SENHA")["conversas"]} == {
        ID_NOME, ID_PRIMEIRA,
    }
    assert [c["id"] for c in _get(bancada, q="migracao")["conversas"]] == [ID_PROMPT]


def test_atual_e_bloqueada(bancada) -> None:
    # Escrita há 30 s e não é a atual desta linha → aberta em outro lugar.
    _instalar(bancada.pasta, "titulo-custom.jsonl", ID_CUSTOM, idade_s=30)
    # Escrita há 30 s, mas é a atual desta linha → livre.
    _instalar(bancada.pasta, "titulo-prompt.jsonl", ID_PROMPT, idade_s=30)
    bancada.atuais["pavan"] = ID_PROMPT
    # Atual de outra linha viva → 🔒, por mais velha que seja a escrita.
    bancada.atuais["daniel"] = ID_NOME

    itens = _por_id(_get(bancada))
    assert itens[ID_CUSTOM]["bloqueada"] is True and itens[ID_CUSTOM]["atual"] is False
    assert itens[ID_PROMPT]["bloqueada"] is False and itens[ID_PROMPT]["atual"] is True
    assert itens[ID_NOME]["bloqueada"] is True
    assert itens[ID_PRIMEIRA]["bloqueada"] is False

    # A outra linha caiu: a conversa dela deixa de travar.
    bancada.vivas.discard("daniel")
    assert _por_id(_get(bancada))[ID_NOME]["bloqueada"] is False


def test_inventario_do_tmux_que_falha_trava_a_mais(bancada, monkeypatch) -> None:
    bancada.atuais["daniel"] = ID_NOME
    monkeypatch.setattr(
        conversas_router.tmux_driver,
        "list_session_names",
        AsyncMock(side_effect=RuntimeError("tmux sumiu")),
    )
    assert _por_id(_get(bancada))[ID_NOME]["bloqueada"] is True


def test_motor_que_nao_e_cc_devolve_suportado_false(bancada) -> None:
    corpo = _get(bancada, slug="hiro")
    assert corpo == {"suportado": False, "conversas": [], "escondidas_curtas": 0}


def test_pasta_dividida_entre_agentes_nao_lista_para_nenhum(bancada) -> None:
    gemeo = {**DANIEL, "slug": "gemeo", "tmux_session": "gemeo",
             "workspace_path": PAVAN["workspace_path"]}
    bancada.agentes.append(gemeo)
    bancada.db._sync_agents(bancada.agentes)
    for slug in ("pavan", "gemeo"):
        corpo = _get(bancada, slug=slug, curtas=1)
        assert corpo["suportado"] is True and corpo["conversas"] == []


def test_agente_sem_pasta_devolve_lista_vazia(bancada) -> None:
    corpo = _get(bancada, slug="daniel")
    assert corpo == {"suportado": True, "conversas": [], "escondidas_curtas": 0}


def test_slug_desconhecido_404(bancada) -> None:
    with TestClient(bancada.app) as client:
        assert client.get("/api/agents/ninguem/conversas").status_code == 404


def test_parametros_invalidos_422(bancada) -> None:
    with TestClient(bancada.app) as client:
        assert client.get("/api/agents/pavan/conversas?filtro=lixo").status_code == 422
        assert client.get("/api/agents/pavan/conversas?curtas=2").status_code == 422


def test_cache_le_so_o_que_cresceu(bancada, monkeypatch) -> None:
    caminho = bancada.pasta / f"{ID_TRUNCADA}.jsonl"
    assert _por_id(_get(bancada, curtas=1))[ID_TRUNCADA]["turnos"] == 1

    lidas: list[bytes] = []
    original = conversas_service._absorver
    monkeypatch.setattr(
        conversas_service, "_absorver", lambda r, linha: (lidas.append(linha), original(r, linha))
    )
    # Sem mudança no arquivo: nada é relido.
    _get(bancada, curtas=1)
    assert lidas == []

    # A última linha estava pela metade; o CC termina de escrevê-la e acrescenta
    # um turno novo. Só o trecho novo passa pelo parser.
    turno = (
        b'{"parentUuid":null,"isSidechain":false,"type":"user","message":'
        b'{"role":"user","content":"E agora, segue o plano?"},"uuid":"u-1"}\n'
    )
    with caminho.open("ab") as arquivo:
        arquivo.write(b'\n' + turno)
    item = _por_id(_get(bancada, curtas=1))[ID_TRUNCADA]
    assert item["turnos"] == 2
    assert len(lidas) == 2  # a linha completada + o turno novo
    assert item["bytes"] == caminho.stat().st_size
