"""Troca de modelo/esforço sem travar no "trocar mesmo?" do Claude Code (27/09).

As telas das fixtures foram capturadas no CC 2.1.283 numa sessão descartável
fora da frota (`tests/fixtures/pergunta_motor/`). Os testes de endpoint usam
uma tela falsa que reproduz o que foi medido: `/model X` com cache abre a
pergunta com o foco no "Yes"; `1` aceita e `2` cancela, sem Enter.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import agents as agents_router
from routers import fleet as fleet_router
from services import tmux_driver
from services.pergunta_motor import (
    PerguntaMotor,
    destino_do_modelo,
    detecta_pergunta_motor,
    pergunta_e_do_pedido,
)

_FIXTURES = Path(__file__).parent / "fixtures" / "pergunta_motor"


def _tela(nome: str) -> str:
    return (_FIXTURES / f"{nome}.txt").read_text(encoding="utf-8")


# ----- detector -------------------------------------------------------------


def test_modal_de_modelo_com_agente_ocioso_nasce_com_foco_no_sim() -> None:
    assert detecta_pergunta_motor(_tela("modelo-ocioso")) == PerguntaMotor(
        tipo="modelo", destino="Haiku 4.5", opcao_em_foco="sim"
    )


def test_modal_de_modelo_com_foco_movido_para_o_nao() -> None:
    pergunta = detecta_pergunta_motor(_tela("modelo-foco-nao"))
    assert pergunta is not None
    assert pergunta.opcao_em_foco == "nao"


def test_modal_de_modelo_aberto_no_meio_do_turno() -> None:
    pergunta = detecta_pergunta_motor(_tela("modelo-ocupado-fila"))
    assert pergunta == PerguntaMotor(tipo="modelo", destino="Haiku 4.5", opcao_em_foco="sim")


def test_modal_de_esforco_traz_o_nivel_cru() -> None:
    assert detecta_pergunta_motor(_tela("esforco-ocioso")) == PerguntaMotor(
        tipo="esforco", destino="medium", opcao_em_foco="sim"
    )


@pytest.mark.parametrize("nome", ["modelo-aceito", "modelo-esc", "esforco-aceito"])
def test_tela_depois_da_resposta_nao_tem_pergunta(nome: str) -> None:
    assert detecta_pergunta_motor(_tela(nome)) is None


def test_pergunta_que_nao_e_o_fim_da_tela_nao_conta() -> None:
    """O mesmo texto transcrito mais acima (citado numa conversa, por exemplo)
    não é pergunta aberta: responder a ele é tecla solta no agente."""
    texto = _tela("modelo-ocioso") + "\n● citei o modal acima\n❯ \n  Sonnet 5 - 00:10\n"
    assert detecta_pergunta_motor(texto) is None


def test_opcoes_sem_titulo_nao_contam() -> None:
    assert detecta_pergunta_motor("❯ 1. Yes, switch to Haiku 4.5\n  2. No, go back") is None


@pytest.mark.parametrize("texto", [None, "", "Sonnet 5 - 00:10 - [░] 3%"])
def test_sem_texto_ou_sem_modal(texto: str | None) -> None:
    assert detecta_pergunta_motor(texto) is None


def test_detector_le_o_excerpt_da_fleet() -> None:
    """A fleet serve o pane limpo (sem linhas vazias) e cortado nos últimos
    1200 caracteres com `...` na frente — o modal continua inteiro nele."""
    linhas = [linha.rstrip() for linha in _tela("modelo-ocupado-fila").splitlines()]
    excerpt = tmux_driver._clean_pane_lines(linhas, max_chars=1200)
    assert excerpt is not None and excerpt.startswith("...")
    assert detecta_pergunta_motor(excerpt) == PerguntaMotor(
        tipo="modelo", destino="Haiku 4.5", opcao_em_foco="sim"
    )


def test_destino_do_modelo_e_o_pedido() -> None:
    assert destino_do_modelo("Haiku 4.5") == "haiku"
    assert destino_do_modelo("Opus 4.8 (1M context)") == "opus"
    assert destino_do_modelo("gpt-5.6-terra") is None
    haiku = PerguntaMotor(tipo="modelo", destino="Haiku 4.5", opcao_em_foco="sim")
    assert pergunta_e_do_pedido(haiku, "modelo", "haiku")
    assert not pergunta_e_do_pedido(haiku, "modelo", "sonnet")
    assert not pergunta_e_do_pedido(haiku, "esforco", "haiku")
    medium = PerguntaMotor(tipo="esforco", destino="medium", opcao_em_foco=None)
    assert pergunta_e_do_pedido(medium, "esforco", "medium")
    assert not pergunta_e_do_pedido(medium, "esforco", "high")


# ----- tela falsa -----------------------------------------------------------

_NOMES = {"haiku": "Haiku 4.5", "sonnet": "Sonnet 5", "opus": "Opus 4.8", "fable": "Fable 5"}


class TelaFalsa:
    """O Claude Code do jeito que foi medido em 27/09, sem tmux."""

    def __init__(self, modelo: str = "sonnet", esforco: str = "high", *, com_cache: bool = True):
        self.modelo = modelo
        self.esforco = esforco
        self.com_cache = com_cache
        self.pendente: tuple[str, str] | None = None  # (tipo, valor)
        self.enviados: list[str] = []
        self.teclas: list[str] = []
        #: Força o modal a mostrar outro destino (pergunta que não é do pedido).
        self.destino_forcado: str | None = None

    def abre(self, tipo: str, valor: str) -> None:
        self.pendente = (tipo, valor)

    def texto(self) -> str:
        statusline = f"  {_NOMES[self.modelo]} - 00:10 - [░░░░░░░░░░] 3%"
        if self.pendente is None:
            return f"● ok\n❯ \n{statusline}"
        tipo, valor = self.pendente
        if tipo == "modelo":
            base = _tela("modelo-ocioso")
            destino = self.destino_forcado or _NOMES[valor]
            return base.replace("Haiku 4.5", destino)
        return _tela("esforco-ocioso").replace("medium", self.destino_forcado or valor)

    async def send_message(self, _session: str, texto: str):
        self.enviados.append(texto)
        comando, valor = texto.split(" ", 1)
        tipo = "modelo" if comando == "/model" else "esforco"
        atual = self.modelo if tipo == "modelo" else self.esforco
        if self.com_cache and valor != atual:
            self.abre(tipo, valor)
        else:
            self._aplica(tipo, valor)
        return tmux_driver.DELIVERED

    def _aplica(self, tipo: str, valor: str) -> None:
        if tipo == "modelo":
            self.modelo = valor
        else:
            self.esforco = valor

    async def send_named_key(self, _session: str, tecla: str) -> bool:
        self.teclas.append(tecla)
        if self.pendente is not None and tecla in {"1", "2"}:
            tipo, valor = self.pendente
            self.pendente = None
            if tecla == "1":
                self._aplica(tipo, valor)
        return True

    async def capture_pane_excerpt(self, _session: str, **_kw) -> str:
        return self.texto()

    async def press_enter(self, _session: str) -> bool:  # pragma: no cover - não pode ser chamado
        raise AssertionError("Enter cego na troca de motor")

    #: Simula o `_load_cc_status` logo após /clear ou religar: a sessão nova
    #: ainda não tem arquivo e a leitura cai no da sessão ANTERIOR.
    status_de_outra_sessao: str | None = None

    def status(self, slug_session: str = "sessao-daniel") -> agents_router._CCStatus:
        if self.status_de_outra_sessao is not None:
            return agents_router._CCStatus(
                "sessao-velha",
                Path("/tmp/cc-status-sessao-velha.json"),
                {"updated_at": 1, "effort": {"level": self.status_de_outra_sessao}},
                True,
            )
        return agents_router._CCStatus(
            slug_session,
            Path(f"/tmp/cc-status-{slug_session}.json"),
            {"updated_at": 1, "effort": {"level": self.esforco}},
        )


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


def _app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


def _com_tela(tela: TelaFalsa):
    async def load_cc_status(_db, _slug):
        return tela.status()

    return (
        patch("routers.agents.tmux_driver.send_message", side_effect=tela.send_message),
        patch("routers.agents.tmux_driver.send_named_key", side_effect=tela.send_named_key),
        patch("routers.agents.tmux_driver.capture_pane_excerpt", side_effect=tela.capture_pane_excerpt),
        patch("routers.agents.tmux_driver.press_enter", side_effect=tela.press_enter),
        patch("routers.agents._load_cc_status", side_effect=load_cc_status),
        patch("routers.agents.asyncio.sleep", new_callable=AsyncMock),
    )


def _rodar(tela: TelaFalsa, app: FastAPI, metodo: str, url: str, corpo: dict):
    patches = _com_tela(tela)
    for p in patches:
        p.start()
    try:
        with TestClient(app) as client:
            return client.request(metodo, url, json=corpo)
    finally:
        for p in reversed(patches):
            p.stop()


_VIU_HAIKU = {"tipo": "modelo", "destino": "Haiku 4.5"}


def _state_model(app: FastAPI) -> str | None:
    return app.state.db._get_agent("daniel")["state_model"]


# ----- troca segura: modelo -------------------------------------------------


def test_modelo_pergunta_do_pedido_e_respondida_sozinha(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet")
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/model", {"model": "haiku"})

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["confirmed"] is True
    assert corpo["pergunta_respondida"] is True
    assert "pergunta_aberta" not in corpo
    assert tela.enviados == ["/model haiku"]
    assert tela.teclas == ["1"]
    assert tela.modelo == "haiku"
    assert _state_model(app) == "haiku"


def test_modelo_troca_normal_sem_pergunta_segue_funcionando(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet", com_cache=False)
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/model", {"model": "opus"})

    corpo = resposta.json()
    assert corpo["confirmed"] is True
    assert corpo["pergunta_respondida"] is False
    assert tela.enviados == ["/model opus"]
    assert tela.teclas == []
    assert _state_model(app) == "opus"


def test_modelo_pergunta_com_outro_destino_nao_e_respondida(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet")
    tela.destino_forcado = "Opus 4.8"
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/model", {"model": "haiku"})

    corpo = resposta.json()
    assert corpo["confirmed"] is False
    assert corpo["state_persisted"] is False
    assert corpo["pergunta_aberta"] == {
        "tipo": "modelo", "destino": "Opus 4.8", "opcao_em_foco": "sim",
    }
    assert tela.teclas == []
    assert _state_model(app) is None


def test_modelo_pergunta_ja_aberta_do_mesmo_destino_e_respondida_sem_reenviar(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet")
    tela.abre("modelo", "haiku")
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/model", {"model": "haiku"})

    assert resposta.json()["confirmed"] is True
    assert tela.enviados == []
    assert tela.teclas == ["1"]


def test_modelo_pergunta_ja_aberta_de_outro_destino_e_409(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet")
    tela.abre("modelo", "opus")
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/model", {"model": "haiku"})

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == {
        "code": "pergunta_motor_aberta",
        "pergunta": {"tipo": "modelo", "destino": "Opus 4.8", "opcao_em_foco": "sim"},
    }
    assert tela.enviados == [] and tela.teclas == []


def test_modelo_igual_ao_atual_nao_manda_nada(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet")
    corpo = _rodar(tela, app, "POST", "/api/agents/daniel/model", {"model": "sonnet"}).json()

    assert corpo["ja_estava"] is True
    assert corpo["confirmed"] is True
    assert corpo["tmux_delivered"] is False
    assert tela.enviados == [] and tela.teclas == []


def test_modelo_ocupado_nao_manda_nada(tmp_path: Path) -> None:
    app = _app(tmp_path)
    app.state.db._update_agent_lifecycle("daniel", status="trabalhando", detail=None, event="t")
    tela = TelaFalsa(modelo="sonnet")
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/model", {"model": "haiku"})

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "agent_busy_wait"
    assert tela.enviados == [] and tela.teclas == []


# ----- troca segura: esforço ------------------------------------------------


def test_esforco_pergunta_do_pedido_e_respondida_sozinha(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(esforco="high")
    corpo = _rodar(tela, app, "PATCH", "/api/agents/daniel/effort", {"effort": "medium"}).json()

    assert corpo["confirmed"] is True
    assert corpo["pergunta_respondida"] is True
    assert corpo["session_may_diverge"] is False
    assert tela.enviados == ["/effort medium"]
    assert tela.teclas == ["1"]


def test_esforco_troca_normal_sem_pergunta(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(esforco="high", com_cache=False)
    corpo = _rodar(tela, app, "PATCH", "/api/agents/daniel/effort", {"effort": "xhigh"}).json()

    assert corpo["confirmed"] is True
    assert corpo["pergunta_respondida"] is False
    assert tela.teclas == []


def test_esforco_ganha_a_guarda_de_ocupado(tmp_path: Path) -> None:
    app = _app(tmp_path)
    app.state.db._update_agent_lifecycle("daniel", status="trabalhando", detail=None, event="t")
    tela = TelaFalsa(esforco="high")
    resposta = _rodar(tela, app, "PATCH", "/api/agents/daniel/effort", {"effort": "medium"})

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "agent_busy_wait"
    assert tela.enviados == [] and tela.teclas == []


def test_esforco_igual_ao_atual_nao_manda_nada(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(esforco="high")
    corpo = _rodar(tela, app, "PATCH", "/api/agents/daniel/effort", {"effort": "high"}).json()

    assert corpo["ja_estava"] is True
    assert corpo["confirmed"] is True
    assert tela.enviados == []


def test_esforco_pergunta_de_outro_nivel_fica_aberta(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(esforco="high")
    tela.destino_forcado = "low"
    corpo = _rodar(tela, app, "PATCH", "/api/agents/daniel/effort", {"effort": "medium"}).json()

    assert corpo["confirmed"] is False
    assert corpo["pergunta_aberta"]["destino"] == "low"
    assert tela.teclas == []


# ----- rede de segurança: POST /confirmacao-motor ---------------------------


def test_confirmacao_sem_pergunta_na_tela_e_409(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa()
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/confirmacao-motor", {"resposta": "sim", **_VIU_HAIKU})

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "sem_pergunta_motor"
    assert tela.teclas == []


def test_confirmacao_sim_troca_e_grava_so_depois_da_statusline(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet")
    tela.abre("modelo", "haiku")
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/confirmacao-motor", {"resposta": "sim", **_VIU_HAIKU})

    assert resposta.status_code == 200
    assert resposta.json() == {
        "pergunta": {"tipo": "modelo", "destino": "Haiku 4.5", "opcao_em_foco": "sim"},
        "resposta": "sim",
        "respondida": True,
        "confirmed": True,
    }
    assert tela.teclas == ["1"]
    assert _state_model(app) == "haiku"


def test_confirmacao_nao_mantem_o_modelo(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet")
    tela.abre("modelo", "haiku")
    corpo = _rodar(tela, app, "POST", "/api/agents/daniel/confirmacao-motor", {"resposta": "nao", **_VIU_HAIKU}).json()

    assert corpo["respondida"] is True
    assert corpo["confirmed"] is False
    assert tela.teclas == ["2"]
    assert tela.modelo == "sonnet"
    assert _state_model(app) is None


def test_confirmacao_sim_de_esforco(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(esforco="high")
    tela.abre("esforco", "medium")
    corpo = _rodar(tela, app, "POST", "/api/agents/daniel/confirmacao-motor", {"resposta": "sim", "tipo": "esforco", "destino": "medium"}).json()

    assert corpo["pergunta"]["tipo"] == "esforco"
    assert corpo["respondida"] is True
    assert corpo["confirmed"] is True
    assert tela.esforco == "medium"


# ----- contrato na fleet ----------------------------------------------------


def test_fleet_expoe_a_pergunta_aberta_do_mesmo_excerpt(monkeypatch) -> None:
    telas = {"daniel": _tela("esforco-ocioso"), "outro": "❯ \n  Sonnet 5 - 00:10"}

    async def capture(session: str, **_kw):
        return telas[session]

    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", capture)
    agentes = [
        {"slug": "daniel", "tmux_session": "daniel"},
        {"slug": "outro", "tmux_session": "outro"},
    ]
    asyncio.run(fleet_router._hydrate_pane_excerpts(agentes))

    assert agentes[0]["pergunta_motor"] == {
        "tipo": "esforco", "destino": "medium", "opcao_em_foco": "sim",
    }
    assert agentes[1]["pergunta_motor"] is None


# ----- ajustes pós code-review ----------------------------------------------


def test_esforco_ja_estava_nao_confia_na_statusline_de_outra_sessao(tmp_path: Path) -> None:
    """Logo após /clear, o `_load_cc_status` cai no arquivo da sessão anterior
    (`fell_back`). Ele dizer `high` não prova que a sessão NOVA está em `high`."""
    app = _app(tmp_path)
    tela = TelaFalsa(esforco="medium", com_cache=False)
    tela.status_de_outra_sessao = "high"
    corpo = _rodar(tela, app, "PATCH", "/api/agents/daniel/effort", {"effort": "high"}).json()

    assert corpo["ja_estava"] is False
    assert tela.enviados == ["/effort high"]


def test_confirmacao_de_esforco_nao_confirma_pela_statusline_de_outra_sessao(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(esforco="high")
    tela.abre("esforco", "medium")
    tela.status_de_outra_sessao = "medium"
    corpo = _rodar(
        tela, app, "POST", "/api/agents/daniel/confirmacao-motor",
        {"resposta": "sim", "tipo": "esforco", "destino": "medium"},
    ).json()

    assert corpo["respondida"] is True
    assert corpo["confirmed"] is False


def test_confirmacao_exige_a_pergunta_que_o_rica_viu(tmp_path: Path) -> None:
    """A barra mostrou "Trocar para Haiku?"; se a tela agora pergunta outra
    coisa, o "sim" dele não vale para ela."""
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet")
    tela.abre("modelo", "opus")
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/confirmacao-motor",
                      {"resposta": "sim", **_VIU_HAIKU})

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == {
        "code": "pergunta_mudou",
        "pergunta": {"tipo": "modelo", "destino": "Opus 4.8", "opcao_em_foco": "sim"},
    }
    assert tela.teclas == []
    assert tela.modelo == "sonnet"


def test_confirmacao_sem_tipo_e_destino_e_422(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tela = TelaFalsa(modelo="sonnet")
    tela.abre("modelo", "haiku")
    resposta = _rodar(tela, app, "POST", "/api/agents/daniel/confirmacao-motor", {"resposta": "sim"})

    assert resposta.status_code == 422
    assert tela.teclas == []
