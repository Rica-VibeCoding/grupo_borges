"""O carimbo de "o Rica desligou de propósito" — grava, apaga e não derruba nada.

Existe porque o vigia (`watchdog-sessao-travada.py`) contava como MORTE toda
sessão que estava de pé e sumiu, sem distinguir queda de decisão dele: o agente
voltava sozinho e o WhatsApp dele tocava em cima da própria ordem. O carimbo é o
que separa os dois casos, e é lido por OUTRO processo — então o que estes testes
provam é o contrato do arquivo, não o formato interno.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from services import desligamento_deliberado as dd


def _aponta(monkeypatch, tmp_path: Path) -> Path:
    """Redundante com a cerca `autouse` do conftest, e de propósito: estes
    testes são sobre o arquivo, e precisam do endereço na mão."""
    alvo = tmp_path / "canal" / ".desligados-de-proposito.json"
    monkeypatch.setattr(dd, "CAMINHO", alvo)
    monkeypatch.setattr(dd, "TRAVA", alvo.with_suffix(".lock"))
    return alvo


def test_marcar_cria_o_arquivo_e_o_slug(monkeypatch, tmp_path):
    alvo = _aponta(monkeypatch, tmp_path)
    dd.marcar("barsi")
    dados = json.loads(alvo.read_text(encoding="utf-8"))
    assert list(dados) == ["barsi"]
    assert dados["barsi"]["por"] == "cockpit"
    assert isinstance(dados["barsi"]["em"], int)


def test_marcar_preserva_quem_ja_estava(monkeypatch, tmp_path):
    alvo = _aponta(monkeypatch, tmp_path)
    dd.marcar("barsi")
    dd.marcar("felipe")
    assert set(json.loads(alvo.read_text(encoding="utf-8"))) == {"barsi", "felipe"}


def test_desmarcar_tira_so_o_pedido(monkeypatch, tmp_path):
    alvo = _aponta(monkeypatch, tmp_path)
    dd.marcar("barsi")
    dd.marcar("felipe")
    dd.desmarcar("barsi")
    assert set(json.loads(alvo.read_text(encoding="utf-8"))) == {"felipe"}


def test_desmarcar_quem_nao_esta_nao_quebra(monkeypatch, tmp_path):
    _aponta(monkeypatch, tmp_path)
    dd.desmarcar("ninguem")  # arquivo nem existe ainda


def test_json_corrompido_nao_derruba_o_desligar(monkeypatch, tmp_path):
    """Pior caso é o vigia voltar a ser o de antes — nunca o Desligar falhar."""
    alvo = _aponta(monkeypatch, tmp_path)
    alvo.parent.mkdir(parents=True, exist_ok=True)
    alvo.write_text("{ isto não é json", encoding="utf-8")
    dd.marcar("barsi")
    assert set(json.loads(alvo.read_text(encoding="utf-8"))) == {"barsi"}


def test_pasta_sem_permissao_nao_levanta(monkeypatch, tmp_path):
    """Instrumento que falha não pode levar junto a ação que instrumenta."""
    travada = tmp_path / "sem-permissao"
    travada.mkdir()
    monkeypatch.setattr(dd, "CAMINHO", travada / "sub" / "carimbo.json")
    monkeypatch.setattr(dd, "TRAVA", travada / "sub" / "carimbo.lock")
    os.chmod(travada, 0o500)
    try:
        dd.marcar("barsi")      # não levanta
        dd.desmarcar("barsi")   # idem
    finally:
        os.chmod(travada, 0o700)


def test_gravacao_nao_deixa_temporario_para_tras(monkeypatch, tmp_path):
    alvo = _aponta(monkeypatch, tmp_path)
    dd.marcar("barsi")
    dd.desmarcar("barsi")
    sobrando = [p.name for p in alvo.parent.iterdir() if p.name.endswith(".tmp")]
    assert sobrando == []
