#!/usr/bin/env bash
# SessionStart hook: avisa se a branch local está atrás do remoto.
# Não faz pull/rebase sozinho — só informa, decisão fica pra sessão.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root"

timeout 10 git fetch --quiet origin 2>/dev/null || exit 0

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0
upstream="origin/$branch"
git rev-parse --verify "$upstream" >/dev/null 2>&1 || exit 0

behind="$(git rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)"
[ "$behind" -gt 0 ] || exit 0

dirty=""
[ -n "$(git status --porcelain)" ] && dirty=" — working tree tem mudanças locais, cuidado com pull/rebase"

echo "Aviso: branch '$branch' está $behind commit(s) atrás de $upstream$dirty"
git log --oneline -5 "HEAD..$upstream"
