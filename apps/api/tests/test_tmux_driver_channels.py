"""Relaunch não pode perpetuar mudez: quem já estava sem canal precisa voltar com ele.

`52cecac` fez o relaunch recuperar `--channels` do `/proc` do processo vivo, o
que resolve o caso comum. Sobrou o estado absorvente: se o processo vivo JÁ
estava sem canal, a leitura devolve vazio, o relaunch sobe outro sem canal, e
cada nova tentativa repete a falta. Relançar — justamente o que a gente faz pra
consertar — vira o que mantém o agente surdo.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import tmux_driver


def _proc_falso(
    cmdlines: dict[int, list[str]],
    foreground: dict[int, int] | None = None,
) -> type:
    """Substitui `Path` por um `/proc` de mentira, sem tocar em processo real."""
    mapa_fg = foreground or {}

    class _PathFalso:
        def __init__(self, caminho: str) -> None:
            self.caminho = str(caminho)

        @property
        def _pid(self) -> int:
            return int(self.caminho.split("/")[2])

        def read_text(self) -> str:
            if not self.caminho.endswith("/stat"):
                raise OSError("só /stat responde a read_text")
            # Layout real: depois de ") " vem state, ppid, pgrp, session,
            # tty_nr, tpgid — o índice 5 é o grupo foreground que o código lê.
            return f"{self._pid} (bash) S 1 1 1 0 {mapa_fg.get(self._pid, 0)} 0 0"

        def read_bytes(self) -> bytes:
            argv = cmdlines.get(self._pid)
            if argv is None:
                raise OSError("processo não existe")
            return ("\0".join(argv) + "\0").encode()

    return _PathFalso


CANAL = "plugin:telegram@claude-plugins-official"


def test_recupera_canal_do_processo_vivo(monkeypatch: pytest.MonkeyPatch) -> None:
    """Caso que o 52cecac já cobria — guarda contra regressão."""
    monkeypatch.setattr(
        tmux_driver,
        "Path",
        _proc_falso({4242: ["claude", "--dangerously-skip-permissions", "--channels", CANAL]}),
    )
    assert tmux_driver._pane_channel_flags(4242) == f" --channels {CANAL}"


def test_processo_sem_canal_nao_devolve_vazio(monkeypatch: pytest.MonkeyPatch) -> None:
    """O bug: processo vivo mudo fazia o relaunch nascer mudo também."""
    monkeypatch.setattr(
        tmux_driver,
        "Path",
        _proc_falso({4242: ["claude", "--dangerously-skip-permissions"]}),
    )
    recuperado = tmux_driver._pane_channel_flags(4242)
    assert recuperado != "", "sem canal no processo vivo, o relaunch precisa do valor canônico"
    assert CANAL in recuperado


def test_proc_ilegivel_nao_devolve_vazio(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sem `/proc` pra ler, o certo continua sendo subir com canal."""
    monkeypatch.setattr(tmux_driver, "Path", _proc_falso({}))
    assert CANAL in tmux_driver._pane_channel_flags(4242)


def test_canal_de_desenvolvimento_extra_sobrevive(monkeypatch: pytest.MonkeyPatch) -> None:
    """Quem carrega canal a mais não pode perder o extra pro valor canônico."""
    monkeypatch.setattr(
        tmux_driver,
        "Path",
        _proc_falso(
            {
                4242: [
                    "claude",
                    "--channels",
                    CANAL,
                    "--dangerously-load-development-channels",
                    "plugin:whatsapp-rica@local",
                ]
            }
        ),
    )
    recuperado = tmux_driver._pane_channel_flags(4242)
    assert f"--channels {CANAL}" in recuperado
    assert "--dangerously-load-development-channels plugin:whatsapp-rica@local" in recuperado
