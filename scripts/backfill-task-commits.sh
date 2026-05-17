#!/usr/bin/env bash
# DS-51 — Backfill: lê N commits do repo atual e reposta no cockpit
# como se o hook tivesse rodado em cada um. Idempotente — repostar é
# OR IGNORE no DB.
#
# Uso (dentro de cada repo):
#   ./backfill-task-commits.sh [N]    # default N=50
#
# Útil pra popular histórico nas tasks existentes.

set -uo pipefail

LIMIT="${1:-50}"
COCKPIT_URL="${COCKPIT_URL:-http://127.0.0.1:8000}"

REPO_TOP=$(git rev-parse --show-toplevel)
REPO=$(basename "$REPO_TOP")
SHAS=$(git log -n "$LIMIT" --pretty=%H)

total=0
linked=0
skipped=0

while read -r sha; do
    [[ -z "$sha" ]] && continue
    total=$((total + 1))
    MSG=$(git log -1 --pretty=%s "$sha")
    BODY=$(git log -1 --pretty=%B "$sha")
    AUTHOR=$(git log -1 --pretty='%an <%ae>' "$sha")
    COMMITTED_AT=$(git log -1 --pretty=%ct "$sha")

    HUMAN_IDS=$(printf '%s\n%s\n' "$MSG" "$BODY" \
        | grep -oE '\b[A-Z]{1,8}-[0-9]+\b' \
        | sort -u)
    if [[ -z "$HUMAN_IDS" ]]; then
        skipped=$((skipped + 1))
        continue
    fi
    IDS_JSON=$(printf '%s' "$HUMAN_IDS" | jq -R . | jq -sc .)
    PAYLOAD=$(jq -nc \
        --argjson task_human_ids "$IDS_JSON" \
        --arg sha "$sha" \
        --arg repo "$REPO" \
        --arg message "$MSG" \
        --arg author "$AUTHOR" \
        --argjson committed_at "$COMMITTED_AT" \
        '{task_human_ids: $task_human_ids, sha: $sha, repo: $repo, message: $message, author: $author, committed_at: $committed_at}')

    OUT=$(curl -sS -m 3 -X POST "${COCKPIT_URL}/api/task-commits" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" 2>/dev/null)

    INSERTED=$(echo "$OUT" | jq -r '.linked | map(select(.inserted)) | length' 2>/dev/null)
    if [[ "$INSERTED" =~ ^[0-9]+$ && "$INSERTED" -gt 0 ]]; then
        linked=$((linked + 1))
        echo "  $sha → $HUMAN_IDS"
    fi
done <<< "$SHAS"

echo ""
echo "total=$total linked=$linked skipped_sem_human_id=$skipped"
