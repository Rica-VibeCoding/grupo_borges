import importlib.util
import json
import os
import pwd
import subprocess
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / "deploy/painel-cliente"
HOOK = DEPLOY / "painel-skill-hook.sh"


@pytest.fixture
def session_id():
    value = uuid.uuid4().hex
    yield value
    for kind in ("cockpit", "voz"):
        (Path("/tmp") / f"painel-{kind}-skill-loaded-{value}.flag").unlink(missing_ok=True)


def run_hook(prompt, session_id, transcript):
    result = subprocess.run(
        ["bash", str(HOOK)],
        input=json.dumps({
            "hook_event_name": "UserPromptSubmit",
            "prompt": prompt,
            "session_id": session_id,
            "transcript_path": str(transcript),
        }),
        text=True, capture_output=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    if not result.stdout:
        return ""
    output = json.loads(result.stdout)["hookSpecificOutput"]
    assert output["hookEventName"] == "UserPromptSubmit"
    return output["additionalContext"]


def test_primeira_mensagem_dispara_canal_so_uma_vez(tmp_path, session_id):
    transcript = tmp_path / "transcript.jsonl"
    assert "`canal-cockpit`" in run_hook("Olá", session_id, transcript)
    assert run_hook("Outra mensagem", session_id, transcript) == ""


def test_telegram_nao_dispara_e_voz_dispara(tmp_path, session_id):
    transcript = tmp_path / "transcript.jsonl"
    assert run_hook('  <channel source="plugin:telegram">Olá', session_id, transcript) == ""
    assert run_hook('<channel source="plugin:whatsapp">Olá', session_id, transcript) == ""
    assert "`conversa-por-voz`" in run_hook("🗣 Bom dia", session_id, transcript)
    assert run_hook("🗣 Outra fala", session_id, transcript) == ""
    assert "`canal-cockpit`" in run_hook("Mensagem do painel", session_id, transcript)


@pytest.mark.parametrize("prompt,heading", [
    ("Mensagem do painel", "# Canal Cockpit"),
    ("🗣 Oi", "# Conversa por voz"),
])
def test_recola_skill_apos_compactacao(tmp_path, session_id, prompt, heading):
    transcript = tmp_path / "transcript.jsonl"
    assert run_hook(prompt, session_id, transcript)
    transcript.write_text(json.dumps({"subtype": "compact_boundary"}) + "\n")
    assert heading in run_hook(prompt, session_id, transcript)
    assert run_hook(prompt, session_id, transcript) == ""


def test_transcript_evita_repeticao_se_marker_sumir(tmp_path, session_id):
    transcript = tmp_path / "transcript.jsonl"
    reminder = run_hook("Olá", session_id, transcript)
    transcript.write_text(json.dumps({
        "attachment": {"type": "hook_additional_context", "content": [reminder]}
    }) + "\n")
    marker = Path("/tmp") / f"painel-cockpit-skill-loaded-{session_id}.flag"
    marker.unlink()
    assert run_hook("De novo", session_id, transcript) == ""


def test_settings_preserva_chaves_hooks_e_skill_homonima(tmp_path):
    spec = importlib.util.spec_from_file_location(
        "preparar_settings", DEPLOY / "preparar-settings.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    settings = tmp_path / "settings.json"
    skills = tmp_path / "skills"
    existing = skills / "canal-cockpit"
    existing.mkdir(parents=True)
    (existing / "SKILL.md").write_text("skill do cliente\n")
    original = {
        "env": {"CLIENTE": "preservar"},
        "permissions": {"allow": ["Read"]},
        "hooks": {"UserPromptSubmit": [{
            "hooks": [{"type": "command", "command": "/bin/true"}]
        }]},
    }
    settings.write_text(json.dumps(original))
    user = pwd.getpwuid(os.getuid()).pw_name
    source = DEPLOY / "skills"
    module.main(settings, user, source)
    first = settings.read_bytes()
    module.main(settings, user, source)
    assert settings.read_bytes() == first
    data = json.loads(first)
    assert data["env"] == original["env"]
    assert data["permissions"] == original["permissions"]
    assert data["hooks"]["UserPromptSubmit"][0] == original["hooks"]["UserPromptSubmit"][0]
    assert len(data["hooks"]["UserPromptSubmit"]) == 2
    assert (existing / "SKILL.md").read_text() == "skill do cliente\n"
    assert not existing.is_symlink()
    assert (skills / "conversa-por-voz").is_symlink()
    assert (skills / "conversa-por-voz").resolve() == source / "conversa-por-voz"
