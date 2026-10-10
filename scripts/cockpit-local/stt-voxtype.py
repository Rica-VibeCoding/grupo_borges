#!/usr/bin/python3
"""Contrato GB_STT_SCRIPT: arquivo em argv[1], só transcrição em stdout."""
from __future__ import annotations

import fcntl
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# A API mata o script em 30 s. Este prazo inclui conversão e libera os filhos
# (inclusive o worker da GPU) antes disso, também quando o Voxtype falha.
TIMEOUT_SECONDS = 28
LOCK_PATH = Path(f"/run/user/{os.getuid()}/cockpit-voxtype.lock")


def run(command: list[str], deadline: float) -> str:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(command, TIMEOUT_SECONDS)
    with subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        errors="replace", start_new_session=True,
        env={**os.environ, "RUST_LOG": "off"},
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=remaining)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate()
        if stderr:
            print(stderr[-8192:].strip(), file=sys.stderr)
        if process.returncode:
            raise RuntimeError(f"{Path(command[0]).name}: saída {process.returncode}")
        return stdout


def transcription(stdout: str) -> str:
    # Voxtype 1.0.1 imprime cabeçalhos mesmo com --quiet (println!, não logs).
    # src/app/transcribe_file.rs: depois de Processing/VAD, uma linha vazia
    # separa o texto final. Nunca transformar cabeçalho/ausência de fala em texto.
    header, separator, text = stdout.partition("\n\n")
    if not separator or not any(line.startswith("Processing ") for line in header.splitlines()):
        raise RuntimeError("Voxtype não retornou uma transcrição no formato esperado")
    text = text.strip()
    if not text:
        raise RuntimeError("Voxtype retornou transcrição vazia")
    return text


def main() -> int:
    if len(sys.argv) != 2 or not Path(sys.argv[1]).is_file():
        print("Uso: stt-voxtype.py <arquivo de áudio existente>", file=sys.stderr)
        return 2
    deadline = time.monotonic() + TIMEOUT_SECONDS
    # Serializa apenas os transcritores do cockpit; não controla o daemon.
    try:
        with LOCK_PATH.open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("Transcritor local ocupado; tente novamente", file=sys.stderr)
                return 75
            with tempfile.TemporaryDirectory(prefix="cockpit-stt-") as folder:
                wav = str(Path(folder) / "audio.wav")
                run([
                    "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                    "-y", "-i", str(Path(sys.argv[1]).resolve()), "-vn",
                    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav,
                ], deadline)
                text = transcription(run(["/usr/bin/voxtype", "--quiet", "transcribe", wav], deadline))
            print(text)
        return 0
    except subprocess.TimeoutExpired:
        print("STT local excedeu o prazo de 28 s", file=sys.stderr)
        return 124
    except (OSError, RuntimeError) as error:
        print(f"STT local falhou: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
