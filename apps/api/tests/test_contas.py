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
    monkeypatch.setattr(contas, "_cota_com_cache", lambda *a: ((None, None), False))

    resposta = contas.listar_contas()

    assert resposta.ativa is None
    assert [c.email for c in resposta.contas] == ["contanova"]


def _duas_contas(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    (secrets / "cc-oauth-token-woodpro-2026-08-18.txt").write_text("chave-w\n")
    (secrets / "cc-oauth-token-incasa-2026-08-18.txt").write_text("chave-i\n")
    monkeypatch.setattr(contas, "_SECRETS_DIR", secrets)
    monkeypatch.setattr(contas, "_CLAUDE_CONFIG_PATH", tmp_path / "sem-config.json")
    monkeypatch.setattr(contas, "_cota_cache", {})
    monkeypatch.setattr(contas, "_revalidando", set())


def test_leitura_fria_sonda_as_contas_em_paralelo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A fria custava a SOMA das sondas (1,3 s medido com duas); agora custa a
    mais lenta."""
    import time

    _duas_contas(tmp_path, monkeypatch)
    em_voo = {"agora": 0, "pico": 0}
    trava = __import__("threading").Lock()

    def sonda_lenta(chave: str) -> tuple[float, float]:
        with trava:
            em_voo["agora"] += 1
            em_voo["pico"] = max(em_voo["pico"], em_voo["agora"])
        time.sleep(0.3)
        with trava:
            em_voo["agora"] -= 1
        return (0.5, 0.1) if chave == "chave-i" else (0.2, 0.3)

    monkeypatch.setattr(contas, "_sondar", sonda_lenta)

    resposta = contas.listar_contas()

    assert em_voo["pico"] == 2
    # Ordem de id preservada, cada cota com a sua conta.
    assert [(c.id, c.cota_5h) for c in resposta.contas] == [("incasa", 0.5), ("woodpro", 0.2)]


def test_cota_vencida_sai_na_hora_e_revalida_por_baixo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import threading
    import time

    _duas_contas(tmp_path, monkeypatch)
    velho = time.monotonic() - contas._CACHE_TTL_S - 1
    contas._cota_cache.update({"incasa": (velho, (0.1, 0.1)), "woodpro": (velho, (0.2, 0.2))})
    libera = threading.Event()
    sondadas: list[str] = []

    def sonda_presa(chave: str) -> tuple[float, float]:
        sondadas.append(chave)
        libera.wait(5)
        return (0.9, 0.9)

    monkeypatch.setattr(contas, "_sondar", sonda_presa)

    inicio = time.monotonic()
    resposta = contas.listar_contas()
    # De novo, com a revalidação ainda presa: não empilha segunda sonda.
    contas.listar_contas()

    assert time.monotonic() - inicio < 1
    assert [c.cota_5h for c in resposta.contas] == [0.1, 0.2]
    # O front lê este sinal pra reler e não deixar o número velho parado.
    assert resposta.revalidando is True
    assert sorted(sondadas) == ["chave-i", "chave-w"]

    libera.set()
    limite = time.monotonic() + 5
    while contas._revalidando and time.monotonic() < limite:
        time.sleep(0.01)
    fresca = contas.listar_contas()
    assert [c.cota_5h for c in fresca.contas] == [0.9, 0.9]
    assert fresca.revalidando is False


def test_cota_velha_demais_espera_a_sonda(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Passou do teto, o número não vai sem aviso: a leitura volta a esperar."""
    import time

    _duas_contas(tmp_path, monkeypatch)
    antigo = time.monotonic() - contas._CACHE_VELHO_MAX_S - 1
    contas._cota_cache.update({"incasa": (antigo, (0.1, 0.1)), "woodpro": (antigo, (0.2, 0.2))})
    monkeypatch.setattr(contas, "_sondar", lambda chave: (0.7, 0.7))

    resposta = contas.listar_contas()
    assert [c.cota_5h for c in resposta.contas] == [0.7, 0.7]
    assert resposta.revalidando is False


def test_revalidacao_que_falha_guarda_o_valor_velho(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(contas, "_cota_cache", {"incasa": (1.0, (0.4, 0.4))})
    monkeypatch.setattr(contas, "_revalidando", {"incasa"})

    def sonda_sem_rede(chave: str) -> tuple[float, float]:
        raise contas.httpx.ConnectError("sem rede")

    monkeypatch.setattr(contas, "_sondar", sonda_sem_rede)

    contas._revalidar("incasa", "chave-i")

    assert contas._cota_cache["incasa"] == (1.0, (0.4, 0.4))
    assert contas._revalidando == set()


def test_ler_cota_traz_uso_e_reset_das_duas_janelas():
    headers = {
        "anthropic-ratelimit-unified-5h-utilization": "0.15",
        "anthropic-ratelimit-unified-7d-utilization": "0.19",
        "anthropic-ratelimit-unified-5h-reset": "1790841000",
        "anthropic-ratelimit-unified-7d-reset": "1791172800",
        "anthropic-ratelimit-unified-reset": "1",
    }
    assert contas._ler_cota(headers) == (0.15, 0.19, 1790841000.0, 1791172800.0)


def test_ler_cota_sem_reset_ou_com_lixo_vira_none():
    headers = {
        "anthropic-ratelimit-unified-5h-utilization": "0.5",
        "anthropic-ratelimit-unified-5h-reset": "amanhã",
    }
    assert contas._ler_cota(headers) == (0.5, None, None, None)


def test_listar_devolve_o_reset_de_cada_conta(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _duas_contas(tmp_path, monkeypatch)
    monkeypatch.setattr(
        contas, "_sondar", lambda chave: (0.1, 0.2, 100.0 if chave == "chave-i" else 200.0, 300.0)
    )
    resposta = contas.listar_contas()
    assert [(c.id, c.reset_5h, c.reset_7d) for c in resposta.contas] == [
        ("incasa", 100.0, 300.0),
        ("woodpro", 200.0, 300.0),
    ]
