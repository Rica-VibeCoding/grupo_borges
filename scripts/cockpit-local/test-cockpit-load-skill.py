"""Regressão: marcador e menção não provam carga da Skill; sem tocar sessões vivas."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid

HOOK = Path(__file__).with_name("cockpit-load-skill.sh")


class CockpitLoadSkillTest(unittest.TestCase):
    def setUp(self):
        self.sid = str(uuid.uuid4())
        self.temp = tempfile.TemporaryDirectory()
        self.transcript = Path(self.temp.name) / "conversa.jsonl"
        self.marker = Path(f"/tmp/cockpit-skill-loaded-{self.sid}.flag")
        self.voice_marker = Path(f"/tmp/voz-skill-loaded-{self.sid}.flag")

    def tearDown(self):
        self.marker.unlink(missing_ok=True)
        self.voice_marker.unlink(missing_ok=True)
        self.temp.cleanup()

    def transcript_text(self, text):
        self.transcript.write_text(json.dumps({"message": {"content": text}}) + "\n")

    def call(self, prompt="Teste local"):
        result = subprocess.run(
            ["bash", str(HOOK)],
            input=json.dumps({"prompt": prompt, "session_id": self.sid,
                              "transcript_path": str(self.transcript)}),
            text=True, capture_output=True, check=True,
        )
        return result.stdout

    def test_marker_and_mention_do_not_suppress_skill(self):
        self.marker.touch()
        self.transcript_text("A skill canal-cockpit não carregou: Unknown skill.")
        self.assertIn("canal-cockpit", self.call())

    def test_real_skill_load_suppresses_repeated_reminder(self):
        self.transcript_text("Base directory for this skill: /local/canal-cockpit\nConteúdo")
        self.assertEqual(self.call(), "")
        self.assertTrue(self.marker.exists())

    def test_telegram_does_not_load_cockpit_or_voice(self):
        self.assertEqual(self.call('<channel source="plugin:telegram:telegram">teste</channel>'), "")
        self.assertFalse(self.marker.exists())
        self.assertFalse(self.voice_marker.exists())

    def test_voice_load_and_compact_reminder(self):
        self.transcript_text("Início")
        self.assertIn("conversa-por-voz", self.call("🗣 teste local"))
        self.transcript_text("Base directory for this skill: /local/conversa-por-voz\nConteúdo")
        self.assertEqual(self.call("🗣 teste local"), "")
        with self.transcript.open("a") as f:
            f.write(json.dumps({"subtype": "compact_boundary"}) + "\n")
        self.assertIn("conversa-por-voz", self.call("🗣 teste local"))


if __name__ == "__main__":
    unittest.main()
