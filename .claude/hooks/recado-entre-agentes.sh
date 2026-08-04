#!/usr/bin/env bash
# Stop hook: entrega recado de outro agente no fim do turno.
#
# Por que existe: em 04/08 o Pavan (VPS) e o Claude do PC ficaram meio dia
# dependendo do Rica pra avisar um ao outro que havia mensagem. Quem roda em
# tmux/psmux é alcançável por `send-keys`; quem roda no terminal do VS Code não
# é, e nenhum arquivo trocado avisa que mudou. Este hook fecha essa lacuna sem
# exigir que ninguém reabra sessão: hooks são relidos pelo file watcher.
#
# Contrato: quem escreve entrega o arquivo NA MÁQUINA do destinatário (scp/ssh
# pro PC, escrita direta na VPS) e segue a vida. A entrega acontece no próximo
# fim de turno do destinatário — não é push instantâneo, e não precisa ser.
#
# Anti-loop: só injeta quando o inbox é mais novo que o marcador de leitura.
# Sem isso o Stop realimentaria a si mesmo pra sempre.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
inbox="$root/.claude/recados/inbox.md"
marcador="$root/.claude/recados/.lido"

[ -f "$inbox" ] || exit 0
[ -s "$inbox" ] || exit 0

# `-nt` compara mtime; marcador ausente conta como "nunca li".
if [ -f "$marcador" ] && [ ! "$inbox" -nt "$marcador" ]; then
  exit 0
fi

corpo="$(cat "$inbox")"
cabecalho="Recado de outro agente da frota, entregue em $inbox (o remetente NÃO vê tua resposta — responde pelo canal que ele indicar):

"

# Stop exige JSON com hookSpecificOutput — stdout cru só vale pro SessionStart.
# Escape em sed, sem depender de interpretador: no PC do Rica o `python3` do PATH
# é o stub da Microsoft Store (ver pavan/docs/operacao-pc.md). Hoje ele responde,
# mas se voltar ao comportamento de fábrica o canal emudece calado — e canal que
# falha em silêncio é o defeito que este hook existe pra matar.
# Ordem obrigatória: barra invertida ANTES das aspas, senão escapa o próprio escape.
escapado="$(
  printf '%s%s' "$cabecalho" "$corpo" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g' -e 's/\t/\\t/g' \
    | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g'
)"

printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"%s"}}\n' "$escapado"
touch "$marcador"
