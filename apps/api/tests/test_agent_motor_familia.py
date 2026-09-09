from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import GrupoBorgesDB
from routers import agents as agents_router

# A coluna `agents.model_family` é reescrita a cada boot a partir do agents.yaml
# (store.py, ON CONFLICT ... SET model_family = excluded.model_family). A escolha
# do Rica NÃO pode morar ali — mora em `agent_state.motor_familia`, que o boot não
# toca. Estes testes provam os dois lados: o override persiste sobrevivendo a uma
# resincronização de boot, e o despacho de cota do painel passa a seguir a família
# escolhida.

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


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL, CANARIO])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL, CANARIO]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


# ---------- família efetiva (unidade) ----------


def test_effective_model_family_override_ganha_do_yaml() -> None:
    # Override presente → é ele que vale (o boot seguinte aplica).
    assert (
        agents_router._effective_model_family({"model_family": "opencode", "motor_familia": "codex-proxy"})
        == "codex-proxy"
    )
    # Sem override → o yaml.
    assert (
        agents_router._effective_model_family({"model_family": "kimi", "motor_familia": None})
        == "kimi"
    )
    # Nenhum dos dois → None (o padrão Anthropic, que o yaml representa ausente).
    assert agents_router._effective_model_family({"model_family": None, "motor_familia": None}) is None


def test_painel_motor_normaliza_e_rotula_fonte() -> None:
    # Sem statusline: o que este teste afirma (família normalizada e rótulo da
    # fonte) não depende da sessão viva. O segundo argumento passou a ser
    # obrigatório de propósito — com default, quem esquecesse de passá-lo teria
    # `session_may_diverge` preso em True, que é justamente o defeito.
    sem_sessao = agents_router._CCStatus("teste", None, None)
    escolhido = agents_router._painel_motor(
        {"model_family": "opencode", "motor_familia": "kimi"}, sem_sessao
    )
    assert escolhido.familia == "kimi"
    assert escolhido.override == "kimi"
    assert escolhido.source == "agent_state.motor_familia"

    herdado = agents_router._painel_motor({"model_family": "kimi", "motor_familia": None}, sem_sessao)
    assert herdado.familia == "kimi"
    assert herdado.override is None
    assert herdado.source == "agents.model_family"

    # Anthropic no yaml é ausência de campo → painel devolve "anthropic" pras
    # quatro ficarem completas na UI, com override nulo (ninguém escolheu).
    padrao = agents_router._painel_motor({"model_family": None, "motor_familia": None}, sem_sessao)
    assert padrao.familia == "anthropic"
    assert padrao.override is None


# ---------- persistência via API ----------


def test_patch_motor_familia_persiste_e_raiz_expoe(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        resposta = client.patch("/api/agents/daniel/motor-familia", json={"familia": "codex-proxy"})
        assert resposta.status_code == 200
        corpo = resposta.json()
        assert corpo["override"] == "codex-proxy"
        assert corpo["runtime_switch"] is False
        assert corpo["session_may_diverge"] is True

        raiz = client.get("/api/agents/daniel").json()
        assert raiz["motor_familia"] == "codex-proxy"

        # O bloco `motor` do painel reflete a escolha — é ele que a UI lê.
        painel = client.get("/api/agents/daniel/painel").json()
        assert painel["motor"]["override"] == "codex-proxy"
        assert painel["motor"]["familia"] == "codex-proxy"
        assert painel["motor"]["source"] == "agent_state.motor_familia"


def test_override_sobrevive_a_resincronizacao_de_boot(tmp_path: Path) -> None:
    """A armadilha da Fase 2: o sync do boot reescreve `agents.model_family` a
    partir do yaml — se a escolha morasse ali, um restart a apagaria. Em
    `agent_state.motor_familia` ela sobrevive ao mesmo sync."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        assert client.patch(
            "/api/agents/canarinho/motor-familia", json={"familia": "kimi"}
        ).status_code == 200

        # Simula o que o startup da API faz: re-sincroniza os agentes do yaml.
        app.state.db._sync_agents([DANIEL, CANARIO])

        raiz = client.get("/api/agents/canarinho").json()
        assert raiz["motor_familia"] == "kimi"
        # O model_family do yaml (reescrito no boot) continua opencode — os dois
        # convivem: o yaml diz o que o agente É por padrão, o override o que o
        # Rica escolheu.
        assert raiz["model_family"] == "opencode"


def test_despacho_de_cota_segue_o_override(tmp_path: Path) -> None:
    """Daniel é Anthropic no yaml (sem model_family). Escolhido opencode, o
    despacho de cota do painel passa a chamar o leitor do OpenCode — prova pelo
    `source` (a URL do OpenCode), que o leitor do Claude nunca devolveria."""
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        antes = client.get("/api/agents/daniel/painel").json()
        assert antes["quotas"]["source"] is None or not antes["quotas"]["source"]

        assert client.patch(
            "/api/agents/daniel/motor-familia", json={"familia": "opencode"}
        ).status_code == 200

        depois = client.get("/api/agents/daniel/painel").json()
        assert depois["quotas"]["source"] == agents_router._OPENCODE_USAGE_URL


def test_limpar_override_volta_a_herdar_o_yaml(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        client.patch("/api/agents/canarinho/motor-familia", json={"familia": "codex-proxy"})
        assert client.get("/api/agents/canarinho").json()["motor_familia"] == "codex-proxy"

        resposta = client.patch("/api/agents/canarinho/motor-familia", json={"familia": None})
        assert resposta.status_code == 200
        assert resposta.json()["override"] is None

        raiz = client.get("/api/agents/canarinho").json()
        assert raiz["motor_familia"] is None

        painel = client.get("/api/agents/canarinho/painel").json()
        assert painel["motor"]["override"] is None
        assert painel["motor"]["familia"] == "opencode"
        assert painel["motor"]["source"] == "agents.model_family"


def test_familia_fora_da_matriz_e_recusada(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        resposta = client.patch("/api/agents/daniel/motor-familia", json={"familia": "grok"})
        assert resposta.status_code == 422


def test_motor_familia_em_agente_inexistente_e_404(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        resposta = client.patch("/api/agents/quem/motor-familia", json={"familia": "kimi"})
        assert resposta.status_code == 404
