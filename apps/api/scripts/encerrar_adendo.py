#!/usr/bin/env python3
"""Resolve o adendo do /encerrar no terminal com a MESMA regra do botão do cockpit.

Uso:
    encerrar_adendo.py [slug]
    encerrar_adendo.py [slug] --workspace   # só o workspace_path do cadastro (flag em qualquer posição)

Sem slug, a identidade vem do nome da sessão tmux (bate com `slug` ou
`tmux_session` do agents.yaml). O cadastro é o mesmo que o cockpit lê
(`agents.local.yaml` vence, `GB_AGENTS_YAML` vence os dois).

Imprime o bloco de resolução e sai com:
    0 achado · 1 ausente · 2 declarado e não encontrado
    3 identidade ambígua (slug não achado ou mais de um) · 4 erro de leitura
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml  # noqa: E402

from config import Settings  # noqa: E402
from services.encerrar import resolver_adendo  # noqa: E402

CODIGO = {"achado": 0, "ausente": 1, "declarado_nao_encontrado": 2}


def _sessao_tmux() -> str | None:
    try:
        saida = subprocess.run(["tmux", "display-message", "-p", "#S"],
                               capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    return saida.stdout.strip() if saida.returncode == 0 and saida.stdout.strip() else None


def main(argv: list[str]) -> int:
    try:
        caminho_yaml = Path(Settings().agents_yaml)
        agentes = (yaml.safe_load(caminho_yaml.read_text(encoding="utf-8")) or {}).get("agents") or []
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        print(f"Adendo do agente: ERRO ao ler o cadastro — {exc}", file=sys.stderr)
        return 4
    so_workspace = "--workspace" in argv[1:]
    resto = [a for a in argv[1:] if a != "--workspace"]
    alvo = resto[0] if resto else _sessao_tmux()
    achados = [a for a in agentes if alvo and alvo in (a.get("slug"), a.get("tmux_session"))]
    if len(achados) != 1:
        print(f"Adendo do agente: IDENTIDADE AMBÍGUA — '{alvo or 'sem slug nem sessão tmux'}'"
              f" bate com {len(achados)} cadastro(s) em {caminho_yaml}. Passar o próprio slug.",
              file=sys.stderr)
        return 3
    agente = achados[0]
    if so_workspace:
        print(agente["workspace_path"])
        return 0
    try:
        status, _, texto = resolver_adendo(agente["workspace_path"], agente.get("encerrar_adendo_path"))
    except (OSError, UnicodeError, KeyError) as exc:
        print(f"Adendo do agente: ERRO de leitura — {exc}", file=sys.stderr)
        return 4
    print(texto)
    return CODIGO[status]


if __name__ == "__main__":
    sys.exit(main(sys.argv))
