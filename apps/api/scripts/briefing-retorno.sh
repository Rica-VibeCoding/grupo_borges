#!/usr/bin/env bash
# Gancho SessionStart (matcher: resume) do briefing de retorno — F7 de
# docs/conversas/PLANO.md.
#
# Lê o JSON do gancho no stdin, pergunta à API se esta conversa acabou de ser
# retomada pelo cockpit e, se houver o que dizer, devolve o briefing como
# additionalContext. Qualquer outra coisa — API fora, conversa sem marca de
# retomada, linha fora do tmux, resposta vazia — termina calado em até 3 s:
# a largada de um agente nunca espera nem quebra por causa deste gancho.
#
# O agente é a sessão tmux (#S): é o que a linha sabe de si. A rota aceita a
# sessão no lugar do slug (Canário: sessão canario, slug canarinho).
#
# Registro no ~/.claude/settings.json da VPS:
#   "SessionStart": [{"matcher": "resume", "hooks": [{"type": "command",
#     "command": "<repo>/apps/api/scripts/briefing-retorno.sh", "timeout": 5}]}]
set -u

entrada="$(timeout 0.5 cat 2>/dev/null)" || exit 0
[ -n "${TMUX:-}" ] || exit 0
sessao="$(timeout 0.5 tmux display-message -p '#S' 2>/dev/null)" || exit 0
[ -n "$sessao" ] || exit 0

API="${COCKPIT_API_URL:-http://127.0.0.1:8002}" SESSAO="$sessao" ENTRADA="$entrada" \
timeout 2 python3 - <<'PY' 2>/dev/null
import json, os, re, sys, urllib.parse, urllib.request

try:
    gancho = json.loads(os.environ["ENTRADA"])
except ValueError:
    sys.exit(0)
session_id = gancho.get("session_id") or ""
if gancho.get("source") != "resume" or not re.fullmatch(r"[0-9a-fA-F-]{36}", session_id):
    sys.exit(0)
sessao = urllib.parse.quote(os.environ["SESSAO"], safe="")
url = f"{os.environ['API'].rstrip('/')}/api/agents/{sessao}/conversas/{session_id}/briefing"
pedido = urllib.request.Request(url, headers={"Tailscale-User-Login": f"agente-{sessao}"})
try:
    with urllib.request.urlopen(pedido, timeout=1.5) as resposta:
        texto = json.load(resposta).get("briefing") or ""
except Exception:
    sys.exit(0)
if texto.strip():
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "SessionStart", "additionalContext": texto,
    }}, ensure_ascii=False))
PY
exit 0
