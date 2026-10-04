#!/usr/bin/env bash
# Executado no hospedeiro da Oracle 1 por subir.sh. Nunca imprime tokens.
set -euo pipefail

acao=${1:?acao obrigatoria}
commit=${2:-}
pacote=${3:-}
tela=${4:-}
node_bin=${5:-}
controlador_config=${PAINEL_CONTROLADOR_CONFIG:-/etc/painel/controlador.json}

ex() { incus --force-local exec --project "$1" "$2" -- "${@:3}"; }
inc() { incus --force-local "$@"; }

alvo() {
  local slug=$1
  if [[ $slug == portao ]]; then printf 'portao portao\n'; return; fi
  python3 - "$slug" "$controlador_config" <<'PY'
import json, sys
c = json.load(open(sys.argv[2]))['clients']
x = c.get(sys.argv[1])
if not x or not all(x.get(k) for k in ('project', 'instance')):
    sys.exit('cliente ausente do cadastro do controlador')
print(x['project'], x['instance'])
PY
}

snapshot() {
  local slug=$1 projeto instancia nome
  read -r projeto instancia < <(alvo "$slug")
  nome="painel-$(date -u +%Y%m%dT%H%M%S%NZ)-${commit:0:12}"
  inc snapshot create "$instancia" "$nome" --project "$projeto" --no-expiry
  printf 'Snapshot %s/%s/%s\n' "$projeto" "$instancia" "$nome"
}

push_arquivo() {
  local projeto=$1 instancia=$2 origem=$3 destino=$4
  inc file push "$origem" "$instancia$destino" --project "$projeto" --mode 0600
}

instalar_codigo() {
  local projeto=$1 instancia=$2
  push_arquivo "$projeto" "$instancia" "$pacote" /tmp/painel.tgz
  ex "$projeto" "$instancia" bash -s <<'SH'
set -euo pipefail
if id agente >/dev/null 2>&1; then
  install -d -m 0700 -o agente -g agente /casa/painel/uploads/agents
  # /casa pode ser volume separado: não se presume que o snapshot o cubra.
  for raiz in /opt/painel /opt/painel.velho; do
    origem="$raiz/apps/api/uploads/agents"
    [[ -d $origem ]] || continue
    while IFS= read -r -d '' arq; do
      rel=${arq#"$origem"/}
      destino="/casa/painel/uploads/agents/$rel"
      install -d -m 0700 -o agente -g agente "$(dirname "$destino")"
      if [[ -e $destino ]]; then
        cmp -s -- "$arq" "$destino" || { echo "Anexo antigo difere do destino: $rel" >&2; exit 1; }
      else
        cp -a -- "$arq" "$destino"
        chown agente:agente "$destino"
      fi
    done < <(find "$origem" -type f -print0)
  done
fi
if [[ ! -x /usr/local/bin/uv ]]; then
  echo 'uv ausente em /usr/local/bin/uv; instalar antes da subida' >&2
  exit 1
fi
cp /usr/local/bin/uv /tmp/uv
mkdir -p /tmp/painel-instalar
tar -xzf /tmp/painel.tgz -C /tmp/painel-instalar --strip-components=1 painel/deploy/painel-cliente/painel-instalar.sh
bash /tmp/painel-instalar/deploy/painel-cliente/painel-instalar.sh
rm -f /tmp/painel.tgz /tmp/uv
rm -rf /tmp/painel-instalar
SH
}

provar_cliente() {
  local slug=$1 projeto instancia
  read -r projeto instancia < <(alvo "$slug")
  ex "$projeto" "$instancia" systemctl is-active --quiet painel-cliente-api.service
  ex "$projeto" "$instancia" systemctl is-active --quiet agente.service
  ex "$projeto" "$instancia" bash -s -- "$slug" <<'SH'
set -euo pipefail
slug=$1
pronto=0
for _ in $(seq 1 36); do
  if curl -fsS --max-time 5 http://127.0.0.1:8010/health 2>/dev/null |
      python3 -c 'import json,sys; assert json.load(sys.stdin)["service"] == "grupo_borges-api-cliente"' 2>/dev/null; then
    pronto=1
    break
  fi
  sleep 5
done
[[ $pronto == 1 ]] || { echo "API de $slug não ficou pronta em 3 minutos" >&2; exit 1; }
token=$(cat /etc/painel/internal-token)
saida=$(mktemp)
prova=$(mktemp --suffix=.txt)
trap 'rm -f "$saida" "$prova"' EXIT
timeout 12 curl -fsSN --max-time 10 -H "Authorization: Bearer $token" "http://127.0.0.1:8010/api/agents/$slug/events" > "$saida" || status=$?
[[ ${status:-0} == 0 || ${status:-0} == 28 || ${status:-0} == 124 ]]
grep -q '^event: state' "$saida"
runuser -u agente -- mkdir -p "/casa/painel/uploads/agents/$slug"
alvo="/casa/painel/uploads/agents/$slug/.prova-subir-$$"
runuser -u agente -- sh -c 'printf prova > "$1" && test "$(cat "$1")" = prova && rm -- "$1"' sh "$alvo"
if [[ $slug == teste ]]; then
  printf 'prova de anexo do deploy\n' > "$prova"
  resposta=$(curl -fsS --max-time 20 -H "Authorization: Bearer $token" \
    -F "file=@$prova;filename=prova-subir.txt;type=text/plain" \
    "http://127.0.0.1:8010/api/agents/$slug/file")
  arquivo=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["path"])' "$resposta")
  [[ $arquivo == "/casa/painel/uploads/agents/$slug/"* ]]
  cmp -s "$prova" "$arquivo"
  rm -f -- "$arquivo"
fi
SH
  printf 'Provas cliente %s: health, units, SSE e anexos OK\n' "$slug"
}

