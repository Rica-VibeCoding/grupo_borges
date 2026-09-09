"""`POST /api/agents/{slug}/aplicar-motor` — a operação única que aplica a
escolha de motor.

O que ela resolve: família, modelo e esforço das famílias persist-only só valem
no próximo boot, e até aqui esse boot era Desligar + Ligar na mão. As duas
metades da régua estão aqui: o caminho novo faz desligar→ligar na ordem e
protege o turno em voo, e os dois endpoints soltos continuam com o contrato de
antes (o `/desligar` NÃO ganhou guarda de agente ocupado).
"""
from __future__ import annotations

import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import LIFECYCLE_FRESH_THRESHOLD_SECONDS, GrupoBorgesDB
from routers import agents as agents_router
from services import tmux_driver


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
    "scopes_parados": ["borges-clawd@canario.service"],
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


def _trabalhando(app: FastAPI) -> None:
    app.state.db._update_agent_lifecycle(
        "canarinho", status="trabalhando", detail=None, event="test.setup"
    )


def test_aplicar_desliga_e_religa_nessa_ordem(tmp_path: Path) -> None:
    """Agente ocioso: 200, e o boot roda DEPOIS do desligamento.

    A ordem não é detalhe — religar antes de a sessão morrer faz o
    `subir-frota.sh` responder `já up — pulando` e o agente continuar no motor
    velho, que é exatamente a falha silenciosa que esta operação existe para
    evitar.
    """
    app = _build_app(tmp_path)
    ordem: list[str] = []

    async def desliga(_sessao: str) -> dict[str, object]:
        ordem.append("desligar")
        return DESLIGADO

    async def liga(_sessao: str) -> dict[str, object]:
        ordem.append("ligar")
        return LIGADO

    with patch("routers.agents.tmux_driver.shutdown_agent", new=desliga), \
         patch("routers.agents.tmux_driver.boot_agent", new=liga):
        with TestClient(app) as client:
            resposta = client.post(
                "/api/agents/canarinho/aplicar-motor", json={"confirm": True}
            )

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["desligado"] is True
    assert corpo["religado"] is True
    assert ordem == ["desligar", "ligar"]


def test_aplicar_exige_confirmacao_explicita(tmp_path: Path) -> None:
    """Sem `confirm` não se desliga nada — mesmo contrato do `/desligar`."""
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.shutdown_agent", new_callable=AsyncMock) as desliga, \
         patch("routers.agents.tmux_driver.boot_agent", new_callable=AsyncMock) as liga:
        with TestClient(app) as client:
            resposta = client.post(
                "/api/agents/canarinho/aplicar-motor", json={"confirm": False}
            )
    assert resposta.status_code == 400
    assert resposta.json()["detail"] == "confirmacao_explicita_obrigatoria"
    desliga.assert_not_called()
    liga.assert_not_called()


def test_aplicar_no_meio_do_turno_recusa_sem_force(tmp_path: Path) -> None:
    """`trabalhando` sem `force` → 409, e NADA é desligado.

    É a guarda que o plano exigiu: num botão que só troca modelo, matar o turno
    em voo seria perda silenciosa de trabalho.
    """
    app = _build_app(tmp_path)
    _trabalhando(app)
    with patch("routers.agents.tmux_driver.shutdown_agent", new_callable=AsyncMock) as desliga, \
         patch("routers.agents.tmux_driver.boot_agent", new_callable=AsyncMock) as liga:
        with TestClient(app) as client:
            resposta = client.post(
                "/api/agents/canarinho/aplicar-motor", json={"confirm": True}
            )
    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "agent_busy_confirm_required"
    desliga.assert_not_called()
    liga.assert_not_called()


def test_aplicar_no_meio_do_turno_passa_com_force(tmp_path: Path) -> None:
    """`trabalhando` com `force=true` → 200. O Rica assumiu o risco na tela."""
    app = _build_app(tmp_path)
    _trabalhando(app)
    with patch("routers.agents.tmux_driver.shutdown_agent", new_callable=AsyncMock, return_value=DESLIGADO), \
         patch("routers.agents.tmux_driver.boot_agent", new_callable=AsyncMock, return_value=LIGADO):
        with TestClient(app) as client:
            resposta = client.post(
                "/api/agents/canarinho/aplicar-motor",
                json={"confirm": True, "force": True},
            )
    assert resposta.status_code == 200
    assert resposta.json()["religado"] is True


