#!/bin/bash
# Uso (root no hospedeiro): painel-add.sh <slug=projeto=instância> <Nome> <usuario> <arquivo-hash>
set -euo pipefail
S=$1; NOME=$2; USR=$3; HASH=$(cat "$4")
ex() { incus exec --project "$1" "$2" -- "${@:3}"; }
push() { incus file push --project "$1" "$3" "$2$4" --mode "$5" --uid "$6" --gid "$7"; }
W=$(mktemp -d -p /dev/shm); trap 'shred -u $W/* 2>/dev/null; rmdir $W' EXIT
for t in ctl interno gancho; do openssl rand -hex 32 > $W/$t; done

# hospedeiro: controlador
install -m 0600 $W/ctl /etc/painel/control-$S
python3 - "$S" <<'PY'
import json,sys; s=sys.argv[1]; p="/etc/painel/controlador.json"; c=json.load(open(p))
c["client_token_files"][s]=f"/etc/painel/control-{s}"; c["clients"][s]={"project":s,"instance":s}
json.dump(c,open(p,"w"),indent=1)
PY
systemctl restart painel-controlador

# cliente
AUID=$(ex $S $S id -u agente); AGID=$(ex $S $S id -g agente)
ex $S $S install -d -m 0750 -o root -g agente /etc/painel
ex $S $S sh -c 'apt-get install -y -qq jq curl >/dev/null 2>&1 || true'
push $S $S $W/interno /etc/painel/internal-token 0400 $AUID $AGID
push $S $S $W/gancho /etc/painel/hook-token 0400 $AUID $AGID
push $S $S $W/ctl /etc/painel/control-token 0400 $AUID $AGID
ex $S $S sh -c 'cat > /etc/painel/agent.yaml' <<Y
agents:
  - slug: $S
    name: $NOME
    tmux_session: agente
    workspace_path: /casa/workspace
    cli_default: claude_code
    model_default: opus
Y
ex $S $S sh -c 'cat > /etc/painel/cliente.env' <<E
PAINEL_CLIENT_SLUG=$S
PAINEL_INTERNAL_TOKEN_FILE=/etc/painel/internal-token
PAINEL_HOOK_TOKEN_FILE=/etc/painel/hook-token
PAINEL_CONTROL_SOCKET=/run/painel/control.sock
PAINEL_CONTROL_TOKEN_FILE=/etc/painel/control-token
PAINEL_RESUME_FILE=/casa/painel/resume-id
GB_AGENTS_YAML=/etc/painel/agent.yaml
GB_DB_PATH=/casa/painel/api.db
PAINEL_UPLOADS_DIR=/casa/painel/uploads
GB_CLAUDE_PROJECTS_DIR=/casa/claude/projects
CLAUDE_CONFIG_DIR=/casa/claude
COCKPIT_TMUX_SOCKET=agente
GB_STT_SCRIPT=/casa/claude/scripts/stt-openai.sh
E
ex $S $S sh -c 'chmod 0640 /etc/painel/agent.yaml /etc/painel/cliente.env; chgrp agente /etc/painel/agent.yaml /etc/painel/cliente.env
  install -d -m 0700 -o agente -g agente /casa/painel
  install -d -m 0700 -o agente -g agente /casa/painel/uploads/agents
  echo "d /run/painel 0770 agente agente -" > /etc/tmpfiles.d/painel.conf; systemd-tmpfiles --create /etc/tmpfiles.d/painel.conf
  install -m 0644 /opt/painel/deploy/painel-cliente/painel-cliente-api.service /etc/systemd/system/
  install -d /etc/systemd/system/agente.service.d
  printf "[Service]\nEnvironment=PAINEL_HOOK_TOKEN_FILE=/etc/painel/hook-token\nEnvironment=PAINEL_RESUME_FILE=/casa/painel/resume-id\nEnvironment=COCKPIT_API_URL=http://127.0.0.1:8010\n" > /etc/systemd/system/agente.service.d/painel.conf'
ex $S $S python3 - <<'PY'
p="/usr/local/bin/agente-subir"; s=open(p).read()
if "resume-args.sh" not in s:
    a='read -ra ARGS <<< "${AGENTE_ARGS:-}"\n'; assert a in s
    s=s.replace(a, a+'. /opt/painel/deploy/painel-cliente/resume-args.sh\nif [ -n "$PAINEL_RESUME_ID" ]; then\n  exec claude --dangerously-skip-permissions "${ARGS[@]}" --resume "$PAINEL_RESUME_ID"\nfi\n')
    open(p,"w").write(s)
PY
ex $S $S python3 - <<'PY'
import json; p="/casa/claude/settings.json"; s=json.load(open(p))
s["statusLine"]={"type":"command","command":"python3 /opt/painel/deploy/painel-cliente/statusline-capture.py"}
ss=s.setdefault("hooks",{}).setdefault("SessionStart",[])
if not any("briefing-retorno" in json.dumps(h) for h in ss):
    ss.append({"matcher":"resume","hooks":[{"type":"command","command":"/opt/painel/apps/api/scripts/briefing-retorno.sh","timeout":5}]})
json.dump(s,open(p,"w"),ensure_ascii=False,indent=2)
PY
ex $S $S sh -c 'systemctl daemon-reload && systemctl enable --now painel-cliente-api.service'

# portão
PUID=$(ex portao portao id -u painel); PGID=$(ex portao portao id -g painel)
push portao portao $W/interno /etc/painel/client-$S-token 0400 $PUID $PGID
ex portao portao python3 - "$S" "$USR" "$HASH" <<'PY'
import json,sys; s,u,h=sys.argv[1:]; p="/etc/painel/portao.json"; c=json.load(open(p))
c["users"][u]={"role":"client","slug":s,"password_hash":h}
c["clients"][s]={"socket":f"/run/cliente-api/{s}.sock","token_file":f"/etc/painel/client-{s}-token"}
json.dump(c,open(p,"w"),indent=1)
PY
ex portao portao systemctl restart painel-portao

# portas internas
incus project set $S restricted.devices.proxy=allow
incus config device add $S painel-api proxy --project $S bind=host listen=unix:/run/cliente-api-host/$S.sock connect=tcp:127.0.0.1:8010 mode=0660 uid=0 gid=0
incus config device add portao painel-$S proxy --project portao bind=instance listen=unix:/run/cliente-api/$S.sock connect=unix:/run/cliente-api-host/$S.sock mode=0660 uid="$PUID" gid="$PGID"
incus config device add $S painel-controle proxy --project $S bind=instance listen=unix:/run/painel/control.sock connect=unix:/run/painel-control/control.sock mode=0660 uid="$AUID" gid="$AGID"
ex $S $S systemctl is-active painel-cliente-api
echo ADD-OK