instalar_cliente() {
  local slug=$1 projeto instancia
  read -r projeto instancia < <(alvo "$slug")
  snapshot "$slug"
  instalar_codigo "$projeto" "$instancia"
  ex "$projeto" "$instancia" systemctl daemon-reload
  ex "$projeto" "$instancia" systemctl restart painel-cliente-api.service
  provar_cliente "$slug"
}

instalar_portao() {
  snapshot portao
  instalar_codigo portao portao
  ex portao portao systemctl daemon-reload
  ex portao portao systemctl restart painel-portao.service
  ex portao portao bash -s <<'SH'
set -euo pipefail
pronto=0
for _ in $(seq 1 12); do
  if curl -fsS --max-time 5 http://127.0.0.1:8002/health 2>/dev/null |
      python3 -c 'import json,sys; assert json.load(sys.stdin)["service"] == "grupo_borges-api-portao"' 2>/dev/null; then
    pronto=1
    break
  fi
  sleep 5
done
[[ $pronto == 1 ]] || { echo 'API do portão não ficou pronta em 1 minuto' >&2; exit 1; }
SH
  push_arquivo portao portao "$tela" /tmp/painel-tela.tgz
  push_arquivo portao portao "$node_bin" /tmp/painel-node
  ex portao portao bash -s <<'SH'
set -euo pipefail
install -m 0755 /tmp/painel-node /usr/local/bin/node
mkdir -p /opt/painel-tela.novo
tar -xzf /tmp/painel-tela.tgz -C /opt/painel-tela.novo
test -f /opt/painel-tela.novo/apps/cockpit/server.js
test -d /opt/painel-tela.novo/apps/cockpit/.next-cliente/static
install -m 0644 /opt/painel/deploy/painel-cliente/painel-tela.service /etc/systemd/system/
chown -R painel:painel /opt/painel-tela.novo
rm -rf /opt/painel-tela.velho
if [[ -d /opt/painel-tela ]]; then mv /opt/painel-tela /opt/painel-tela.velho; fi
mv /opt/painel-tela.novo /opt/painel-tela
systemctl daemon-reload
systemctl enable --now painel-tela.service
systemctl restart painel-tela.service
systemctl is-active --quiet painel-tela.service
rm -f /tmp/painel-tela.tgz /tmp/painel-node
SH
  ex portao portao curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:8080/entrar
}

voltar() {
  local slug=$1 projeto instancia ultimo
  read -r projeto instancia < <(alvo "$slug")
  ultimo=$(inc snapshot list "$instancia" --project "$projeto" --format json |
    python3 -c 'import json,sys; xs=[x["name"] for x in json.load(sys.stdin) if x["name"].startswith("painel-")]; print(max(xs) if xs else "")')
  [[ -n $ultimo ]] || { echo "Sem snapshot painel para $slug" >&2; exit 1; }
  inc stop "$instancia" --project "$projeto"
  inc snapshot restore "$instancia" "$ultimo" --project "$projeto"
  inc start "$instancia" --project "$projeto"
  printf 'Restaurado %s/%s/%s; conferir serviços e volume /casa\n' "$projeto" "$instancia" "$ultimo"
}

case "$acao" in
  clientes) python3 - "$controlador_config" <<'PY'
import json,sys
c=json.load(open(sys.argv[1]))['clients']
for s in sorted(c):
    if s != 'teste': print(s)
PY
    ;;
  teste) instalar_cliente teste ;;
  portao) instalar_portao ;;
  cliente) instalar_cliente "${6:?slug obrigatorio}" ;;
  voltar) voltar "${6:?slug obrigatorio}" ;;
  *) echo "Ação remota inválida: $acao" >&2; exit 2 ;;
esac
