"""Resolve o ritual como texto: funciona também sem comandos de barra no CLI."""
import re
from pathlib import Path


def expandir_encerrar(texto: str, workspace: str) -> str:
    if texto.strip() != "/encerrar":
        return texto
    relativo = Path("ze-shared/.claude/commands/encerrar.md")
    candidatos = [
        Path(workspace) / ".claude/commands/encerrar.md",
        Path.home() / "repos/ze_claude" / relativo,
        # No notebook, ~/ze_claude monta /home/clawd/repos inteiro por sshfs.
        Path.home() / "ze_claude/ze_claude" / relativo,
    ]
    for caminho in candidatos:
        if caminho.is_file():
            corpo = re.sub(r"\A---\r?\n.*?\r?\n---(?:\r?\n|$)", "",
                           caminho.read_text(encoding="utf-8"), count=1, flags=re.DOTALL).strip()
            if corpo:
                return f"Execute o ritual de encerramento de {caminho}:\n\n{corpo}"
    raise FileNotFoundError("Ritual de encerramento indisponível")
