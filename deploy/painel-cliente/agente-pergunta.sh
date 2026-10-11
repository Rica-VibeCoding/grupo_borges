#!/usr/bin/env bash
# Pergunta da manhã do agente de cliente: quando há caderno parado há 30 dias ou dúvida
# aberta em cadernos/DUVIDAS.md, pede ao próprio agente que pergunte ao dono, numa mensagem
# curta. Quem pergunta é a conversa viva, pra que a resposta do dono caia em quem conhece a
# pergunta. Sem nada a perguntar, não faz nada; cada item é perguntado uma vez só, e sai no
# máximo uma mensagem por semana.
#
# Instalado em /usr/local/bin/agente-pergunta; roda como `agente`, pelo crontab dele:
#   0 8 * * 1,5 /usr/local/bin/agente-pergunta  # manutencao:pergunta
# (o contêiner roda em BRT. Depois de editar o crontab: `agente-crontab salvar`.)
# Uso: agente-pergunta [--dry-run]
set -uo pipefail
export PATH=/opt/py/bin:/usr/local/bin:/usr/bin:/bin
export CLAUDE_CONFIG_DIR=/casa/claude
cd /casa/workspace || exit 1

DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1
ESTADO="$CLAUDE_CONFIG_DIR/manutencao"
mkdir -p "$ESTADO"
LOG_FILE="$ESTADO/run.log"
FEITAS="$ESTADO/perguntadas"
ULTIMA="$ESTADO/ultima-pergunta"
ABERTA="cadernos/PERGUNTA-ABERTA.md"
PARADO_DIAS=30 INTERVALO_DIAS=6 TETO_CADERNOS=5 TETO_DUVIDAS=3

exec 8>"$ESTADO/pergunta.lock"
flock -n 8 || exit 0

log() { if (( DRY )); then echo "$*"; else echo "[$(date -Iseconds)] pergunta: $*" >> "$LOG_FILE"; fi; }

agora="$(date +%s)"
if [[ -f "$ULTIMA" ]] && (( agora - $(cat "$ULTIMA") < INTERVALO_DIAS * 86400 )); then
  (( DRY )) && log "já perguntou nesta semana — nada a fazer"
  exit 0
fi
touch "$FEITAS"

