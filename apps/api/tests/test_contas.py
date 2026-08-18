from __future__ import annotations

import json
from pathlib import Path

import pytest

from routers import contas


def test_descoberta_ignora_invalido_e_fica_com_a_data_mais_nova(tmp_path: Path) -> None:
    (tmp_path / "cc-oauth-token-woodpro-2026-08-16.txt").write_text("velha")
    (tmp_path / "cc-oauth-token-woodpro-2026-08-18.txt").write_text("nova")
    (tmp_path / "cc-oauth-token-incasa-2026-08-18.txt").write_text("outra")
    # Os arquivos de 16/08 guardavam o código do callback, não a chave.
    (tmp_path / "cc-oauth-token-ricardo.txt.INVALIDO-codigo-intermediario").write_text("lixo")
    (tmp_path / "openai-api-key.txt").write_text("de outra casa")

    achadas = contas._chaves_disponiveis(tmp_path)

    assert set(achadas) == {"woodpro", "incasa"}
    assert achadas["woodpro"].read_text() == "nova"


def test_troca_escreve_nas_duas_fontes_e_guarda_o_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    (secrets / "cc-oauth-token-woodpro-2026-08-18.txt").write_text("sk-ant-oat01-nova\n")

    credenciais = tmp_path / ".credentials.json"
    credenciais.write_text(
        json.dumps({"claudeAiOauth": {"accessToken": "sk-ant-oat01-velha", "subscriptionType": "max"}})
    )
    config = tmp_path / ".claude.json"
    config.write_text(json.dumps({"oauthAccount": {"emailAddress": "ricardo.incasa@gmail.com"}}))

    monkeypatch.setattr(contas, "_SECRETS_DIR", secrets)
    monkeypatch.setattr(contas, "_CREDENTIALS_PATH", credenciais)
    monkeypatch.setattr(contas, "_CLAUDE_CONFIG_PATH", config)

    class RespostaFalsa:
        status_code = 200
        headers: dict[str, str] = {}

    monkeypatch.setattr(contas.httpx, "post", lambda *a, **k: RespostaFalsa())

    resultado = contas.trocar_conta(contas.TrocaPedido(conta_id="woodpro"))

    assert resultado.ok is True
    assert json.loads(credenciais.read_text())["claudeAiOauth"]["accessToken"] == "sk-ant-oat01-nova"
    # A pílula do painel lê daqui: sem isso a tela anuncia a conta velha.
    assert json.loads(config.read_text())["oauthAccount"]["emailAddress"] == "woodpromais@gmail.com"
    assert resultado.ativa.email == "woodpromais@gmail.com"

    backups = list(tmp_path.glob(".credentials.json.bak-*"))
    assert len(backups) == 1
    assert json.loads(backups[0].read_text())["claudeAiOauth"]["accessToken"] == "sk-ant-oat01-velha"


def test_chave_morta_nao_encosta_na_credencial_da_frota(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    (secrets / "cc-oauth-token-woodpro-2026-08-18.txt").write_text("sk-ant-oat01-morta\n")

    credenciais = tmp_path / ".credentials.json"
    credenciais.write_text(json.dumps({"claudeAiOauth": {"accessToken": "sk-ant-oat01-viva"}}))

    monkeypatch.setattr(contas, "_SECRETS_DIR", secrets)
    monkeypatch.setattr(contas, "_CREDENTIALS_PATH", credenciais)
    monkeypatch.setattr(contas, "_CLAUDE_CONFIG_PATH", tmp_path / ".claude.json")

    class RespostaFalsa:
        status_code = 401
        headers: dict[str, str] = {}

    monkeypatch.setattr(contas.httpx, "post", lambda *a, **k: RespostaFalsa())

    with pytest.raises(contas.HTTPException) as erro:
        contas.trocar_conta(contas.TrocaPedido(conta_id="woodpro"))

    assert erro.value.status_code == 409
    assert json.loads(credenciais.read_text())["claudeAiOauth"]["accessToken"] == "sk-ant-oat01-viva"


def test_email_nunca_vem_nulo_pro_front(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """O front faz `email.split('@')`; nulo aqui vira erro de runtime na tela.

    Conta sem e-mail mapeado se identifica pelo próprio id.
    """
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    (secrets / "cc-oauth-token-contanova-2026-08-18.txt").write_text("sk-ant-oat01-x\n")

    monkeypatch.setattr(contas, "_SECRETS_DIR", secrets)
    monkeypatch.setattr(contas, "_CLAUDE_CONFIG_PATH", tmp_path / "sem-config.json")
    monkeypatch.setattr(contas, "_cota_com_cache", lambda *a: (None, None))

    resposta = contas.listar_contas()

    assert resposta.ativa is None
    assert [c.email for c in resposta.contas] == ["contanova"]
