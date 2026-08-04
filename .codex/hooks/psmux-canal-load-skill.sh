#!/bin/bash
# Injeta no Codex o contexto do canal VPS -> PC na primeira mensagem da sessão.
# Contrato: https://learn.chatgpt.com/docs/hooks.md#userpromptsubmit

INPUT=$(cat)

# Só tratar prompts que começam com o prefixo estabelecido pela skill psmux.
printf '%s' "$INPUT" | grep -qE '"prompt"[[:space:]]*:[[:space:]]*"([\]n|[\]t|[\]r| )*\[psmux-pc:' || exit 0

SESSION_ID=$(printf '%s' "$INPUT" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$SESSION_ID" ] || SESSION_ID="sem-id"
SAFE_SESSION_ID=$(printf '%s' "$SESSION_ID" | tr -cd '[:alnum:]_-')
[ -n "$SAFE_SESSION_ID" ] || SAFE_SESSION_ID="sem-id"

# Evitar repetir o contexto a cada mensagem do canal na mesma sessão Codex.
MARKER="/tmp/.codex-psmux-canal-skill-lida-${SAFE_SESSION_ID}"
[ -f "$MARKER" ] && exit 0
touch "$MARKER"

printf '%s\n' \
  '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Mensagem recebida pelo canal VPS->PC via tmux send-keys; o remetente e um agente da VPS, nao o Rica. Use a skill psmux antes de responder. Aplique tom agente-agente, devolva a resposta pelo mesmo canal quando destinada ao remetente e verifique se mensagens de remetentes diferentes chegaram coladas sem quebra de linha."}}'

exit 0
