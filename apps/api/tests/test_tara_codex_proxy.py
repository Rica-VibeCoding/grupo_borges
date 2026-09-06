"""A Tara no harness do Claude Code com backend Codex via proxy (06/09/2026).

Ela deixou de ser `cli_default: codex` e virou `model_family: codex-proxy`. O que
muda de comportamento — e por isso está coberto aqui:

- o carimbo `executor_kind` que sobrava no banco tinha de sair, senão o painel
  continuava tratando a Tara como Codex CLI mesmo com o yaml já mudado;
- a cota da assinatura ChatGPT passa a entrar por fora (`scripts/codex-cota`),
  porque o proxy descarta o frame `codex.rate_limits` antes do cliente;
- o `/relaunch`, barrado para família não-Anthropic, precisa aceitar esta.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import GrupoBorgesDB
from routers import agents as agents_router
from services import codex_reader


TARA_PROXY = {
    "slug": "tara",
    "name": "Tara Kaur",
    "role": "executor",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "claude_code",
    "model_default": "gpt-5.6-sol[1m]",
    "model_family": "codex-proxy",
    "capabilities": [],
    "can_review": [],
}

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

# Corpo real de `GET chatgpt.com/backend-api/wham/usage`, medido em 06/09/2026.
# `email`/`user_id` ficam aqui de propósito: o teste que importa é o que prova
# que eles NÃO atravessam pro banco.
WHAM_USAGE_VIVO = {
    "user_id": "user-exemplo",
    "account_id": "",
    "email": "conta@exemplo.com",
    "plan_type": "prolite",
    "rate_limit": {
        "allowed": True,
        "limit_reached": False,
        "primary_window": {
            "used_percent": 39,
            "limit_window_seconds": 604800,
            "reset_after_seconds": 555195,
            "reset_at": 1789262742,
        },
        "secondary_window": None,
    },
    "code_review_rate_limit": None,
    "additional_rate_limits": [],
}


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL, TARA_PROXY])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL, TARA_PROXY]}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


# --------------------------------------------------------------------------
# normalize_wham_usage_payload
# --------------------------------------------------------------------------


def test_wham_usage_vira_o_formato_que_o_painel_ja_lia() -> None:
    """Três nomes mudam entre as pontas — e são só esses três."""
    saida = codex_reader.normalize_wham_usage_payload(WHAM_USAGE_VIVO, observed_at=1788710000)

    assert saida is not None
    assert saida["source"] == "codex.event_msg.token_count"
    assert saida["observed_at"] == 1788710000
    assert saida["rate_limits"]["primary"] == {
        "used_percent": 39,
        # 604800s / 60 — é por `window_minutes` que o painel separa 5h de 7 dias.
        "window_minutes": 10080,
        # `reset_at` no endpoint, `resets_at` no painel.
        "resets_at": 1789262742,
    }


def test_wham_usage_nao_carrega_email_nem_user_id() -> None:
    """O que sai daqui vai pro banco do cockpit — dado de conta não vai junto."""
    saida = codex_reader.normalize_wham_usage_payload(WHAM_USAGE_VIVO, observed_at=1)

    serializado = json.dumps(saida)
    assert "conta@exemplo.com" not in serializado
    assert "user-exemplo" not in serializado
    assert "prolite" not in serializado


def test_wham_usage_sem_rate_limit_devolve_none() -> None:
    """Resposta de erro do endpoint (HTML, 403 travestido) não vira cota vazia."""
    assert codex_reader.normalize_wham_usage_payload({"detail": "erro"}, observed_at=1) is None
    assert codex_reader.normalize_wham_usage_payload(
        {"rate_limit": {"primary_window": None, "secondary_window": None}}, observed_at=1
    ) is None


# --------------------------------------------------------------------------
# executor_kind: o yaml é a fonte
# --------------------------------------------------------------------------


def test_sync_limpa_executor_kind_de_quem_saiu_do_codex(tmp_path: Path) -> None:
    """O carimbo é escrito pelo webhook de eventos, não derivado do yaml.

    Sem esta limpeza, `_agente_codex()` seguia dando `True` pela linha antiga do
    `agent_state` e o painel da Tara continuava no caminho do Codex CLI depois
    da migração — bug que só apareceria no primeiro restart.
    """
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    tara_codex = {**TARA_PROXY, "cli_default": "codex", "model_family": None}
    db._sync_agents([tara_codex])
    db._update_agent_codex_state("tara", executor_kind="codex")
    assert db._get_agent("tara")["executor_kind"] == "codex"

    db._sync_agents([TARA_PROXY])

    assert db._get_agent("tara")["executor_kind"] is None


def test_sync_preserva_executor_kind_de_quem_continua_no_codex(tmp_path: Path) -> None:
    """A limpeza vale só para quem o yaml já mudou — não é faxina geral."""
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    tara_codex = {**TARA_PROXY, "cli_default": "codex", "model_family": None}
    db._sync_agents([tara_codex])
    db._update_agent_codex_state("tara", executor_kind="codex")

    db._sync_agents([tara_codex])

    assert db._get_agent("tara")["executor_kind"] == "codex"


# --------------------------------------------------------------------------
# POST /quota-snapshot
# --------------------------------------------------------------------------


def test_quota_snapshot_grava_e_o_painel_mostra(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    client = TestClient(app)

    resposta = client.post("/api/agents/tara/quota-snapshot", json=WHAM_USAGE_VIVO)
    assert resposta.status_code == 200
    assert resposta.json()["slug"] == "tara"

    gravado = json.loads(app.state.db._get_agent("tara")["token_usage_json"])
    assert gravado["rate_limits"]["primary"]["used_percent"] == 39
    assert "conta@exemplo.com" not in json.dumps(gravado)


def test_quota_snapshot_recusa_agente_de_outra_familia(tmp_path: Path) -> None:
    """Cota errada no painel é pior que cota ausente: seria a conta de outrem."""
    client = TestClient(_build_app(tmp_path))

    resposta = client.post("/api/agents/daniel/quota-snapshot", json=WHAM_USAGE_VIVO)

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "quota_snapshot_somente_codex_proxy"


def test_quota_snapshot_recusa_corpo_sem_rate_limit(tmp_path: Path) -> None:
    client = TestClient(_build_app(tmp_path))

    resposta = client.post("/api/agents/tara/quota-snapshot", json={"detail": "nope"})

    assert resposta.status_code == 422
    assert resposta.json()["detail"] == "quota_snapshot_sem_rate_limit"


# --------------------------------------------------------------------------
# /relaunch
# --------------------------------------------------------------------------


def test_relaunch_nao_barra_mais_a_familia_codex_proxy(tmp_path: Path) -> None:
    """O guard existe pra motor que o `--resume` do CC não sabe religar.

    A Tara nova é uma sessão Claude Code comum — o que muda é o `ANTHROPIC_BASE_URL`
    do boot, que o relaunch preserva. Passar do guard é o que este teste fixa; o
    409 seguinte é de sessão inexistente no ambiente de teste, não da família.
    """
    client = TestClient(_build_app(tmp_path))

    resposta = client.post("/api/agents/tara/relaunch", json={"confirm": True})

    assert resposta.json().get("detail") != "relaunch_requer_backend_anthropic_nativo"


# --------------------------------------------------------------------------
# /model: fechado, e por quê
# --------------------------------------------------------------------------


def test_painel_nao_oferece_seletor_de_modelo(tmp_path: Path) -> None:
    """Sem seletor no painel não há clique que troque o modelo da máquina."""
    client = TestClient(_build_app(tmp_path))

    corpo = client.get("/api/agents/tara/painel").json()

    assert corpo["model"] is None


def test_patch_model_recusa_codex_proxy(tmp_path: Path) -> None:
    """O `/model` do CC grava no `~/.claude/settings.json` GLOBAL.

    Medido em 06/09: um `/model gpt-5.6-terra` numa sessão de teste trocou o
    campo `model` da frota inteira, e só apareceria no próximo boot de outro
    agente. O painel não oferece; esta porta fecha o POST direto.
    """
    client = TestClient(_build_app(tmp_path))

    resposta = client.post("/api/agents/tara/model", json={"model": "opus"})

    assert resposta.status_code == 409
    assert resposta.json()["detail"] == "model_fixo_no_boot_para_codex_proxy"
