import os
from pathlib import Path
import shutil
import subprocess

SOURCE = Path(__file__).resolve().parents[3] / "scripts/faxina-semanal.sh"


def setup(tmp_path, fail=False):
    base = tmp_path / "repo"
    script = base / "scripts/faxina-semanal.sh"
    script.parent.mkdir(parents=True)
    shutil.copyfile(SOURCE, script)
    python = base / "apps/api/.venv/bin/python"
    python.parent.mkdir(parents=True)
    python.write_text('#!/bin/bash\nprintf "rodou\\n" >> "$XDG_STATE_HOME/chamadas"\n' +
                      ('exit 1\n' if fail else 'printf \'{"modo":"relatorio","novos":0}\\n\'\n'))
    python.chmod(0o755)
    env = os.environ | {"XDG_STATE_HOME": str(tmp_path / "state")}
    return script, env, tmp_path / "state/faxina-frota"


def test_uma_passagem_por_semana(tmp_path):
    script, env, state = setup(tmp_path)
    for _ in range(2):
        result = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True)
        assert result.returncode == 0
    assert (state.parent / "chamadas").read_text().splitlines() == ["rodou"]
    assert "-W" in (state / "ultima-semana").read_text()
    assert '"novos":0' in (state / "run.log").read_text()


def test_falha_nao_marca_semana(tmp_path):
    script, env, state = setup(tmp_path, fail=True)
    result = subprocess.run(["bash", str(script)], env=env, capture_output=True)
    assert result.returncode == 1
    assert not (state / "ultima-semana").exists()


def test_trava_evitar_segunda_execucao(tmp_path):
    import fcntl

    script, env, state = setup(tmp_path)
    state.mkdir(parents=True)
    with (state / "lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = subprocess.run(["bash", str(script)], env=env, capture_output=True)
    assert result.returncode == 0
    assert not (state.parent / "chamadas").exists()
