"""Resolve o ritual como texto: funciona também sem comandos de barra no CLI."""
import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)


def _corpo(caminho: Path) -> str:
    return re.sub(r"\A---\r?\n.*?\r?\n---(?:\r?\n|$)", "",
                  caminho.read_text(encoding="utf-8"), count=1, flags=re.DOTALL).strip()


def resolver_adendo(workspace: str, encerrar_adendo_path: str | None = None) -> tuple[str, Path, str]:
    """(status, caminho, texto) — status: achado | ausente | declarado_nao_encontrado.

    Fonte única da regra do adendo: o botão do cockpit e o CLI
    `scripts/encerrar_adendo.py` (terminal) passam por aqui.
    """
    adendo = Path(encerrar_adendo_path or ".claude/encerrar-adendo.md").expanduser()
    if not adendo.is_absolute():
        adendo = Path(workspace).expanduser() / adendo
    adendo = adendo.resolve()
    if encerrar_adendo_path and not adendo.is_file():
        resolucao = (f"Adendo do agente: DECLARADO E NÃO ENCONTRADO ({adendo})"
                     " — avisar o Rica no relatório e seguir só o ritual.")
        log.warning("%s", resolucao)
        return "declarado_nao_encontrado", adendo, resolucao
    diferenca = _corpo(adendo) if adendo.is_file() else ""
    if diferenca:
        return "achado", adendo, f"Adendo do agente: {adendo}\n\n{diferenca}"
    return "ausente", adendo, f"Adendo do agente: ausente ({adendo})."


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
                _, _, resolucao = resolver_adendo(workspace, encerrar_adendo_path)
                return (f"Execute o ritual de encerramento de {caminho}:\n\n{corpo}"
                        f"\n\n---\nResolução do adendo pelo cockpit:\n{resolucao}")
    raise FileNotFoundError("Ritual de encerramento indisponível")
