"""Resolve o ritual como texto: funciona também sem comandos de barra no CLI."""
import re
from pathlib import Path


def _corpo(caminho: Path) -> str:
    return re.sub(r"\A---\r?\n.*?\r?\n---(?:\r?\n|$)", "",
                  caminho.read_text(encoding="utf-8"), count=1, flags=re.DOTALL).strip()


def expandir_encerrar(texto: str, workspace: str, encerrar_adendo_path: str | None = None) -> str:
    if texto.strip() != "/encerrar":
        return texto
    relativo = Path("ze-shared/.claude/commands/encerrar.md")
    candidatos = [
        Path.home() / "repos/ze_claude" / relativo,
        # No notebook, ~/ze_claude monta /home/clawd/repos inteiro por sshfs.
        Path.home() / "ze_claude/ze_claude" / relativo,
    ]
    for caminho in candidatos:
        if caminho.is_file():
            corpo = _corpo(caminho)
            if corpo:
                adendo = Path(encerrar_adendo_path or ".claude/encerrar-adendo.md").expanduser()
                if not adendo.is_absolute():
                    adendo = Path(workspace) / adendo
                adendo = adendo.resolve()
                diferenca = _corpo(adendo) if adendo.is_file() else ""
                resolucao = (f"Adendo do agente: {adendo}\n\n{diferenca}" if diferenca
                             else f"Adendo do agente: ausente ({adendo}).")
                return (f"Execute o ritual de encerramento de {caminho}:\n\n{corpo}"
                        f"\n\n---\nResolução do adendo pelo cockpit:\n{resolucao}")
    raise FileNotFoundError("Ritual de encerramento indisponível")
