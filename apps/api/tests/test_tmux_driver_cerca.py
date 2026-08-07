"""Relaunch pelo painel tem de devolver a sessão pra dentro da cerca de memória.

Incidente 07/08/2026: a sessão `pavan` relançada às 12:43 nasceu em
`app.slice/tmux-spawn-*.scope` — fora de `borges-frota.slice` — porque
`_prepare_cli_launch` montava o comando do zero, sem o `systemd-run` que o
`ze-shared/scripts/subir-frota.sh` usa no boot. Sem `MemoryHigh`, o pico de um
fan-out virou OOM kill às 13:16 em vez de throttle.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import tmux_driver

WORKSPACE = "/home/clawd/repos/ze_claude/vinicius"
WORKSPACE_PAVAN = "/home/clawd/repos/ze_claude/pavan"


def test_relaunch_nasce_dentro_da_cerca() -> None:
    _, comando = tmux_driver._prepare_cli_launch(
        "vinicius", WORKSPACE, "claude_code", "opus",
    )
    assert comando.startswith(
        "systemd-run --user --scope --slice=borges-frota.slice "
        "-p MemoryHigh=1500M -- claude "
    )


def test_pavan_orquestra_e_ganha_teto_maior() -> None:
    """Pico medido num fan-out de 5: 2410 MiB — 1500M estrangularia (restart-ze.md)."""
    _, comando = tmux_driver._prepare_cli_launch(
        "pavan", WORKSPACE_PAVAN, "claude_code", "opus",
    )
    assert "-p MemoryHigh=3G -- claude " in comando


def test_resume_fica_do_lado_do_claude_nao_do_systemd_run() -> None:
    """Tudo depois do `--` é argumento do claude; antes, do systemd-run."""
    session_id = "2582ec0f-1abd-4d56-bd6c-c48eb6a8c16f"
    _, comando = tmux_driver._prepare_cli_launch(
        "pavan", WORKSPACE_PAVAN, "claude_code", "opus",
        resume_session_id=session_id,
    )
    antes, depois = comando.split(" -- ", 1)
    assert "--resume" not in antes
    assert depois.endswith(f"--resume {session_id}")


def test_codex_tambem_entra_na_cerca() -> None:
    _, comando = tmux_driver._prepare_cli_launch(
        "tara", WORKSPACE, "codex", "codex-gpt-5-6-sol",
    )
    assert comando.startswith(
        "systemd-run --user --scope --slice=borges-frota.slice "
        "-p MemoryHigh=1500M -- codex "
    )
