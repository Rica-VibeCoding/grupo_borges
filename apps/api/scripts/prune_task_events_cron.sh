#!/usr/bin/env bash
# Poda de retenção do cockpit — mantém 3 dias de task_events, a cada 3 dias.
# Crontab do clawd roda em horário local (BRT), confirmado pelos logs dos
# outros jobs diários.
#
# 18/08: a janela era de 30 dias e o job rodava todo dia sem apagar quase nada
# — a tabela cresce ~90 MB/dia e chegou a 1,19 GB antes de o corte de 30 dias
# alcançar qualquer coisa (o log de 17/08 apagou 295 eventos de uma tabela de
# 997 MB). O Rica não usa o histórico do painel (usa memory/ e o MURAL), e
# evento preso a uma task — o que o podador nunca toca — são 185 linhas com
# 0 MB. Daí a janela virar 3 dias.
#
# VACUUM agora roda sempre: com o arquivo em 380 MB custa ~12s, e a cada 3
# dias sobra I/O. O "só aos domingos" nem casaria com esta frequência.
#
# O backup vai ANTES do DELETE porque a janela curta apaga muito mais que a
# antiga. Só o mais recente fica — o ponto é ter para onde voltar se a poda
# sair errada, não guardar acervo.
set -euo pipefail

API_DIR="/home/clawd/repos/grupo_borges/apps/api"
BACKUP_DIR="/home/clawd/backups/cockpit"
RETENTION_DAYS=3

cd "$API_DIR"
mkdir -p "$BACKUP_DIR"

/usr/bin/python3 scripts/backup_db.py "$API_DIR/db/grupo_borges.db" "$BACKUP_DIR"

# flock evita dois runs concorrentes se um estourar a janela do cron.
exec flock -n /tmp/prune_task_events.lock \
  /usr/bin/python3 scripts/prune_task_events.py --days "$RETENTION_DAYS" --vacuum
