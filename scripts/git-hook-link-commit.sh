#!/usr/bin/env bash
# DS-51 — Hook git post-commit que amarra o commit às tasks do cockpit.
#
# Instalação por repo:
#   ln -s /home/clawd/repos/grupo_borges/scripts/git-hook-link-commit.sh \
#         /home/clawd/repos/<repo>/.git/hooks/post-commit
#
# Roda local após cada commit. Extrai human_ids (DS-12, JP-11, etc) da
# mensagem do último commit e bate POST /api/task-commits.
#
# Falhas (cockpit fora do ar, network) NÃO bloqueiam o commit — só logam
# em $TMPDIR/git-hook-link-commit.log. Hook git é best-effort.

set -uo pipefail

COCKPIT_URL="${COCKPIT_URL:-http://127.0.0.1:8000}"
LOG_FILE="${TMPDIR:-/tmp}/git-hook-link-commit.log"

# Repo é o basename do toplevel (grupo_borges, fluyt, ze_claude...).
REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null)
if [[ -z "$REPO_TOP" ]]; then exit 0; fi
REPO=$(basename "$REPO_TOP")

SHA=$(git rev-parse HEAD)
MSG=$(git log -1 --pretty=%s)
BODY=$(git log -1 --pretty=%B)
AUTHOR=$(git log -1 --pretty='%an <%ae>')
COMMITTED_AT=$(git log -1 --pretty=%ct)

# Extrai todos os human_ids tipo `DS-12`, `JP-11`, `TK-23`.
# Aceita em qualquer posição da subject ou body; case-insensitive.
HUMAN_IDS=$(printf '%s\n%s\n' "$MSG" "$BODY" \
    | grep -oE '\b[A-Z]{1,8}-[0-9]+\b' \
    | sort -u)

if [[ -z "$HUMAN_IDS" ]]; then
    echo "[$(date -Iseconds)] $REPO $SHA: sem human_id na msg — skip" >> "$LOG_FILE"
    exit 0
fi

# Monta JSON array
IDS_JSON=$(printf '%s' "$HUMAN_IDS" | jq -R . | jq -sc .)

PAYLOAD=$(jq -nc \
    --argjson task_human_ids "$IDS_JSON" \
    --arg sha "$SHA" \
    --arg repo "$REPO" \
    --arg message "$MSG" \
    --arg author "$AUTHOR" \
    --argjson committed_at "$COMMITTED_AT" \
    '{task_human_ids: $task_human_ids, sha: $sha, repo: $repo, message: $message, author: $author, committed_at: $committed_at}')

RESPONSE=$(curl -sS -m 3 -X POST "${COCKPIT_URL}/api/task-commits" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" 2>&1 || true)

echo "[$(date -Iseconds)] $REPO $SHA → $HUMAN_IDS → $RESPONSE" >> "$LOG_FILE"
exit 0
