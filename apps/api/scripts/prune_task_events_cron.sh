#!/usr/bin/env bash
# Poda diária de retenção do cockpit — mantém 30 dias de task_events.
# Crontab do clawd roda em horário local (BRT), confirmado pelos logs dos
# outros jobs diários. VACUUM só aos domingos: recompactar 1 GB custa ~30s de
# I/O e não compensa todo dia.
set -euo pipefail

API_DIR="/home/clawd/repos/grupo_borges/apps/api"
RETENTION_DAYS=30

cd "$API_DIR"

args=(--days "$RETENTION_DAYS")
[[ "$(date +%u)" == "7" ]] && args+=(--vacuum)

exec /usr/bin/python3 scripts/prune_task_events.py "${args[@]}"
