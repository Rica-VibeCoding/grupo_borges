from __future__ import annotations

import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
WRAPPER = REPO_ROOT / "scripts" / "tara-codex"


def test_turno_do_cockpit_invoca_habilidade_nativa(tmp_path: Path) -> None:
    env = os.environ | {
        "CODEX_BIN": "echo",
        "COCKPIT_URL": "http://127.0.0.1:9",
        "TARA_THREAD_DIR": str(tmp_path),
    }

    result = subprocess.run(
        [
            "bash",
            str(WRAPPER),
            "--delegator",
            "cockpit",
            "-C",
            "/tmp",
            "--",
            "oi Tara",
        ],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Use a habilidade `canal-cockpit` antes de responder." in result.stderr


def test_retomada_do_cockpit_invoca_habilidade_nativa(tmp_path: Path) -> None:
    env = os.environ | {
        "CODEX_BIN": "echo",
        "COCKPIT_URL": "http://127.0.0.1:9",
        "TARA_THREAD_DIR": str(tmp_path),
    }

    result = subprocess.run(
        [
            "bash",
            str(WRAPPER),
            "--delegator",
            "cockpit",
            "--resume-thread",
            "019ff227-53e7-7942-bd9f-bfe9670410e8",
            "-C",
            "/tmp",
            "--",
            "oi Tara",
        ],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Use a habilidade `canal-cockpit` antes de responder." in result.stderr
    assert "resume 019ff227-53e7-7942-bd9f-bfe9670410e8" in result.stderr
