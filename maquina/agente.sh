#!/usr/bin/env bash
# Uma entrada só para o painel, o boot e o terminal. Nenhum eval ou comando do cliente.
set -euo pipefail
PASTA="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -lt 2 || $# -gt 4 || ! "$1" =~ ^(ligar|desligar|estado|relancar)$ ]]; then
  echo "uso: $0 <ligar|desligar|estado|relancar> <agente> [--new|--resume ID]" >&2
  exit 2
fi
exec /usr/bin/python3 "$PASTA/agentes.py" "$@"
