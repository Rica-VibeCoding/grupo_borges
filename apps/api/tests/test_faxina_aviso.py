import io
import json
from pathlib import Path
import sys
import urllib.error

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import faxina_aviso as notice


def test_sem_novos_nao_le_token_nem_envia(tmp_path, monkeypatch):
    monkeypatch.setattr(notice, "ENV_FILE", tmp_path / "ausente")
    assert notice.notify(0) is None


def test_um_aviso_formatado_pelo_bot_do_pavan(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("TELEGRAM_BOT_TOKEN=token-ficticio\n")
    monkeypatch.setattr(notice, "ENV_FILE", env)
    calls = []

    class Opener:
        def open(self, req, timeout):
            calls.append((req, timeout))
            return io.BytesIO(json.dumps({"ok": True, "result": {"message_id": 123}}).encode())

    monkeypatch.setattr(notice.urllib.request, "build_opener", lambda *args: Opener())
    assert notice.notify(5) == 123
    assert len(calls) == 1
    req, timeout = calls[0]
    payload = json.loads(req.data)
    assert payload["chat_id"] == "7262275215"
    assert payload["parse_mode"] == "MarkdownV2"
    assert notice.URL in payload["text"]
    assert "5 novos" in payload["text"]
    assert timeout == 8


def test_erro_nao_vaza_url_com_token(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("TELEGRAM_BOT_TOKEN=segredo-ficticio\n")
    monkeypatch.setattr(notice, "ENV_FILE", env)

    class Opener:
        def open(self, req, timeout):
            raise urllib.error.URLError("https://api.telegram.org/botsegredo-ficticio/sendMessage")

    monkeypatch.setattr(notice.urllib.request, "build_opener", lambda *args: Opener())
    with pytest.raises(RuntimeError) as exc:
        notice.notify(3)
    assert "segredo-ficticio" not in str(exc.value)
    assert "conferir antes de reenviar" in str(exc.value)