def test_religar_que_falha_avisa_que_o_agente_ficou_no_chao(tmp_path: Path) -> None:
    """Boot recusado DEPOIS do desligamento: o detail diz o estado real.

    `ligar_em_curso` (o detail do endpoint solto) faria a tela dizer "tente de
    novo" sobre um agente que está fora do ar — o operador precisa saber que
    falta um Ligar, não que nada aconteceu.
    """
    app = _build_app(tmp_path)
    with patch("routers.agents.tmux_driver.shutdown_agent", new_callable=AsyncMock, return_value=DESLIGADO), \
         patch(
             "routers.agents.tmux_driver.boot_agent",
             new_callable=AsyncMock,
             side_effect=tmux_driver.TmuxSessionBusyError("boot já em curso"),
         ):
        with TestClient(app) as client:
            resposta = client.post(
                "/api/agents/canarinho/aplicar-motor", json={"confirm": True}
            )
    assert resposta.status_code == 409
    assert resposta.json()["detail"].startswith("religar_falhou_agente_desligado")


def test_desligar_solto_continua_sem_guarda_de_turno(tmp_path: Path) -> None:
    """A metade "o que funcionava continua funcionando".

    O botão Desligar do painel é o degrau bruto e assumido — o toque duplo dele
    já é a confirmação consciente. A guarda nova é da operação única, e não pode
    ter vazado para cá.
    """
    app = _build_app(tmp_path)
    _trabalhando(app)
    with patch("routers.agents.tmux_driver.shutdown_agent", new_callable=AsyncMock, return_value=DESLIGADO):
        with TestClient(app) as client:
            resposta = client.post(
                "/api/agents/canarinho/desligar", json={"confirm": True}
            )
    assert resposta.status_code == 200


def _trabalhando_ha(app: FastAPI, segundos: int) -> None:
    """Deixa o lifecycle em `trabalhando` com o carimbo `segundos` no passado.

    Reproduz o estado real: o turno morreu sem `end_turn` e o classificador
    nunca mais escreveu nada sobre este agente.
    """
    _trabalhando(app)
    velho = int(time.time()) - segundos
    with app.state.db._connect() as conn, conn:
        conn.execute(
            "UPDATE agent_state SET lifecycle_updated_at = ? WHERE slug = ?",
            (velho, "canarinho"),
        )


def test_trabalhando_rancoso_nao_bloqueia_a_operacao(tmp_path: Path) -> None:
    """`trabalhando` fora da janela de frescor não é agente ocupado.

    O caso real (Tara, 09/09): o turno terminou sem `end_turn` no JSONL — o
    classificador só sai de `trabalhando` por `end_turn`, `result` ou
    `turn_duration`, e nenhum veio. O campo ficou preso por onze minutos com o
    agente parado no prompt vazio, e a operação foi recusada TRÊS vezes.

    A tela já lia isto certo: `derive_agent_status` descarta lifecycle mais
    velho que `LIFECYCLE_FRESH_THRESHOLD_SECONDS` e mostra "ocioso". Quem lia o
    campo cru era só a guarda — o servidor e o card discordavam sobre o mesmo
    agente, e quem via a divergência era o Rica, clicando num botão que não
    respondia.
    """
    app = _build_app(tmp_path)
    _trabalhando_ha(app, LIFECYCLE_FRESH_THRESHOLD_SECONDS + 60)

    with patch("routers.agents.tmux_driver.shutdown_agent", new_callable=AsyncMock, return_value=DESLIGADO), \
         patch("routers.agents.tmux_driver.boot_agent", new_callable=AsyncMock, return_value=LIGADO):
        with TestClient(app) as client:
            resposta = client.post(
                "/api/agents/canarinho/aplicar-motor", json={"confirm": True}
            )

    assert resposta.status_code == 200
    assert resposta.json()["religado"] is True


def test_trabalhando_fresco_continua_protegido(tmp_path: Path) -> None:
    """A outra metade: turno em voo DE VERDADE segue pedindo confirmação.

    Sem esta, o conserto acima viraria "a guarda deixou de existir" — e o
    ponto dela é justamente não matar trabalho em andamento.
    """
    app = _build_app(tmp_path)
    _trabalhando_ha(app, LIFECYCLE_FRESH_THRESHOLD_SECONDS - 60)

    with patch("routers.agents.tmux_driver.shutdown_agent", new_callable=AsyncMock) as desliga, \
         patch("routers.agents.tmux_driver.boot_agent", new_callable=AsyncMock) as liga:
        with TestClient(app) as client:
            resposta = client.post(
                "/api/agents/canarinho/aplicar-motor", json={"confirm": True}
            )

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "agent_busy_confirm_required"
    desliga.assert_not_called()
    liga.assert_not_called()
