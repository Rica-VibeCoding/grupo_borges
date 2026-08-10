"""Ligar → Desligar → Ligar em meio minuto tem de religar o agente.

Incidente 10/08/2026: o Rica ligou o Felipe pelo painel, desligou trinta
segundos depois, e o Ligar seguinte foi recusado. O `subir-frota.sh` espera o
canal carregar por até 90s; desligar dentro dessa janela deixava a unit
`cockpit-ligar-<sessao>` viva, esperando um pane que não voltaria mais, e o
systemd negava o nome ao boot novo — com a frase crua dele vazando pra tela.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import tmux_driver


def _servidor(tem_sessao: bool, diario: list[str]) -> SimpleNamespace:
    return SimpleNamespace(
        has_session=lambda _nome: tem_sessao,
        kill_session=lambda nome: diario.append(f"kill-session {nome}"),
        sessions=SimpleNamespace(get=lambda **_: SimpleNamespace(windows=[])),
    )


def _desliga(session_name: str, tem_sessao: bool, diario: list[str]) -> dict[str, object]:
    def registra(argv, **_kwargs):
        diario.append(" ".join(argv))
        return subprocess.CompletedProcess(argv, 0, "", "")

    with (
        patch("services.tmux_driver.subprocess.run", side_effect=registra),
        patch("services.tmux_driver._server_for", return_value=_servidor(tem_sessao, diario)),
    ):
        return tmux_driver._shutdown_agent_sync(session_name)


def test_desligar_cancela_o_boot_em_curso_antes_de_encerrar_a_sessao() -> None:
    diario: list[str] = []
    resultado = _desliga("canario", True, diario)

    assert resultado["boot_cancelado"] is True
    # A ordem é o conserto: cancelar depois de matar a sessão deixaria o script
    # esperando um pane que não volta, e o nome da unit trancado até ele desistir.
    assert diario[0] == "systemctl --user stop cockpit-ligar-canario.service"
    assert diario[-1] == "kill-session canario"


def test_desligar_de_agente_ja_parado_ainda_cancela_o_boot_pendurado() -> None:
    """Sem sessão é justamente quando a unit sobra — foi o caso do Rica."""
    diario: list[str] = []
    resultado = _desliga("felipe", False, diario)

    assert resultado["boot_cancelado"] is True
    assert resultado["attempted"] is False
    assert diario == ["systemctl --user stop cockpit-ligar-felipe.service"]


def test_desligar_sem_boot_em_curso_nao_inventa_cancelamento() -> None:
    diario: list[str] = []

    def sem_unit(argv, **_kwargs):
        diario.append(" ".join(argv))
        return subprocess.CompletedProcess(argv, 5, "", "Unit not loaded.")

    with (
        patch("services.tmux_driver.subprocess.run", side_effect=sem_unit),
        patch("services.tmux_driver._server_for", return_value=_servidor(False, diario)),
    ):
        resultado = tmux_driver._shutdown_agent_sync("lucas")

    assert resultado["boot_cancelado"] is False


def test_nome_de_sessao_forjado_nao_vira_argumento_de_systemctl() -> None:
    with patch("services.tmux_driver.subprocess.run") as roda:
        assert tmux_driver._stop_boot_unit("canario; rm -rf /") is False
    roda.assert_not_called()


def test_unit_ja_registrada_vira_boot_em_curso_e_nao_erro_cru() -> None:
    """O systemd tem duas frases pro mesmo estado; casar só uma vazava a outra."""
    recusa = subprocess.CompletedProcess(
        [],
        1,
        "",
        "Failed to start transient service unit: Unit cockpit-ligar-canario.service "
        "was already loaded or has a fragment file.",
    )

    with (
        patch("services.tmux_driver._shutdown_agent_sync", return_value={}),
        patch("services.tmux_driver.subprocess.run", return_value=recusa),
    ):
        try:
            tmux_driver._boot_agent_sync("canario")
        except tmux_driver.TmuxSessionBusyError as exc:
            assert "já está em curso" in str(exc)
        else:  # pragma: no cover - o teste só passa pela exceção certa
            raise AssertionError("boot recusado devia virar TmuxSessionBusyError")
