"""O fio entre o botão Desligar e o carimbo que cala o vigia.

O módulo `desligamento_deliberado` tem bancada própria; o que falta provar é a
LIGAÇÃO: que o endpoint certo escreve, que o endpoint certo apaga, e que os
caminhos que derrubam a sessão sem ser por ordem do Rica — `aplicar-motor`, e o
Desligar que falha — não carimbam nada.

Sem isto, o carimbo poderia existir perfeito e nunca ser chamado, ou ser chamado
por quem não devia: agente marcado por engano some do radar do vigia e só volta
quando o Rica notar na mão, que é o avesso do que esta mudança existe pra fazer.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import libtmux.exc as libtmux_exc
from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import agents as agents_router


CANARIO = {
    "slug": "canarinho",
    "name": "Canário",
    "role": "executor",
    "emoji": "🐤",
    "tmux_session": "canario",
    "workspace_path": "/tmp/canario",
    "cli_default": "claude_code",
    "model_default": "deepseek-v4-flash",
    "model_family": "opencode",
    "capabilities": [],
    "can_review": [],
}

DESLIGADO = {
    "attempted": True,
    "sessao_encerrada": True,
    "scopes_parados": [],
    "scopes_resistiram": [],
    "boot_cancelado": False,
}

LIGADO = {"confirmed": True, "attempted": True}


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([CANARIO])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [CANARIO]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


class _Carimbo:
    """Dublê do módulo de carimbo — guarda quem entrou e quem saiu."""

    def __init__(self) -> None:
        self.marcados: list[str] = []
        self.desmarcados: list[str] = []

    def marcar(self, sessao: str, por: str = "cockpit") -> None:
        self.marcados.append(sessao)

    def desmarcar(self, sessao: str) -> None:
        self.desmarcados.append(sessao)


async def _desliga_ok(_sessao: str) -> dict[str, object]:
    return DESLIGADO


async def _liga_ok(_sessao: str) -> dict[str, object]:
    return LIGADO


def test_desligar_carimba_a_SESSAO_e_nao_o_slug(tmp_path: Path) -> None:
    """O fixture existe pra isto: `canarinho` mora na sessão `canario`, como na
    frota de verdade. Carimbo pelo slug não acharia par no vigia — e falharia
    calado, que é o modo mais caro."""
    app = _build_app(tmp_path)
    carimbo = _Carimbo()

    with patch("routers.agents.tmux_driver.shutdown_agent", new=_desliga_ok), \
         patch("routers.agents.desligamento_deliberado", carimbo):
        with TestClient(app) as client:
            resposta = client.post("/api/agents/canarinho/desligar", json={"confirm": True})

    assert resposta.status_code == 200
    assert carimbo.marcados == ["canario"]
    assert carimbo.desmarcados == []


def test_ligar_apaga_o_carimbo(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    carimbo = _Carimbo()

    with patch("routers.agents.tmux_driver.boot_agent", new=_liga_ok), \
         patch("routers.agents.desligamento_deliberado", carimbo):
        with TestClient(app) as client:
            resposta = client.post("/api/agents/canarinho/ligar")

    assert resposta.status_code == 200
    assert carimbo.desmarcados == ["canario"]
    assert carimbo.marcados == []


def test_desligar_que_falha_nao_carimba(tmp_path: Path) -> None:
    """Desligar que não desligou não é desligamento — e carimbo aí calaria o
    vigia justamente sobre um agente que pode estar morrendo de verdade."""
    app = _build_app(tmp_path)
    carimbo = _Carimbo()

    async def explode(_sessao: str) -> dict[str, object]:
        raise libtmux_exc.LibTmuxException("servidor tmux fora do ar")

    with patch("routers.agents.tmux_driver.shutdown_agent", new=explode), \
         patch("routers.agents.desligamento_deliberado", carimbo):
        with TestClient(app) as client:
            resposta = client.post("/api/agents/canarinho/desligar", json={"confirm": True})

    assert resposta.status_code == 409
    assert carimbo.marcados == []


def test_desligar_sem_confirmacao_nao_carimba(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    carimbo = _Carimbo()

    with patch("routers.agents.tmux_driver.shutdown_agent", new=_desliga_ok), \
         patch("routers.agents.desligamento_deliberado", carimbo):
        with TestClient(app) as client:
            resposta = client.post("/api/agents/canarinho/desligar", json={"confirm": False})

    assert resposta.status_code == 400
    assert carimbo.marcados == []


def test_aplicar_motor_nao_carimba(tmp_path: Path) -> None:
    """Ele derruba a sessão, mas religa na mesma chamada: carimbar ali só
    criaria marca pra apagar meio segundo depois — e, se o boot falhasse no
    meio, marca ERRADA sobre um agente que ninguém mandou desligar."""
    app = _build_app(tmp_path)
    carimbo = _Carimbo()

    with patch("routers.agents.tmux_driver.shutdown_agent", new=_desliga_ok), \
         patch("routers.agents.tmux_driver.boot_agent", new=_liga_ok), \
         patch("routers.agents.desligamento_deliberado", carimbo):
        with TestClient(app) as client:
            resposta = client.post(
                "/api/agents/canarinho/aplicar-motor", json={"confirm": True}
            )

    assert resposta.status_code == 200
    assert carimbo.marcados == []
    assert carimbo.desmarcados == []