# Caderno parado: linha do índice (`slug` · ... · data) cuja última data passou de 30 dias.
chaves=() cadernos="" duvidas=""
n=0
while IFS= read -r linha; do
  slug="$(sed -n 's/^- `\([^`]*\)`.*/\1/p' <<< "$linha")"
  data="$(grep -oE '[0-9]{2}/[0-9]{2}/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}' <<< "$linha" | tail -n 1)"
  [[ -n "$slug" && -n "$data" ]] || continue
  [[ "$data" == */* ]] && iso="${data:6:4}-${data:3:2}-${data:0:2}" || iso="$data"
  quando="$(date -d "$iso" +%s 2>/dev/null)" || continue
  (( agora - quando > PARADO_DIAS * 86400 )) || continue
  chave="caderno:$slug:$iso"
  grep -qxF "$chave" "$FEITAS" && continue
  (( ++n > TETO_CADERNOS )) && break
  assunto="$(awk -F' · ' '{print $2}' <<< "$linha")"
  cadernos+="${cadernos:+; }$slug (${assunto:-sem descrição}, parado desde $data)"
  chaves+=("$chave")
done < <(grep -E '^- `' cadernos/INDICE.md 2>/dev/null)

n=0
while IFS= read -r linha; do
  texto="${linha#- }"
  chave="duvida:$(md5sum <<< "$texto" | cut -c1-12)"
  grep -qxF "$chave" "$FEITAS" && continue
  (( ++n > TETO_DUVIDAS )) && break
  duvidas+="${duvidas:+; }$texto"
  chaves+=("$chave")
done < <(grep -E '^- ' cadernos/DUVIDAS.md 2>/dev/null)

if (( ${#chaves[@]} == 0 )); then
  (( DRY )) && log "nenhum caderno parado e nenhuma dúvida aberta — nada a fazer"
  exit 0
fi

# Conversa recém-limpa não tem mensagem do dono de onde tirar o chat. Agente com Telegram
# recebe o chat no pedido: o de $ESTADO/dono-chat, ou o único liberado no access.json.
# Mais de um liberado e sem dono-chat, não adivinha.
canal="pelo canal em que vocês conversam"
acesso="$(ls "$CLAUDE_CONFIG_DIR"/channels/telegram-*/access.json 2>/dev/null | head -1)"
if [[ -n "$acesso" ]]; then
  chat="$(cat "$ESTADO/dono-chat" 2>/dev/null)"
  [[ -n "$chat" ]] || chat="$(python3 -c 'import json,sys; a=json.load(open(sys.argv[1])).get("allowFrom",[]); print(a[0] if len(a)==1 else "")' "$acesso" 2>/dev/null)"
  [[ -n "$chat" ]] || { log "FALHA: mais de um chat liberado e sem $ESTADO/dono-chat — não sei qual é o do dono"; exit 1; }
  canal="pelo Telegram (chat_id $chat)"
fi

PEDIDO="[Rotina da manhã, automática — não foi o dono quem escreveu isto] Mande agora UMA mensagem curta pro dono, $canal, no seu tom de sempre e sem falar de manutenção."
[[ -n "$cadernos" ]] && PEDIDO+=" Pergunte se estes assuntos ainda valem ou se pode guardar: $cadernos."
[[ -n "$duvidas" ]] && PEDIDO+=" Tire com ele estas dúvidas de organização: $duvidas."
PEDIDO+=" Use o nome do assunto como ele fala, não o slug. Quando ele responder, siga a seção 'Pergunta da manhã' da skill cadernos; o que foi perguntado está em $ABERTA."

if (( DRY )); then log "mandaria ao agente: $PEDIDO"; exit 0; fi

TX=(tmux -L agente)
"${TX[@]}" has-session -t agente 2>/dev/null || { log "agente desligado — fica pra próxima"; exit 0; }
# Dono conversando agora: a pergunta entraria no meio do assunto dele.
projeto="$CLAUDE_CONFIG_DIR/projects/$(pwd | tr '/._' '---')"
viva="$(ls -t "$projeto"/*.jsonl 2>/dev/null | head -1)"
if [[ -n "$viva" ]] && (( agora - $(stat -c %Y "$viva") < 900 )); then
  log "conversa em andamento — fica pra próxima"; exit 0
fi
corpo() { "${TX[@]}" capture-pane -p -t agente -S -12 2>/dev/null | grep -vE '[0-9]+:[0-9]{2}(:[0-9]{2})?'; }
antes="$(corpo)"; sleep 4; depois="$(corpo)"
[[ "$antes" == "$depois" ]] || { log "agente no meio de um turno — fica pra próxima"; exit 0; }

# O registro do que foi perguntado vai pro disco antes do envio: se a conversa for limpa
# antes de o dono responder, é por ele que o agente entende a resposta.
{ echo "# Pergunta em aberto — feita ao dono em $(date +%d/%m/%Y)"; echo
  [[ -n "$cadernos" ]] && echo "- Cadernos (ainda valem ou pode guardar?): $cadernos"
  [[ -n "$duvidas" ]] && echo "- Dúvidas: $duvidas"; } > "$ABERTA.$$" && mv "$ABERTA.$$" "$ABERTA"

"${TX[@]}" send-keys -t agente C-u
sleep 1
"${TX[@]}" send-keys -t agente -l "$PEDIDO"
sleep 1
"${TX[@]}" send-keys -t agente Enter
# Virou turno se algum jsonl do projeto foi escrito depois do envio.
pegou=0
for _ in 1 2 3 4 5 6 7 8; do
  sleep 5
  for f in "$projeto"/*.jsonl; do
    [[ -f "$f" && "$(stat -c %Y "$f")" -ge "$agora" ]] && pegou=1
  done
  (( pegou )) && break
done
if (( ! pegou )); then
  log "FALHA: pedido enviado mas o agente não começou o turno"; exit 1
fi
printf '%s\n' "${chaves[@]}" >> "$FEITAS"
echo "$agora" > "$ULTIMA.$$" && mv "$ULTIMA.$$" "$ULTIMA"
log "entregue ao agente (${#chaves[@]} itens): $(cut -c1-300 <<< "${cadernos}${duvidas:+ | $duvidas}")"
