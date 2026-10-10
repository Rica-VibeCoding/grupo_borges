"""Script STT local: contrato de stdout, WAV real, prazo e isolamento."""
from __future__ import annotations

import fcntl
import importlib.util
import subprocess
import sys
import time
import wave
from pathlib import Path
from unittest.mock import patch

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts/cockpit-local/stt-voxtype.py"
spec = importlib.util.spec_from_file_location("stt_voxtype", SCRIPT)
stt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stt)
OUTPUT = 'Loading audio file: "audio.wav"\nAudio format: 16000 Hz, 1 channel(s), Int\nProcessing 16000 samples (1.00s)...\n\nOlá, Rica.\nSegunda linha.\n'


@pytest.fixture(autouse=True)
def lock_fora_do_runtime(tmp_path, monkeypatch):
    monkeypatch.setattr(stt, "LOCK_PATH", tmp_path / "voxtype.lock")


def test_script_converte_audio_real_e_devolve_so_texto(tmp_path, monkeypatch, capsys):
    source = tmp_path / "entrada com espaço.wav"
    with wave.open(str(source), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(48000)
        audio.writeframes(b"\0" * 48000 * 4)
    original_run = stt.run
    temporary = []

    def run(command, deadline):
        if command[0] == "ffmpeg":
            return original_run(command, deadline)
        assert command[:3] == ["/usr/bin/voxtype", "--quiet", "transcribe"]
        with wave.open(command[-1], "rb") as wav:
            assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (16000, 1, 2)
        temporary.append(Path(command[-1]))
        return OUTPUT

    monkeypatch.setattr(stt, "run", run)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), str(source)])
    assert stt.main() == 0
    assert capsys.readouterr().out == "Olá, Rica.\nSegunda linha.\n"
    assert not temporary[0].parent.exists()


@pytest.mark.parametrize("output", [
    "Processing 16000 samples (1.00s)...\nNo speech detected, skipping transcription.\n",
    "Processing 16000 samples (1.00s)...\n\n \n",
    "Cabeçalho inesperado\n\nNão deve chegar ao agente.\n",
])
def test_nao_transcreve_cabecalho_ou_ausencia_de_fala(output):
    with pytest.raises(RuntimeError):
        stt.transcription(output)


def test_falha_do_voxtype_nao_vaza_stdout_e_limpa_wav(tmp_path, monkeypatch, capsys):
    source = tmp_path / "entrada.oga"
    source.write_bytes(b"audio")
    temporary = []

    def run(command, deadline):
        temporary.append(Path(command[-1]))
        if command[0] == "/usr/bin/voxtype":
            raise RuntimeError("voxtype: saída -11")
        return ""

    monkeypatch.setattr(stt, "run", run)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), str(source)])
    assert stt.main() == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert "saída -11" in output.err
    assert not temporary[0].parent.exists()


def test_prazo_mata_e_recolhe_processo(tmp_path):
    pid_file = tmp_path / "pid"
    command = [sys.executable, "-c", "import os,time,sys; open(sys.argv[1],'w').write(str(os.getpid())); time.sleep(60)", str(pid_file)]
    with pytest.raises(subprocess.TimeoutExpired):
        stt.run(command, time.monotonic() + 0.5)
    assert not Path(f"/proc/{pid_file.read_text()}").exists()


def test_transcritores_simultaneos_falham_sem_chamar_gpu(tmp_path, monkeypatch, capsys):
    source = tmp_path / "entrada.wav"
    source.write_bytes(b"audio")
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), str(source)])
    with stt.LOCK_PATH.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with patch.object(stt, "run", side_effect=AssertionError("GPU não deve ser chamada")):
            assert stt.main() == 75
    assert capsys.readouterr().out == ""
