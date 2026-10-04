#!/usr/bin/env python3
"""Mescla integrações do painel no /casa do cliente antes de subir o agente."""

import json
import os
import pwd
import tempfile
from pathlib import Path


def main(
    path: Path = Path("/casa/claude/settings.json"),
    user_name: str = "agente",
    source_dir: Path = Path("/opt/painel/deploy/painel-cliente/skills"),
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if not isinstance(current, dict):
        raise ValueError("settings.json deve conter um objeto")

    wanted = {
        "type": "command",
        "command": "python3 /opt/painel/deploy/painel-cliente/statusline-capture.py",
    }
    changed = current.get("statusLine") != wanted
    current["statusLine"] = wanted
    hooks = current.setdefault("hooks", {})
    starts = hooks.setdefault("SessionStart", [])
    briefing = "/opt/painel/apps/api/scripts/briefing-retorno.sh"
    if not any(briefing in json.dumps(entry) for entry in starts):
        starts.append({
            "matcher": "resume",
            "hooks": [{"type": "command", "command": briefing, "timeout": 5}],
        })
        changed = True
    submits = hooks.setdefault("UserPromptSubmit", [])
    skill_hook = "/opt/painel/deploy/painel-cliente/painel-skill-hook.sh"
    if not any(
        hook.get("type") == "command" and hook.get("command") == skill_hook
        for group in submits for hook in group.get("hooks", [])
    ):
        submits.append({"hooks": [{"type": "command", "command": skill_hook}]})
        changed = True

    skills_dir = path.parent / "skills"
    if not skills_dir.exists():
        skills_dir.mkdir()
        owner = pwd.getpwnam(user_name)
        os.chown(skills_dir, owner.pw_uid, owner.pw_gid)
    for name in ("canal-cockpit", "conversa-por-voz"):
        target = skills_dir / name
        if not os.path.lexists(target):
            source = source_dir / name
            if not (source / "SKILL.md").is_file():
                raise FileNotFoundError(source / "SKILL.md")
            target.symlink_to(source, target_is_directory=True)
    if not changed:
        return

    user = pwd.getpwnam(user_name)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, temp = tempfile.mkstemp(prefix=".settings-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(current, file, ensure_ascii=False, indent=2)
            file.write("\n")
        os.chmod(temp, mode)
        os.chown(temp, user.pw_uid, user.pw_gid)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


if __name__ == "__main__":
    main()
