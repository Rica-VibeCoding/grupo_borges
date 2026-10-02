#!/usr/bin/env bash
# Estaciona a conversa atual do agente: título e nota para a lista do cockpit.
#
#   scripts/estacionar.sh <slug> "TÍTULO" "NOTA"
#
# Quem chama é o agente, atendendo o pedido que o cockpit manda na troca de
# conversa (`operacao_conversa.mensagem_de_estacionar`). O JSON sai do `jq`, não
# da mão do agente: apóstrofo, aspas e quebra de linha na nota não quebram o corpo.
# O endereço vem em GB_API_URL; sem ele, o da API na própria VPS.
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "uso: $0 <slug> \"TÍTULO\" [\"NOTA\"]" >&2
  exit 2
fi

slug=$1
corpo=$(jq -n --arg titulo "$2" --arg nota "${3:-}" '{titulo: $titulo, nota: $nota}')

curl -sS --fail-with-body -X POST "${GB_API_URL:-http://127.0.0.1:8002}/api/agents/$slug/conversas/estacionar" \
  -H 'Content-Type: application/json' \
  -H "Tailscale-User-Login: agente-$slug" \
  -d "$corpo"
echo
