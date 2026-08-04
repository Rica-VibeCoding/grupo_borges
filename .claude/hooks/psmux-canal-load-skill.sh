#!/bin/bash
# Hook UserPromptSubmit (lado PC) — espelho do hook da VPS
# (pavan/.claude/hooks/psmux-canal-load-skill.sh no monorepo ze_claude).
#
# Mensagem chegando pelo canal VPS->PC (o Pavan mandando `tmux send-keys` da VPS
# pra esta sessão) chega como texto cru, indistinguível de mensagem do Rica, a
# não ser pelo prefixo `[psmux-pc:<nome>]` que a skill `psmux` estabelece.
#
# Sem Python de propósito: o `python3` do PATH deste PC é o stub da Microsoft
# Store (abre a loja em vez de rodar). Parse em bash puro.
#
# Contrato (https://code.claude.com/docs/en/hooks):
#   stdin:  JSON com `prompt`, `session_id`, ...
#   stdout: {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}
#   exit:   sempre 0 (exit 2 bloqueia o turno e apaga o prompt — nunca queremos).

INPUT=$(cat)

# Só mensagem do canal: prompt começando com `[psmux-pc:` (tolera espaço/quebra escapada antes).
printf '%s' "$INPUT" | grep -qE '"prompt"[[:space:]]*:[[:space:]]*"([\]n|[\]t|[\]r| )*\[psmux-pc:' || exit 0

SESSION_ID=$(printf '%s' "$INPUT" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
# Sanitiza: session_id vai pro path do marker em /tmp — só [A-Za-z0-9._-],
# nada de barra/ponto-ponto (endurecimento da Tara, 04/08, copiado do lado VPS).
SESSION_ID=$(printf '%s' "$SESSION_ID" | tr -cd 'A-Za-z0-9._-' | sed 's/^\.*//')
[ -n "$SESSION_ID" ] || SESSION_ID="sem-id"

# Só lembra na 1a mensagem desse canal por sessão — releitura a cada mensagem é ruído.
# Apagar o marker re-arma o hook DENTRO da mesma sessão (provado na VPS em 04/08).
MARKER="/tmp/.psmux-canal-skill-lida-${SESSION_ID}"
[ -f "$MARKER" ] && exit 0
touch "$MARKER"

printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' \
  'Mensagem chegou pelo canal VPS->PC (quem mandou foi o Pavan, agente da VPS, via tmux send-keys - nao e o Rica). ANTES de responder, invoque a skill `psmux` (Skill tool) para aplicar a convencao do canal: tom agente-agente, resposta volta pelo mesmo canal se for pro remetente, e cuidado com mensagens de remetentes diferentes coladas sem quebra de linha.'

exit 0
