import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import faxina_jev as jev


def item(path="tara/docs/antigo.md"):
    return {"caminho": path, "workspace": "tara", "tipo": "doc", "dias_parado": 30,
            "ultima_leitura": 1, "ultimo_commit": 1, "citado_em": []}


def report(destination="arquivar", motive="pesquisa_pontual", status="selected"):
    return {"decisions": {"d0_destino": {"status": status, "value": destination},
                          "d0_motivo": {"status": status, "value": motive}},
            "response": {"usage": {"cost": 0.00001}}}


def test_duas_perguntas_independentes_e_so_metadados():
    payload = jev.request_for([item() | {"texto": "não transmitir", "segredo": "não transmitir"}])
    assert len(payload["questions"]) == 2
    assert all(q["type"] == "choice" for q in payload["questions"].values())
    assert "não transmitir" not in json.dumps(payload)
    assert "incerto" in payload["questions"]["d0_destino"]["criteria"]


@pytest.mark.parametrize("rc,status,value", [(2, "selected", "arquivar"),
    (0, "needs_review", "arquivar"), (0, "selected", "incerto")])
def test_abstencao_vira_null(rc, status, value):
    result = jev.interpret([item()], report(destination=value, status=status), rc)
    assert result[item()["caminho"]]["jev_veredito"] is None


def test_parecer_e_motivo_legivel():
    result = jev.interpret([item()], report(), 0)[item()["caminho"]]
    assert result == {"jev_veredito": "arquivar", "jev_motivo": "Pesquisa pontual", "jev_duplica_de": None}


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
def test_cabecalho_bloqueado_se_qualquer_linha_suspeita(tmp_path, secret):
    path = tmp_path / item()["caminho"]
    path.parent.mkdir(parents=True)
    path.write_text("# Título\nProsa qualquer\n## Seção\n" + secret)
    assert jev.headings(tmp_path, item()) == []


def test_so_cabecalhos_sem_prosa(tmp_path):
    path = tmp_path / item()["caminho"]
    path.parent.mkdir(parents=True)
    path.write_text("# Título\nTexto privado não enviado\n## Seção\n### Subseção\n#### Detalhe")
    assert jev.headings(tmp_path, item()) == ["# Título", "## Seção", "### Subseção"]
