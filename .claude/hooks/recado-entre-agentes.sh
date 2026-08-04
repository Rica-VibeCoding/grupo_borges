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
touch "$marcador"

# Stop exige JSON com hookSpecificOutput — stdout cru só vale pro SessionStart.
# python3 pro escape: recado tem aspas, barra e quebra de linha à vontade.
CORPO="$corpo" INBOX="$inbox" python3 -c '
import json, os
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "Stop",
        "additionalContext": (
            "Recado de outro agente da frota, entregue em "
            + os.environ["INBOX"]
            + " (o remetente NÃO vê tua resposta — responde pelo canal que ele indicar):\n\n"
            + os.environ["CORPO"]
        ),
    }
}))
' 2>/dev/null || {
  # Sem python3 no PATH o hook não pode falhar calado e comer o recado:
  # devolve o marcador pro estado anterior pra tentar de novo no próximo turno.
  rm -f "$marcador"
  exit 0
}
