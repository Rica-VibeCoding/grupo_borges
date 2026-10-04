#!/bin/bash
# UserPromptSubmit: carrega as skills do painel do cliente uma vez por sessão.
# Após compactação, devolve o corpo da skill ao contexto no primeiro turno.
python3 - "${BASH_SOURCE[0]}" 3<&0 <<'PY'
import hashlib
import json
import os
import re
import sys
from pathlib import Path


def transcript_state(path, skill):
    compactions = 0
    loaded_after = False
    ever_loaded = False
    if not path:
        return compactions, loaded_after, ever_loaded
    try:
        with open(path, encoding="utf-8") as transcript:
            for line in transcript:
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if record.get("subtype") == "compact_boundary":
                    compactions += 1
                    loaded_after = False
                content = (record.get("message") or {}).get("content")
                if isinstance(content, list):
                    content = " ".join(
                        block.get("text", "") for block in content
                        if isinstance(block, dict) and isinstance(block.get("text"), str)
                    )
                attachment = record.get("attachment") or {}
                attached = attachment.get("content") or []
                if isinstance(attached, str):
                    attached = [attached]
                loaded = (
                    isinstance(content, str)
                    and content.startswith("Base directory for this skill:")
                    and skill in content[:200]
                ) or (
                    attachment.get("type") == "hook_additional_context"
                    and any(
                        "painel-skill-hook:" in text and skill in text
                        for text in attached if isinstance(text, str)
                    )
                )
                if loaded:
                    loaded_after = True
                    ever_loaded = True
    except OSError:
        pass
    return compactions, loaded_after, ever_loaded


def skill_body(path):
    try:
        body = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    if body.startswith("---\n"):
        _, separator, body = body[4:].partition("\n---\n")
        if not separator:
            return ""
    return body.strip()


def main():
    try:
        event = json.load(os.fdopen(3, encoding="utf-8"))
    except (OSError, ValueError):
        return
    prompt = (event.get("prompt") or "").lstrip()
    if re.match(r'<channel\s+source="plugin:(telegram|whatsapp)', prompt):
        return

    voice = prompt.startswith("🗣")
    skill = "conversa-por-voz" if voice else "canal-cockpit"
    session_id = event.get("session_id") or ""
    compactions, loaded_after, ever_loaded = transcript_state(
        event.get("transcript_path"), skill
    )
    marker = None
    if session_id:
        safe_id = session_id if re.fullmatch(r"[A-Za-z0-9_-]+", session_id) else hashlib.sha256(
            session_id.encode()
        ).hexdigest()
        kind = "voz" if voice else "cockpit"
        marker = Path(f"/tmp/painel-{kind}-skill-loaded-{safe_id}.flag")
        if marker.exists():
            try:
                previous_compactions = int(marker.read_text(encoding="ascii") or "0")
            except (OSError, ValueError):
                previous_compactions = 0
            if compactions <= previous_compactions:
                return
            restore = True
        elif loaded_after:
            marker.write_text(str(compactions), encoding="ascii")
            return
        else:
            restore = ever_loaded and compactions > 0
        marker.write_text(str(compactions), encoding="ascii")
    else:
        restore = False

    if restore:
        body = skill_body(Path(sys.argv[1]).resolve().parent / "skills" / skill / "SKILL.md")
        if body:
            reminder = (
                f"painel-skill-hook: A conversa compactou; a skill `{skill}` "
                f"volta aqui inteira. Siga-a:\n\n{body}"
            )
        else:
            reminder = f"painel-skill-hook: A conversa compactou. Invoque novamente a skill `{skill}`."
    elif voice:
        reminder = (
            "painel-skill-hook: Fala pela tela de voz do painel do cliente (🗣): "
            "a resposta será lida em voz alta. Antes de responder, invoque a skill "
            "`conversa-por-voz` e siga suas regras de concisão e texto falado."
        )
    else:
        reminder = (
            "painel-skill-hook: Mensagem recebida pelo painel do cliente. "
            "Antes de responder, invoque a skill `canal-cockpit` para aplicar "
            "o formato e a concisão do painel. Responda pela saída normal."
        )
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit", "additionalContext": reminder
    }}, ensure_ascii=False))


try:
    main()
except Exception:
    # Um lembrete falho nunca deve bloquear a mensagem do cliente.
    pass
PY
