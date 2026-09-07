"""Teste retroativo do fix de 07/09 (`9d12eda`) — o watchdog falava no socket errado.

`orchestrator/watchdog.py` é o único ponto do backend que chama o tmux por fora
do `services/tmux_driver`, e ia sem `-L`. Com um servidor por agente
(`borges-<sessão>`) o `capture-pane` volta `returncode != 0`, vira `None`, e o
watchdog para de ler o `STATE:` que fecha a tarefa. O sintoma é "tarefa nunca
conclui sozinha", não um erro — foi assim que passou despercebido, e é por isso
que o conserto precisa de teste: quem prova aqui é o argv montado, não o efeito.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orchestrator import watchdog


def _cria_socket_do_agente(raiz: Path, sessao: str) -> None:
    pasta = raiz / f"tmux-{os.getuid()}"
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / f"borges-{sessao}").touch()


def _grava_argv(monkeypatch, saida: str = "STATE: done\n") -> list[list[str]]:
    chamadas: list[list[str]] = []

    def fake_run(argv, **kwargs):
        chamadas.append(list(argv))
        return subprocess.CompletedProcess(argv, 0, stdout=saida, stderr="")

    monkeypatch.setattr(watchdog.subprocess, "run", fake_run)
    return chamadas


def test_capture_pane_vai_ao_socket_do_agente(tmp_path, monkeypatch) -> None:
    """Com `borges-<sessão>` no TMUX_TMPDIR, o comando leva `-L`."""
    monkeypatch.setenv("TMUX_TMPDIR", str(tmp_path))
    _cria_socket_do_agente(tmp_path, "tara")
    chamadas = _grava_argv(monkeypatch)

    assert watchdog._capture_pane("tara") == "STATE: done\n"
    assert chamadas[0][:4] == ["tmux", "-L", "borges-tara", "capture-pane"]


def test_capture_pane_cai_no_socket_compartilhado_sem_o_do_agente(tmp_path, monkeypatch) -> None:
    """Sem socket próprio, o plano B é o `tmux` puro — agente que não migrou."""
    monkeypatch.setenv("TMUX_TMPDIR", str(tmp_path))
    chamadas = _grava_argv(monkeypatch)

    assert watchdog._capture_pane("tara") == "STATE: done\n"
    assert chamadas[0][:2] == ["tmux", "capture-pane"]


def test_capture_pane_devolve_none_quando_o_tmux_recusa(tmp_path, monkeypatch) -> None:
    """`returncode != 0` vira None — era este o silêncio que escondia o defeito."""
    monkeypatch.setenv("TMUX_TMPDIR", str(tmp_path))

    def fake_run(argv, **kwargs):
        return subprocess.CompletedProcess(argv, 1, stdout="", stderr="no server running")

    monkeypatch.setattr(watchdog.subprocess, "run", fake_run)

    assert watchdog._capture_pane("tara") is None
