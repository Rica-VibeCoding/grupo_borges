"""Testes do endpoint POST /api/agents/{slug}/quotas/refresh — força refresh de
`rate_limits` via `/usage` + `r` no pane do próprio agente (ver
shared_rate_limits_congela_ate_clear.md: o CC não reconsulta cota sozinho
durante a sessão, só quando ela nasce de novo)."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

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


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


def _speed_up_polling(monkeypatch) -> None:
    """Zera os intervalos de espera — o que está sob teste é a sequência de
    chamadas ao tmux, não o tempo real de polling."""
    monkeypatch.setattr(agents_router, "_USAGE_SCREEN_OPEN_INTERVAL_S", 0)
    monkeypatch.setattr(agents_router, "_USAGE_REFRESH_SETTLE_S", 0)


def test_quota_refresh_busy_returns_409(tmp_path: Path) -> None:
    """Agente `trabalhando` → 409, nunca toca o tmux — `/usage` no meio de um
    turno interromperia o que ele está fazendo."""
    app = _build_app(tmp_path)
    app.state.db._update_agent_lifecycle(
        "daniel", status="trabalhando", detail=None, event="test.setup"
    )
    with patch("routers.agents.tmux_driver.send_message") as send:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/quotas/refresh")
        assert response.status_code == 409
        assert response.json()["detail"] == "agent_busy"
        send.assert_not_called()


def test_quota_refresh_tmux_indisponivel_nao_fecha_tela(tmp_path: Path) -> None:
    """`/usage` recusado pelo canal → refreshed=False; como nada foi entregue,
    nenhum Escape de fechamento é disparado."""
    app = _build_app(tmp_path)
    recusado = tmux_driver.DeliveryResult(outcome="refused", reason="sessao_ausente")
    with patch("routers.agents.tmux_driver.send_message", return_value=recusado), patch(
        "routers.agents.tmux_driver.send_named_key"
    ) as send_key:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/quotas/refresh")
        assert response.status_code == 200
        assert response.json() == {"refreshed": False, "reason": "tmux_indisponivel"}
        send_key.assert_not_called()


def test_quota_refresh_tela_nao_abre_ainda_assim_fecha(
    tmp_path: Path, monkeypatch
) -> None:
    """`/usage` entregue mas a tela nunca aparece no pane → refreshed=False, e
    o Escape de segurança dispara mesmo assim (rede de segurança: nunca deixar
    um modal preso, mesmo quando a detecção de abertura falha)."""
    app = _build_app(tmp_path)
    _speed_up_polling(monkeypatch)
    with patch(
        "routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED
    ), patch(
        "routers.agents.tmux_driver.capture_pane_excerpt",
        return_value="Sonnet 5 - 00:01 - [...] 1%",
    ), patch(
        "routers.agents.tmux_driver.send_named_key", return_value=True
    ) as send_key:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/quotas/refresh")
        assert response.status_code == 200
        assert response.json() == {"refreshed": False, "reason": "tela_nao_abriu"}
        assert send_key.call_args_list == [call("daniel", "Escape"), call("daniel", "Escape")]


def test_quota_refresh_sucesso_manda_r_e_fecha_com_dois_escape(
    tmp_path: Path, monkeypatch
) -> None:
    """Fluxo feliz: a tela do `/usage` aparece no pane, o endpoint manda `r`
    (retry documentado) e sempre fecha com 2 Escape no final."""
    app = _build_app(tmp_path)
    _speed_up_polling(monkeypatch)
    with patch(
        "routers.agents.tmux_driver.send_message", return_value=tmux_driver.DELIVERED
    ), patch(
        "routers.agents.tmux_driver.capture_pane_excerpt",
        return_value="Limites de uso do plano Max (5x)\nSessão atual\n4% usado",
    ), patch(
        "routers.agents.tmux_driver.send_named_key", return_value=True
    ) as send_key:
        with TestClient(app) as client:
            response = client.post("/api/agents/daniel/quotas/refresh")
        assert response.status_code == 200
        assert response.json() == {"refreshed": True, "reason": None}
        assert send_key.call_args_list == [
            call("daniel", "r"),
            call("daniel", "Escape"),
            call("daniel", "Escape"),
        ]
