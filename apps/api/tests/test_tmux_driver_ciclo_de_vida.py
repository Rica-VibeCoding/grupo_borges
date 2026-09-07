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
    assert diario == [
        "systemctl --user stop cockpit-ligar-felipe.service",
        # Sem sessão a unit durável ainda pode estar `activating` — é o intervalo
        # em que ela repõe o agente. Perguntar custa uma chamada sem sudo.
        "systemctl is-active borges-clawd@felipe.service",
    ]


def _desliga_com_unit_ativa(session_name: str, diario: list[str]) -> dict[str, object]:
    def registra(argv, **_kwargs):
        diario.append(" ".join(argv))
        ativa = argv[:2] == ["systemctl", "is-active"]
        return subprocess.CompletedProcess(argv, 0, "active\n" if ativa else "", "")

    with (
        patch("services.tmux_driver.subprocess.run", side_effect=registra),
        patch("services.tmux_driver._server_for", return_value=_servidor(True, diario)),
    ):
        return tmux_driver._shutdown_agent_sync(session_name)


def test_desligar_para_a_unit_duravel_antes_de_encerrar_a_sessao() -> None:
    """Incidente 06/09/2026: o agente religava sozinho seis segundos depois.

    A frota migrada pra Oracle roda sob `borges-clawd@<agente>.service`, que tem
    `Restart=always`. Matar a sessão tmux era, pro systemd, o agente caindo — e
    ele repunha. O journal do barsi guardou as três tentativas do Rica em
    `Scheduled restart job, restart counter is at 3`.
    """
    diario: list[str] = []
    resultado = _desliga_com_unit_ativa("barsi", diario)

    assert resultado["unit_parada"] is True
    parada = diario.index("sudo -n systemctl stop borges-clawd@barsi.service")
    # Antes do kill-session, senão o supervisor repõe o que acabamos de matar.
    assert parada < diario.index("kill-session barsi")


def test_agente_sem_unit_duravel_nao_gasta_sudo() -> None:
    """Quem ainda não migrou desliga pelo caminho de sempre: tmux + scopes."""
    diario: list[str] = []

    def sem_unit(argv, **_kwargs):
        diario.append(" ".join(argv))
        ativa = argv[:2] == ["systemctl", "is-active"]
        return subprocess.CompletedProcess(argv, 0 if ativa else 5, "inactive\n" if ativa else "", "")

    with (
        patch("services.tmux_driver.subprocess.run", side_effect=sem_unit),
        patch("services.tmux_driver._server_for", return_value=_servidor(True, diario)),
    ):
        resultado = tmux_driver._shutdown_agent_sync("lucas")

    assert resultado["unit_parada"] is False
    assert not any(linha.startswith("sudo") for linha in diario)


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


def test_boot_nao_leva_o_servidor_tmux_junto_ao_terminar() -> None:
    """Incidente 07/09/2026: o agente caía sozinho minutos depois de ligar.

    O `subir-frota.sh` cria o servidor tmux DENTRO do cgroup da unit de boot.
    Com o `KillMode=control-group` que o systemd assume por padrão, o fim do
    script matava todo o cgroup — servidor tmux e agente junto. Daniel e Pavan
    dividiam o socket `default`, então cada boot derrubava os dois.
    """
    with (
        patch("services.tmux_driver._shutdown_agent_sync", return_value={}),
        patch("services.tmux_driver.subprocess.run") as roda,
        patch("services.tmux_driver._LIGAR_TIMEOUT_S", 0.0),
    ):
        roda.return_value = subprocess.CompletedProcess([], 0, "", "")
        tmux_driver._boot_agent_sync("canario")

    argv = roda.call_args.args[0]
    assert "-p" in argv, "o boot precisa declarar propriedade na unit transiente"
    assert argv[argv.index("-p") + 1] == "KillMode=process"


def test_boot_espera_a_unit_anterior_sair_do_registro() -> None:
    """O `KillMode=process` deixa a unit do boot anterior carregada.

    Ela segura o servidor tmux no cgroup e só sai do registro ~50ms depois de o
    `_shutdown_agent_sync` acima matar esse servidor. Disparar o `systemd-run`
    dentro dessa janela é recusado por nome já registrado, e o Rica via "boot já
    está em curso" num agente parado — o botão só pegava no segundo clique.
    """
    ordem: list[str] = []
    estados = iter(["loaded", "not-found"])

    def registra(argv, **_kwargs):
        if argv[:3] == ["systemctl", "--user", "show"]:
            estado = next(estados, "not-found")
            ordem.append(f"consulta:{estado}")
            return subprocess.CompletedProcess(argv, 0, f"{estado}\n", "")
        ordem.append(argv[0])
        return subprocess.CompletedProcess(argv, 0, "", "")

    with (
        patch("services.tmux_driver._shutdown_agent_sync", return_value={}),
        patch("services.tmux_driver.subprocess.run", side_effect=registra),
        patch("services.tmux_driver._LIGAR_TIMEOUT_S", 0.0),
    ):
        tmux_driver._boot_agent_sync("canario")

    assert "consulta:loaded" in ordem, "o boot precisa conferir se a unit anterior saiu"
    assert ordem.index("systemd-run") > ordem.index("consulta:not-found"), (
        "o `systemd-run` foi disparado com a unit anterior ainda registrada"
    )
