#!/usr/bin/env bash
set -euo pipefail
export TZ=America/Sao_Paulo

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/faxina-frota"
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0

LOG_FILE="$STATE_DIR/run.log"
STATE_FILE="$STATE_DIR/ultima-semana"
[[ ! -f "$LOG_FILE" || $(stat -c%s "$LOG_FILE") -le 1048576 ]] || : > "$LOG_FILE"
exec >>"$LOG_FILE" 2>&1

SEMANA="$(date +%G-W%V)"
if [[ -f "$STATE_FILE" && "$(<"$STATE_FILE")" == "$SEMANA" ]]; then
    printf '[%s] já rodou em %s\n' "$(date -Iseconds)" "$SEMANA"
    exit 0
fi

cd "$BASE/apps/api"
printf '[%s] início da varredura %s\n' "$(date -Iseconds)" "$SEMANA"
if ! "$BASE/apps/api/.venv/bin/python" "$BASE/scripts/faxina_varredura.py" --aplicar; then
    printf '[%s] varredura falhou; semana não concluída\n' "$(date -Iseconds)"
    exit 1
fi
printf '%s\n' "$SEMANA" > "$STATE_FILE.$$"
mv "$STATE_FILE.$$" "$STATE_FILE"
printf '[%s] varredura concluída\n' "$(date -Iseconds)"
