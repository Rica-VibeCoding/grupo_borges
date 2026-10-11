#!/usr/bin/env bash
# Manutenção da madrugada do agente de cliente: guarda o que a conversa produziu e
# recomeça limpa. O cliente não vê nada disso.
#
# O encerramento NÃO roda na conversa viva: roda numa cópia dela (--fork-session), sem
# gravar sessão (--no-session-persistence), então não aparece na lista de conversas nem
# no fim da conversa do cliente. A cópia herda o contexto inteiro, grava memória e arquivos
# do agente e morre. Só depois a conversa viva leva o /clear.
#
# Instalado em /usr/local/bin/agente-manutencao; roda como `agente`, pelo crontab dele:
#   0 4 * * 1,5 /usr/local/bin/agente-manutencao  # manutencao:madrugada
# (o contêiner roda em BRT: é 04h de lá. Depois de editar o crontab: `agente-crontab salvar`.)
# Uso: agente-manutencao [--dry-run]
set -uo pipefail
export PATH=/opt/py/bin:/usr/local/bin:/usr/bin:/bin
export DISABLE_AUTOUPDATER=1 CLAUDE_CONFIG_DIR=/casa/claude
set -a; . /casa/agente.env; set +a
cd /casa/workspace || exit 1

DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1
ESTADO="$CLAUDE_CONFIG_DIR/manutencao"
mkdir -p "$ESTADO"
LOG_FILE="$ESTADO/run.log"
MARCA="$ESTADO/ultima"

exec 9>"$ESTADO/lock"
flock -n 9 || exit 0

log() { if (( DRY )); then echo "$*"; else echo "[$(date -Iseconds)] $*" >> "$LOG_FILE"; fi; }
[[ -f "$LOG_FILE" && $(stat -c%s "$LOG_FILE") -gt 1048576 ]] && : > "$LOG_FILE"

# A conversa viva é a de escrita mais recente (mesma conta do agente-subir).
projeto="$CLAUDE_CONFIG_DIR/projects/$(pwd | tr '/._' '---')"
viva="$(ls -t "$projeto"/*.jsonl 2>/dev/null | head -1)"
[[ -n "$viva" ]] || { log "sem conversa nenhuma — nada a fazer"; exit 0; }
id="$(basename "$viva" .jsonl)"

# Conversa que não andou desde a última manutenção não tem o que guardar nem o que limpar.
atual="$id $(stat -c %Y "$viva")"
if [[ "$(cat "$MARCA" 2>/dev/null)" == "$atual" ]]; then
  log "conversa parada desde a última manutenção — nada a fazer"; exit 0
fi
(( DRY )) && { log "encerraria a conversa $id e mandaria /clear"; exit 0; }

PEDIDO="Manutenção automática da madrugada. Ninguém está conversando com você agora e ninguém vai ler esta resposta além de quem cuida da máquina.

PROIBIDO nesta manutenção: mandar mensagem, áudio ou arquivo pra qualquer pessoa, por qualquer canal ou script (Telegram, WhatsApp, e-mail). Passo do roteiro que avise, pergunte ou reporte algo ao dono: pule o envio e escreva o conteúdo na linha PENDENTE do relato.

Execute o seu roteiro de encerramento de sessão, o primeiro que existir no workspace: .claude/commands/encerrar_*.md (manutenção), senão .claude/commands/encerrar.md, senão .claude/skills/encerrar/SKILL.md. Leia o arquivo e siga os passos: memória, arquivos, temporários. A conversa vai ser limpa logo depois — o que não ficar em disco agora se perde.

Termine com exatamente três linhas:
GRAVEI: <o que salvou em memória ou arquivo, ou nada>
PENDENTE: <o que o dono está esperando ou precisa responder, ou nada>
PERDI: <o que você percebeu que já tinha se perdido, ou nada>"

# --strict-mcp-config: nenhum servidor MCP sobe (medido 11/10/2026) — a cópia não disputa o
# canal do cliente com a conversa viva. A pasta do token vai junto pra um lugar vazio, por
# --settings, que vence o settings.json do workspace. disableAllHooks: o gancho do painel
# trataria o pedido como mensagem do cliente e mandaria formatar a resposta pra tela dele.
# O que NÃO está fechado: a cópia tem Bash, e mandar mensagem por script depende de ela
# obedecer ao PROIBIDO do pedido.
saida="$(printf '%s' "$PEDIDO" | timeout 900 claude -p --resume "$id" --fork-session \
  --no-session-persistence --strict-mcp-config --dangerously-skip-permissions \
  --settings '{"disableAllHooks":true,"env":{"TELEGRAM_STATE_DIR":"/nonexistent"}}' 2>&1)"
rc=$?
relato="$(echo "$saida" | grep -E '^(GRAVEI|PENDENTE|PERDI):' | tail -n 3)"
if (( rc != 0 )) || [[ -z "$relato" ]]; then
  log "FALHA do encerramento (rc=$rc) — /clear NÃO enviado: $(echo "$saida" | tail -n 3 | tr '\n' ' ' | cut -c1-400)"
  exit 1
fi
log "$(echo "$relato" | tr '\n' ' ')"

# O cronômetro da barra muda todo segundo, então sai da conta; o que resta é o corpo —
# mudou em 4s, tem turno em voo, e /clear no meio do turno não vira comando.
TX=(tmux -L agente)
"${TX[@]}" has-session -t agente 2>/dev/null || { log "agente desligado — sem /clear"; echo "$atual" > "$MARCA"; exit 0; }
corpo() { "${TX[@]}" capture-pane -p -t agente -S -12 2>/dev/null | grep -vE '[0-9]+:[0-9]{2}:[0-9]{2}'; }
antes="$(corpo)"; sleep 4; depois="$(corpo)"
if [[ "$antes" != "$depois" ]]; then
  log "agente no meio de um turno — /clear fica pra próxima manutenção"; exit 0
fi
# A cópia levou minutos: se a conversa andou nesse meio-tempo, o que entrou não foi guardado.
if [[ "$id $(stat -c %Y "$projeto/$id.jsonl")" != "$atual" ]]; then
  log "a conversa andou durante o encerramento — /clear fica pra próxima manutenção"; exit 0
fi
"${TX[@]}" send-keys -t agente C-u
sleep 1
"${TX[@]}" send-keys -t agente -l "/clear"
sleep 1
"${TX[@]}" send-keys -t agente Enter
# O /clear abre um jsonl novo na hora: id igual ao de antes é /clear que não pegou.
for _ in 1 2 3 4 5 6; do
  sleep 5
  viva="$(ls -t "$projeto"/*.jsonl 2>/dev/null | head -1)"
  [[ "$(basename "$viva" .jsonl)" != "$id" ]] && break
done
if [[ "$(basename "$viva" .jsonl)" == "$id" ]]; then
  log "FALHA: /clear enviado mas a conversa nova não apareceu"; exit 1
fi
echo "$(basename "$viva" .jsonl) $(stat -c %Y "$viva")" > "$MARCA.$$" && mv "$MARCA.$$" "$MARCA"
log "/clear enviado"
