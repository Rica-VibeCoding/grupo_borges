"""Rewind: telas medidas do Claude Code, sem acesso à frota."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from test_agent_input import DANIEL, _build_app
from test_messages_stream import _insert_jsonl

from routers import agents as agents_router
from services import rewind, tmux_driver
from services.session_reset import session_reset_events_since

LISTA = """Rewind
Restore the code and/or conversation to the point before…
  Primeiro pedido
  f.txt +1 -1
❯ Segundo pedido
  (current)
Enter to continue · Esc to cancel"""
CONFIRMACAO = """Rewind
Restore the code and/or conversation to the point before…
│ Segundo pedido
❯ 1. Restore code and conversation
  2. Restore conversation
  3. Restore code
  4. Summarize from here
  5. Summarize up to here
  6. Never mind
Enter to continue · Esc to cancel"""
SEM_CODIGO = """Rewind
│ Segundo pedido
❯ 1. Restore conversation
  2. Summarize from here
  3. Summarize up to here
  4. Never mind
Enter to continue · Esc to cancel"""


def test_parser_lista_nao_confunde_arquivo_com_prompt():
    tela = rewind.parse_screen(LISTA)
    assert tela.kind == "pontos"
    assert tela.selected == "Segundo pedido"
    assert tela.quote is None


@pytest.mark.parametrize("tela", [CONFIRMACAO, SEM_CODIGO])
def test_parser_confirmacao_e_citacao(tela):
    parsed = rewind.parse_screen(tela)
    assert parsed.kind == "acoes"
    assert parsed.quote == "Segundo pedido"


def test_rotulo_exato_nao_escolhe_conversa_e_codigo_por_prefixo():
    assert rewind.selected_action(rewind.parse_screen(CONFIRMACAO)) == "conversa_e_codigo"
    assert rewind.selected_action(rewind.parse_screen(SEM_CODIGO)) == "conversa"
    tela = SEM_CODIGO.replace("1. Restore conversation", "1. Summarize up to here")
    assert rewind.selected_action(rewind.parse_screen(tela)) == "resumir_ate_aqui"


def test_tela_normal_nao_e_menu_mesmo_com_rewind_no_historico():
    assert (
        rewind.parse_screen("❯ /rewind\n──────────────\n❯ texto humano\n──────────────").kind
        == "fechado"
    )


def test_parser_ansi_e_numero_mutavel():
    tela = SEM_CODIGO.replace("❯ 1.", "\x1b[32m❯ 7.").replace(
        "conversation\n", "conversation\x1b[0m\n"
    )
    assert rewind.selected_action(rewind.parse_screen(tela)) == "conversa"


def _user(uid, text, parent=None, **extra):
    return {
        "uuid": uid,
        "parentUuid": parent,
        "type": "user",
        "message": {"content": text},
        "timestamp": "2026-11-01T00:00:00Z",
        **extra,
    }


def test_pontos_filtram_ruido_ramos_antigos_e_edicoes():
    registros = [
        _user("a", "Primeiro\nsegunda linha"),
        {
            "type": "assistant",
            "uuid": "edit",
            "parentUuid": "a",
            "message": {"content": [{"type": "tool_use", "name": "Edit"}]},
        },
        _user("b", "Ramo abandonado", "edit"),
        _user("c", "Ramo atual", "edit"),
        _user("meta", "metadado", "c", isMeta=True),
        _user(
            "tool",
            [{"type": "tool_result", "content": "ok"}, {"type": "text", "text": "ruido"}],
            "meta",
        ),
        _user("side", "subagente", "c", isSidechain=True),
    ]
    ps = rewind.pontos(registros)
    assert [p["id"] for p in ps] == ["a", "c"]
    assert ps[0]["texto"] == "Primeiro"
    assert ps[0]["arquivo_editado_depois"] is True
    assert ps[1]["arquivo_editado_depois"] is False
    assert [p["id"] for p in rewind.pontos(registros, {"c"})] == ["a"]


class Pane:
    pane_height = 48
    pane_current_command = "claude"

    def __init__(self, options=None, quote=None):
        self.options = list(options or rewind.ROTULOS.values())
        self.quote = quote
        self.prompts = ["Primeiro pedido", "Segundo pedido"]
        self.phase = "input"
        self.input = ""
        self.index = 2
        self.option = 0
        self.keys = []
        self.applied = None
        self.escapes = 0

    def send_keys(self, text, enter=False):
        assert enter is False
        self.input = text

    def cmd(self, command, key):
        assert command == "send-keys"
        self.keys.append(key)
        if key == "Enter":
            if self.phase == "input":
                assert self.input == "/rewind"
                self.phase = "pontos"
                self.input = ""
            elif self.phase == "pontos":
                self.phase = "acoes"
            elif self.phase == "acoes":
                self.applied = self.options[self.option]
                self.phase = "input"
                if self.applied in {
                    "Restore conversation",
                    "Restore code and conversation",
                    "Summarize from here",
                }:
                    self.input = self.prompts[self.index]
        elif key == "Up":
            self.index = max(0, self.index - 1)
        elif key == "Down":
            self.option = (self.option + 1) % len(self.options)
        elif key == "Escape":
            if self.phase == "acoes":
                self.phase = "pontos"
            elif self.phase == "pontos":
                self.phase = "input"
            elif self.input:
                self.escapes += 1
                if self.escapes == 2:
                    self.input = ""
        return SimpleNamespace(returncode=0)

    def capture_pane(self, **kwargs):
        if self.phase == "input":
            return ["──────────────", "❯ " + self.input, "──────────────"]
        if self.phase == "pontos":
            rows = self.prompts + ["(current)"]
            return ["Rewind", "Restore the code and/or conversation to the point before…"] + [
                f"{'❯' if i == self.index else ' '} {t}" for i, t in enumerate(rows)
            ]
        return ["Rewind", "│ " + (self.quote or self.prompts[self.index])] + [
            f"{'❯' if i == self.option else ' '} {i + 1}. {t}" for i, t in enumerate(self.options)
        ]


@pytest.fixture
def pane(monkeypatch):
    p = Pane()
    monkeypatch.setattr(rewind, "PRAZO_S", 0.03)
    monkeypatch.setattr(rewind, "PASSO_S", 0.001)
    monkeypatch.setattr(
        tmux_driver,
        "_capture_input_snapshot",
        lambda pane: tmux_driver._PaneInputSnapshot("armed" if pane.input else "empty", pane.input),
    )
    # Cerca: erro se um teste novo tentar descobrir servidor real.
    monkeypatch.setattr(tmux_driver, "_server_for", lambda _: pytest.fail("tmux real proibido"))
    return p


def _points():
    return [
        {"id": "a", "texto": "Primeiro pedido", "texto_completo": "Primeiro pedido"},
        {"id": "b", "texto": "Segundo pedido", "texto_completo": "Segundo pedido"},
    ]


@pytest.mark.parametrize(
    "options",
    [
        list(rewind.ROTULOS.values()),
        ["Restore conversation", "Summarize from here", "Summarize up to here", "Never mind"],
    ],
)
@pytest.mark.parametrize("acao", ["conversa", "resumir_daqui", "resumir_ate_aqui"])
def test_executa_por_rotulo_com_numeracao_variavel(pane, options, acao):
    pane.options = options
    ps = _points()
    assert rewind.executar_no_pane(pane, ps[-1], acao, ps)["menu_fechado"]
    assert pane.applied == rewind.ROTULOS[acao]


def test_acao_indisponivel_cancela_os_dois_menus(pane):
    pane.options = ["Restore conversation", "Never mind"]
    with pytest.raises(rewind.RewindError, match="acao_indisponivel") as erro:
        rewind.executar_no_pane(pane, _points()[-1], "codigo", _points())
    assert erro.value.status == 422
    assert pane.phase == "input"
    assert pane.applied is None
    assert pane.keys[-2:] == ["Escape", "Escape"]


def test_citacao_divergente_nao_confirma(pane):
    pane.quote = "Outro pedido"
    with pytest.raises(rewind.RewindError, match="citacao_divergente"):
        rewind.executar_no_pane(pane, _points()[-1], "conversa", _points())
    assert pane.applied is None
    assert pane.phase == "input"


def test_topo_sem_alvo_cancela_sem_restaurar(pane):
    ps = [
        {"id": "inexistente", "texto": "Primeiro pedido", "texto_completo": "Primeiro pedido"},
        *_points(),
    ]
    with pytest.raises(rewind.RewindError, match="ponto_nao_encontrado"):
        rewind.executar_no_pane(pane, ps[0], "conversa", ps)
    assert pane.phase == "input"
    assert pane.applied is None


def test_prompts_iguais_chegam_ao_id_correto(pane):
    pane.prompts[1] = pane.prompts[0]
    ps = _points()
    ps[1].update(texto=ps[0]["texto"], texto_completo=ps[0]["texto"])
    rewind.executar_no_pane(pane, ps[0], "conversa", ps)
    assert pane.keys.count("Up") == 2
    assert pane.index == 0


def test_input_ocupado_nao_envia_nenhuma_tecla(pane):
    pane.input = "texto humano"
    with pytest.raises(rewind.RewindError, match="campo_ocupado"):
        rewind.executar_no_pane(pane, _points()[0], "conversa", _points())
    assert pane.keys == []


def test_limpa_multilinha_sem_reabrir_menu(pane):
    pane.input = "Primeira linha\n  segunda linha"
    alvo = {"texto_completo": "Primeira linha\nsegunda linha"}
    assert rewind._limpar_restaurado(pane, alvo) == alvo["texto_completo"]
    assert pane.keys == ["Escape", "Escape"]
    assert pane.input == ""


def test_texto_diferente_nao_e_apagado(pane):
    pane.input = "humano digitou agora"
    with pytest.raises(rewind.RewindError, match="texto_restaurado_divergente"):
        rewind._limpar_restaurado(pane, {"texto_completo": "original"})
    assert pane.keys == []


def test_menu_multilinha_tem_reticencias():
    p = {"texto": "Primeira linha", "texto_completo": "Primeira linha\nsegunda"}
    assert rewind._confere_prompt("Primeira linha…", p)
    assert not rewind._confere_prompt("Primeira…", p)


@pytest.fixture
def api(tmp_path, monkeypatch, pane):
    app = _build_app(tmp_path)
    caminho = tmp_path / "session.jsonl"
    caminho.write_text(
        "\n".join(
            json.dumps(r)
            for r in [_user("a", "Primeiro pedido"), _user("b", "Segundo pedido", "a")]
        )
    )
    monkeypatch.setattr(
        agents_router, "_rewind_conversa", AsyncMock(return_value=(DANIEL, caminho))
    )
    server = SimpleNamespace(
        has_session=lambda _: True,
        sessions=SimpleNamespace(get=lambda **_: SimpleNamespace(active_pane=pane)),
    )
    monkeypatch.setattr(tmux_driver, "_server_for", lambda _: server)
    with TestClient(app) as client:
        yield client, app.state.db, pane


def test_api_lista_pontos_e_valida_acao(api):
    client, _, _ = api
    data = client.get("/api/agents/daniel/rewind/pontos").json()
    assert [p["id"] for p in data["pontos"]] == ["a", "b"]
    assert all("texto_completo" not in p for p in data["pontos"])
    assert (
        client.post(
            "/api/agents/daniel/rewind", json={"ponto_id": "a", "acao": "apagar"}
        ).status_code
        == 422
    )


def test_api_rewind_persiste_mascara_feed_e_emite_reset(api):
    client, db, p = api
    for uid in ["a", "b"]:
        _insert_jsonl(db, session_id="session", uuid=uid, text=uid)
    _, seq = session_reset_events_since("daniel", 0)
    response = client.post("/api/agents/daniel/rewind", json={"ponto_id": "b", "acao": "conversa"})
    assert response.status_code == 200, response.text
    assert response.json()["texto_restaurado"] == "Segundo pedido"
    assert response.json()["recarregar_feed"] is True
    assert p.input == ""
    assert db._rewind_hidden_uuids("daniel", "session") == {"b"}
    assert [
        e["payload"]["uuid"] for e in db._list_jsonl_message_events("daniel", "session", 0, 10)
    ] == ["a"]
    assert [p["id"] for p in client.get("/api/agents/daniel/rewind/pontos").json()["pontos"]] == [
        "a"
    ]
    events, _ = session_reset_events_since("daniel", seq)
    assert events[-1]["reason"] == "rewind"
    # Novo objeto DB (simula reinício) e importação atrasada não ressuscitam UUID.
    from db.store import GrupoBorgesDB

    novo_db = GrupoBorgesDB(db.db_path)
    assert novo_db._rewind_hidden_uuids("daniel", "session") == {"b"}
    _insert_jsonl(db, session_id="session", uuid="c", text="novo ramo", parent_uuid="a")
    assert [
        e["payload"]["uuid"]
        for e in db._list_jsonl_message_events("daniel", "session", 0, 10, True)
    ] == ["a", "c"]


def test_api_codigo_nao_oculta_conversa_nem_emite_reset(api):
    client, db, _ = api
    _, seq = session_reset_events_since("daniel", 0)
    response = client.post("/api/agents/daniel/rewind", json={"ponto_id": "a", "acao": "codigo"})
    assert response.status_code == 200
    assert response.json()["recarregar_feed"] is False
    assert db._rewind_hidden_uuids("daniel", "session") == set()
    assert session_reset_events_since("daniel", seq)[0] == []


def test_api_409_ocupado_422_indisponivel(api, monkeypatch):
    client, _, pane = api
    pane.input = "rascunho humano"
    assert (
        client.post(
            "/api/agents/daniel/rewind", json={"ponto_id": "a", "acao": "conversa"}
        ).status_code
        == 409
    )
    pane.input = ""
    pane.options = ["Restore conversation"]
    assert (
        client.post(
            "/api/agents/daniel/rewind", json={"ponto_id": "a", "acao": "codigo"}
        ).status_code
        == 422
    )
    monkeypatch.setattr(agents_router, "_esta_ocupado", lambda _: True)
    response = client.post("/api/agents/daniel/rewind", json={"ponto_id": "a", "acao": "conversa"})
    assert response.status_code == 409
    assert response.json()["detail"] == "agente_ocupado"


def test_rotulo_resumir_com_campo_opcional_medido_no_rascunho():
    tela = SEM_CODIGO.replace("❯ 1. Restore conversation", "  1. Restore conversation").replace(
        "  2. Summarize from here", "❯ 2. Summarize from here: add context (optional)"
    )
    assert rewind.selected_action(rewind.parse_screen(tela)) == "resumir_daqui"


def test_api_resolve_conversa_atual_pelo_jsonl(tmp_path, monkeypatch):
    from orchestrator.jsonl_watcher import encoded_cwd

    app = _build_app(tmp_path)
    sid = "11111111-1111-4111-8111-111111111111"
    pasta = tmp_path / encoded_cwd(DANIEL["workspace_path"])
    pasta.mkdir()
    (pasta / f"{sid}.jsonl").write_text(json.dumps(_user("a", "Ponto da sessão")))
    app.state.settings = SimpleNamespace(claude_projects_dir=str(tmp_path))
    monkeypatch.setattr(tmux_driver, "conversas_dos_processos", AsyncMock(return_value={}))
    _insert_jsonl(app.state.db, session_id=sid, uuid="a", text="Ponto da sessão")
    with TestClient(app) as client:
        response = client.get("/api/agents/daniel/rewind/pontos")
    assert response.status_code == 200, response.text
    assert response.json()["session_id"] == sid
    assert response.json()["pontos"][0]["id"] == "a"


@pytest.mark.parametrize(
    "metadata",
    [
        {"preservedMessages": {"uuids": ["a", "reply"]}},
        {"preservedSegment": {"headUuid": "a", "tailUuid": "reply"}},
    ],
)
def test_resumo_preserva_no_menu_apenas_prompts_do_trecho_mantido(metadata):
    r = [
        _user("a", "Mantido"),
        {"type": "assistant", "uuid": "reply", "parentUuid": "a"},
        _user("b", "Resumido", "reply"),
        {
            "type": "system",
            "subtype": "compact_boundary",
            "uuid": "boundary",
            "parentUuid": None,
            "compactMetadata": metadata,
        },
        _user("summary", "Resumo", "boundary", isCompactSummary=True),
    ]
    assert [p["id"] for p in rewind.pontos(r)] == ["a"]


def test_pontos_seguem_o_menu_comando_entra_canal_e_notificacao_nao():
    # Medido 01/11 numa cópia da conversa do Daniel: o menu lista só
    # "/clear" e "/reload-plugins --force"; Telegram (isMeta) e
    # <task-notification> (promptSource=system) não viram ponto.
    registros = [
        _user("caveat", "<local-command-caveat>x</local-command-caveat>", isMeta=True),
        _user(
            "clear",
            "<command-name>/clear</command-name>\n  <command-message>clear</command-message>\n"
            "  <command-args></command-args>",
            "caveat",
        ),
        _user("tg", '<channel source="plugin:telegram:telegram">oi</channel>', "clear", isMeta=True),
        _user(
            "task",
            "<task-notification>\n<task-id>b1</task-id>\n</task-notification>",
            "tg",
            promptSource="system",
        ),
        _user(
            "reload",
            "<command-name>/reload-plugins</command-name>\n"
            "  <command-message>reload-plugins</command-message>\n"
            "  <command-args>--force</command-args>",
            "task",
        ),
        _user("digitado", "Pedido digitado no terminal", "reload"),
    ]
    ps = rewind.pontos(registros)
    assert [p["texto"] for p in ps] == ["/clear", "/reload-plugins --force", "Pedido digitado no terminal"]


def test_ler_registros_guarda_prompt_source(tmp_path):
    caminho = tmp_path / "s.jsonl"
    caminho.write_text(json.dumps(_user("t", "<task-notification/>", promptSource="system")) + "\n")
    assert rewind.ler_registros(caminho)[0]["promptSource"] == "system"
