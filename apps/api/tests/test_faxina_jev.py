import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import faxina_jev as jev


@pytest.fixture(autouse=True)
def isolate_state(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))


def item(path="tara/docs/antigo.md"):
    return {"caminho": path, "workspace": "tara", "tipo": "doc", "dias_parado": 30,
            "ultima_leitura": 1, "ultimo_commit": 1, "citado_em": []}


def report(destination="arquivar", motive="pesquisa_pontual", status="selected"):
    return {"decisions": {"d0_destino": {"status": status, "value": destination},
                          "d0_motivo": {"status": status, "value": motive}},
            "response": {"usage": {"cost": 0.00001}, "answers": {
                "d0_destino": {"probabilities": dict.fromkeys(["manter", "arquivar", "duplica", "incerto"], 0) | {destination: 0.9}},
                "d0_motivo": {"probabilities": dict.fromkeys(jev.MOTIVES, 0) | {motive: 0.9}},
            }}}


def test_duas_perguntas_independentes_e_so_metadados():
    payload = jev.request_for([item() | {"texto": "não transmitir", "segredo": "não transmitir"}])
    assert len(payload["questions"]) == 2
    assert all(q["type"] == "choice" for q in payload["questions"].values())
    assert "não transmitir" not in json.dumps(payload)
    assert "incerto" in payload["questions"]["d0_destino"]["criteria"]


def test_exit_2_preserva_documentos_com_parecer_seguro():
    result = jev.interpret([item()], report(), 2)[item()["caminho"]]
    assert result["jev_veredito"] == "arquivar"


@pytest.mark.parametrize("rc,status,value", [(0, "selected", "incerto")])
def test_abstencao_vira_null(rc, status, value):
    result = jev.interpret([item()], report(destination=value, status=status), rc)
    assert result[item()["caminho"]]["jev_veredito"] is None


def test_parecer_e_motivo_legivel():
    result = jev.interpret([item()], report(), 0)[item()["caminho"]]
    assert result == {"jev_veredito": "arquivar", "jev_probabilidade": 0.9,
                      "jev_motivo": "Pesquisa pontual", "jev_duplica_de": None}


def test_exibicao_preserva_probabilidade_sem_renormalizar():
    assert jev.displayed_choice({"probabilities": {"manter": 0.63, "incerto": 0.37, "arquivar": 0}},
                                {"manter", "arquivar", "duplica"}) == ("manter", 0.63)
    assert jev.displayed_choice({"probabilities": {"manter": 0.2, "arquivar": 0.01, "incerto": 0.79}},
                                {"manter", "arquivar", "duplica"}) == ("manter", 0.2)
    assert jev.displayed_choice({"probabilities": {"manter": 0.15, "arquivar": 0.02, "incerto": 0.83}},
                                {"manter", "arquivar", "duplica"}) == (None, None)


def test_chave_apenas_no_ambiente_do_subprocesso(monkeypatch, tmp_path):
    monkeypatch.setattr(jev, "openrouter_key", lambda: "segredo-ficticio")
    captured = []

    def run(args, **kwargs):
        captured.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout=json.dumps(report()), stderr="")

    monkeypatch.setattr(jev.subprocess, "run", run)
    verdicts, usage = jev.evaluate([item()], repo=tmp_path)
    assert verdicts[item()["caminho"]]["jev_veredito"] == "arquivar"
    assert usage == [{"cost": 0.00001}]
    args, kwargs = captured[0]
    assert kwargs["env"]["OPENROUTER_API_KEY"] == "segredo-ficticio"
    assert "segredo-ficticio" not in json.dumps(args) + kwargs["input"]
    assert "cabecalhos" not in kwargs["input"]


def test_http_402_interrompe_sem_repetir(monkeypatch, tmp_path):
    monkeypatch.setattr(jev, "openrouter_key", lambda: "ficticio")
    calls = []

    def run(*args, **kwargs):
        calls.append(1)
        return SimpleNamespace(returncode=1, stdout="", stderr="OpenRouter HTTP 402")

    monkeypatch.setattr(jev.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="HTTP 402"):
        jev.evaluate([item()], repo=tmp_path)
    assert len(calls) == 1


def test_sem_candidatos_nao_abre_cofre(monkeypatch, tmp_path):
    def forbidden():
        raise AssertionError("não deve abrir cofre")

    monkeypatch.setattr(jev, "openrouter_key", forbidden)
    assert jev.evaluate([], repo=tmp_path) == ({}, [])


@pytest.mark.parametrize("secret", ["sk-exemplo", "sb_secret_ficticio", "token", "senha",
    "password", "api key", "Bearer", "a" * 32, "QWxhZGRpbjpvcGVuIHNlc2FtZVBhcmFUZXN0ZQ=="])
def test_linha_suspeita_removida_sem_descartar_resto(tmp_path, secret):
    path = tmp_path / item()["caminho"]
    path.parent.mkdir(parents=True)
    path.write_text("# Título\nProsa permitida\n## Seção\n" + secret)
    result = jev.excerpt(tmp_path, item())
    assert result["cabecalhos"] == ["# Título", "## Seção"]
    assert result["trecho"] == "Prosa permitida"
    assert secret not in json.dumps(result)


def test_titulo_cabecalhos_e_trecho_limitado(tmp_path):
    path = tmp_path / item()["caminho"]
    path.parent.mkdir(parents=True)
    path.write_text("# Título\nTexto autorizado. " * 200 + "\n## Seção\n### Subseção\n#### Detalhe")
    result = jev.excerpt(tmp_path, item())
    assert result["titulo"] == "# Título"
    assert len(result["trecho"]) == 1500
    assert "#### Detalhe" in result["cabecalhos"]


@pytest.mark.parametrize("path", ["ze-shared/vault/nota.md", "tara/docs/.env", "tara/docs/.env.local"])
def test_arquivo_proibido_nunca_entra_no_lote(tmp_path, monkeypatch, path):
    target = tmp_path / path
    target.parent.mkdir(parents=True)
    target.write_text("# Conteúdo que não pode sair")
    candidate = item(path)
    assert jev.excerpt(tmp_path, candidate) == {}

    def forbidden():
        raise AssertionError("nem deve abrir o cofre de autenticação")

    monkeypatch.setattr(jev, "openrouter_key", forbidden)
    assert jev.evaluate([candidate], repo=tmp_path) == ({}, [])


def test_modo_metadados_nao_le_documento(tmp_path, monkeypatch):
    monkeypatch.setattr(jev, "openrouter_key", lambda: "ficticio")

    def forbidden(*args):
        raise AssertionError("conteúdo não deve ser lido")

    monkeypatch.setattr(jev, "excerpt", forbidden)
    monkeypatch.setattr(jev.subprocess, "run", lambda *args, **kwargs:
        SimpleNamespace(returncode=0, stdout=json.dumps(report()), stderr=""))
    assert jev.evaluate([item()], repo=tmp_path, include_content=False)[0]
