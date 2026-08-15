"""O denominador da entrega — grava, apara e nunca derruba a mensagem.

A tabela existe porque a taxa real de falha era impossível de medir (15/08):
registro só em memória, que some no restart, e access log sem timestamp.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from services import delivery_log


def _banco(tmp_path: Path) -> str:
    caminho = str(tmp_path / "teste.db")
    conn = sqlite3.connect(caminho)
    with conn:
        conn.execute(
            "CREATE TABLE delivery_attempts ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " session_name TEXT NOT NULL,"
            " outcome TEXT NOT NULL,"
            " reason TEXT,"
            " at_ms INTEGER NOT NULL)"
        )
    conn.close()
    return caminho


def _linhas(caminho: str) -> list[sqlite3.Row]:
    conn = sqlite3.connect(caminho)
    conn.row_factory = sqlite3.Row
    try:
        return list(conn.execute("SELECT * FROM delivery_attempts ORDER BY id"))
    finally:
        conn.close()


def test_grava_sucesso_e_recusa_com_o_motivo(tmp_path: Path) -> None:
    caminho = _banco(tmp_path)

    assert delivery_log.registra_tentativa(caminho, "daniel", "entregue", None, agora_ms=10)
    assert delivery_log.registra_tentativa(
        caminho, "canarinho", "recusado", "input_nao_observavel", agora_ms=20
    )

    linhas = _linhas(caminho)
    assert [(l["session_name"], l["outcome"], l["reason"]) for l in linhas] == [
        ("daniel", "entregue", None),
        ("canarinho", "recusado", "input_nao_observavel"),
    ]


def test_separa_recusado_de_incerto(tmp_path: Path) -> None:
    """O que falhou ANTES do paste não deixou nada no pane; o que falhou depois
    pode ter deixado. Somar os dois num número só apagaria a diferença que
    interessa pra investigar resíduo."""
    caminho = _banco(tmp_path)

    delivery_log.registra_tentativa(caminho, "a", "recusado", "sessao_ausente", agora_ms=1)
    delivery_log.registra_tentativa(caminho, "a", "incerto", "envio_nao_confirmado", agora_ms=2)

    assert [l["outcome"] for l in _linhas(caminho)] == ["recusado", "incerto"]


def test_apara_no_teto_e_mantem_as_mais_novas(tmp_path: Path, monkeypatch) -> None:
    caminho = _banco(tmp_path)
    monkeypatch.setattr(delivery_log, "TETO_DE_REGISTROS", 5)
    monkeypatch.setattr(delivery_log, "APARA_A_CADA", 4)
    monkeypatch.setattr(delivery_log, "_gravacoes_desde_a_apara", 0)

    for i in range(12):
        delivery_log.registra_tentativa(caminho, "a", "entregue", None, agora_ms=i)

    linhas = _linhas(caminho)
    assert len(linhas) <= delivery_log.TETO_DE_REGISTROS + delivery_log.APARA_A_CADA
    # o corte tira as mais VELHAS: o último gravado tem que continuar lá
    assert linhas[-1]["at_ms"] == 11


def test_falha_de_gravacao_nao_levanta_e_avisa_alto(tmp_path: Path, caplog) -> None:
    """Telemetria não pode derrubar a mensagem do Rica — mas também não pode
    falhar calada, que foi o defeito mais repetido do dia."""
    caminho = str(tmp_path / "sem-tabela.db")
    sqlite3.connect(caminho).close()

    with caplog.at_level("ERROR"):
        assert delivery_log.registra_tentativa(caminho, "a", "entregue", None) is False

    assert any("não gravei a tentativa de entrega" in r.message for r in caplog.records)


@pytest.mark.parametrize("desfecho", ["entregue", "recusado", "incerto"])
def test_aceita_os_tres_desfechos(tmp_path: Path, desfecho: str) -> None:
    caminho = _banco(tmp_path)

    assert delivery_log.registra_tentativa(caminho, "a", desfecho, None)  # type: ignore[arg-type]

    assert _linhas(caminho)[0]["outcome"] == desfecho
