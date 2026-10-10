"""Fala local opt-in: não lê chave nem chama OpenAI; default preservado."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from test_agent_voice import _build_app

from config import Settings


def test_config_local_desligada_por_padrao(monkeypatch):
    monkeypatch.delenv("GB_LOCAL_LIVE_STT", raising=False)
    assert Settings(_env_file=None).local_live_stt is False


def test_token_local_recusa_sem_ler_segredo_ou_chamar_openai(tmp_path):
    app = _build_app(tmp_path)
    app.state.settings = SimpleNamespace(local_live_stt=True)
    with patch("routers.agents._live_stt_key", side_effect=AssertionError("não ler chave")), patch(
        "routers.agents.httpx.AsyncClient", side_effect=AssertionError("não chamar rede")
    ), TestClient(app) as client:
        response = client.post("/api/agents/daniel/transcription/live-token")
        assert response.status_code == 503
        assert response.json()["detail"] == "stt_local_por_arquivo"
        assert client.post("/api/agents/ghost/transcription/live-token").status_code == 404


def test_sem_opt_in_conserva_cunhagem_anterior(tmp_path):
    app = _build_app(tmp_path)
    app.state.settings = SimpleNamespace(local_live_stt=False)
    result = SimpleNamespace(status_code=200, json=lambda: {"value": "ek_teste", "expires_at": 123})
    provider = AsyncMock()
    provider.__aenter__.return_value.post.return_value = result
    with patch("routers.agents._live_stt_key", return_value="chave-ficticia"), patch(
        "routers.agents.httpx.AsyncClient", return_value=provider
    ), TestClient(app) as client:
        response = client.post("/api/agents/daniel/transcription/live-token")
    assert response.status_code == 200
    assert response.json()["token"] == "ek_teste"
    provider.__aenter__.return_value.post.assert_awaited_once()
