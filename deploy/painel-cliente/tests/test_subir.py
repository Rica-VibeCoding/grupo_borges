import importlib.util
import json
import os
import pwd
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "deploy/painel-cliente/subir.sh"
REMOTE = ROOT / "deploy/painel-cliente/subir-remoto.sh"


def run(*args, env=None):
    return subprocess.run(
        ["bash", str(SCRIPT), *args], cwd=ROOT, text=True, capture_output=True,
        env={**os.environ, **(env or {})}, check=False,
    )


def test_seco_nao_chama_ssh(tmp_path):
    fake = tmp_path / "ssh"
    fake.write_text("#!/bin/sh\nexit 99\n")
    fake.chmod(0o755)
    env = {"PATH": f"{tmp_path}:{os.environ['PATH']}", "PAINEL_LOCK": str(tmp_path / "lock")}
    for args in [(), ("--publicar",), ("--voltar", "fred")]:
        result = run("--seco", *args, env=env)
        assert result.returncode == 0, result.stderr
        assert "[seco]" in result.stdout


def test_trava_recusa_execucao_simultanea(tmp_path):
    lock = tmp_path / "lock"
    holder = subprocess.Popen(["flock", str(lock), "sleep", "5"])
    try:
        # flock do segundo processo espera até o primeiro adquirir a trava.
        for _ in range(100):
            probe = subprocess.run(["flock", "-n", str(lock), "true"], check=False)
            if probe.returncode:
                break
        else:
            raise AssertionError("trava não foi adquirida")
        result = run("--seco", env={"PAINEL_LOCK": str(lock)})
        assert result.returncode == 73
        assert "Outra subida" in result.stderr
    finally:
        holder.terminate()
        holder.wait()


def test_voltar_usa_snapshot_mais_recente(tmp_path):
    log = tmp_path / "incus.log"
    fake = tmp_path / "incus"
    fake.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$*\" >> \"$INCUS_LOG\"\n"
        "case \"$*\" in *'snapshot list'*) "
        "printf '%s\\n' '[{\"name\":\"painel-20261003T000000000000000Z-a\"},"
        "{\"name\":\"painel-20261004T000000000000000Z-b\"}]';; esac\n"
    )
    fake.chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "INCUS_LOG": str(log)}
    result = subprocess.run(
        ["bash", str(REMOTE), "voltar", "abc", "unused", "unused", "unused", "portao"],
        cwd=ROOT, env=env, text=True, capture_output=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    calls = log.read_text().splitlines()
    assert "snapshot list portao" in calls[0]
    assert "stop portao" in calls[1]
    assert "snapshot restore portao painel-20261004T000000000000000Z-b" in calls[2]
    assert "start portao" in calls[3]


def test_settings_mescla_sem_duplicar(tmp_path):
    spec = importlib.util.spec_from_file_location(
        "preparar_settings", ROOT / "deploy/painel-cliente/preparar-settings.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"env": {"EXISTENTE": "sim"}}))
    user = pwd.getpwuid(os.getuid()).pw_name
    module.main(path, user, ROOT / "deploy/painel-cliente/skills")
    first = path.read_text()
    module.main(path, user, ROOT / "deploy/painel-cliente/skills")
    assert path.read_text() == first
    data = json.loads(first)
    assert data["env"]["EXISTENTE"] == "sim"
    assert len(data["hooks"]["SessionStart"]) == 1
    assert len(data["hooks"]["UserPromptSubmit"]) == 1
    assert data["statusLine"]["command"].endswith("statusline-capture.py")
    for name in ("canal-cockpit", "conversa-por-voz"):
        assert (tmp_path / "skills" / name / "SKILL.md").is_file()
