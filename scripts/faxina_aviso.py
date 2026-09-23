from __future__ import annotations

import json
from pathlib import Path
import urllib.error
import urllib.request

ENV_FILE = Path.home() / ".claude/channels/telegram-auxiliar/.env"
CHAT_ID = "7262275215"
URL = "https://borges.tailfe77db.ts.net:3446/faxina"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def notify(count: int) -> int | None:
    if count <= 0:
        return None
    token = None
    for line in ENV_FILE.read_text().splitlines():
        name, separator, value = line.partition("=")
        if separator and name.strip() == "TELEGRAM_BOT_TOKEN":
            token = value.strip().strip("\"'")
            break
    if not token:
        raise RuntimeError("token do bot do Pavan não encontrado")
    payload = {"chat_id": CHAT_ID, "parse_mode": "MarkdownV2",
               "text": f"🧹 *Faxina*: {count} novos itens para revisar\\.\n[Abrir Faxina]({URL})",
               "link_preview_options": {"is_disabled": True}}
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=8) as response:
            result = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise RuntimeError("candidatos gravados, aviso não confirmado; conferir antes de reenviar") from None
    if not result.get("ok"):
        raise RuntimeError("Telegram recusou o aviso; candidatos permanecem gravados")
    return result["result"]["message_id"]
