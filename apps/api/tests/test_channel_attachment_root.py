from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import agents


@pytest.fixture
def inbox(tmp_path, monkeypatch):
    root = tmp_path / "channels"
    folder = root / "telegram/inbox"
    folder.mkdir(parents=True)
    (folder / "anexo.txt").write_text("anexo-local")
    monkeypatch.setenv("GB_CHANNEL_ATTACHMENT_ROOT", str(root))
    monkeypatch.setattr(agents, "_get_agent_or_404", AsyncMock(return_value={"slug": "teste"}))
    app = FastAPI()
    app.include_router(agents.router, prefix="/api/agents")
    return TestClient(app), root, folder


def test_serve_anexo_da_raiz_local(inbox):
    client, _, folder = inbox
    response = client.get("/api/agents/teste/channel-attachment", params={"path": str(folder / "anexo.txt")})
    assert response.status_code == 200 and response.text == "anexo-local"


def test_recusa_travessia_e_prefixo_parecido(inbox, tmp_path):
    client, root, _ = inbox
    for path in [root / "../fora.txt", tmp_path / "channels-outra/anexo.txt"]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fora")
        assert client.get("/api/agents/teste/channel-attachment", params={"path": str(path)}).status_code == 400


def test_recusa_symlink_para_fora_da_raiz(inbox, tmp_path):
    client, _, folder = inbox
    outside = tmp_path / "privado.txt"
    outside.write_text("fora")
    (folder / "link.txt").symlink_to(outside)
    assert client.get("/api/agents/teste/channel-attachment", params={"path": str(folder / "link.txt")}).status_code == 400


def test_home_so_quando_explicitamente_configurada(inbox, monkeypatch, tmp_path):
    client, root, folder = inbox
    monkeypatch.setattr(agents.Path, "expanduser", lambda self: tmp_path / str(self)[2:] if str(self).startswith("~/") else self)
    monkeypatch.setenv("GB_CHANNEL_ATTACHMENT_ROOT", "~/channels")
    assert client.get("/api/agents/teste/channel-attachment", params={"path": str(folder / "anexo.txt")}).status_code == 200
    monkeypatch.setenv("GB_CHANNEL_ATTACHMENT_ROOT", "")
    # A ausência da variável continua apontando para a cerca histórica da VPS.
    assert agents._CHANNEL_ATTACHMENT_ROOT == agents.Path("/home/clawd/.claude/channels").resolve()
    assert client.get("/api/agents/teste/channel-attachment", params={"path": str(folder / "anexo.txt")}).status_code == 400


def test_recusa_raiz_relativa_e_arquivo_ausente(inbox, monkeypatch):
    client, _, folder = inbox
    assert client.get("/api/agents/teste/channel-attachment", params={"path": str(folder / "ausente.txt")}).status_code == 404
    monkeypatch.setenv("GB_CHANNEL_ATTACHMENT_ROOT", "channels")
    assert client.get("/api/agents/teste/channel-attachment", params={"path": str(folder / "anexo.txt")}).status_code == 400
