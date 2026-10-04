#!/usr/bin/env bash
# Roda na Oracle 0. A execução normal faz teste; --publicar libera a produção.
set -euo pipefail

raiz=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$raiz"
ssh_destino=${PAINEL_SSH_DESTINO:-ubuntu@136.248.125.21}
ssh_chave=${PAINEL_SSH_CHAVE:-$HOME/.ssh/casanova_ed25519}
lock=${PAINEL_LOCK:-/tmp/painel-cliente-subir.lock}
modo=teste
seco=0
voltar=

uso() { echo 'Uso: subir.sh [--seco] [--publicar | --voltar <cliente|portao>]' >&2; exit 2; }
while (($#)); do
  case "$1" in
    --seco) seco=1 ;;
    --publicar) [[ $modo == teste ]] || uso; modo=publicar ;;
    --voltar) [[ $modo == teste && $# -ge 2 ]] || uso; modo=voltar; voltar=$2; shift ;;
    *) uso ;;
  esac
  shift
done
[[ -z $voltar || $voltar =~ ^[a-z][a-z0-9-]*$ ]] || uso

exec 9>"$lock"
flock -n 9 || { echo 'Outra subida do painel cliente já está em andamento.' >&2; exit 73; }

commit=$(git rev-parse HEAD)
echo "Commit do pacote: $commit"
echo "Modo: $modo"
if ((seco)); then
  if [[ $modo == voltar ]]; then
    echo "[seco] Localizaria e restauraria o snapshot painel mais recente de $voltar."
  else
    echo '[seco] Conferiria a limpeza dos caminhos empacotados, rodaria pytest e montaria pacote da API.'
    echo '[seco] Faria build Next cliente standalone, juntaria static e public sem tar -h.'
    echo '[seco] Criaria snapshot, instalaria e provaria health, units, SSE e uploads em teste.'
    if [[ $modo == publicar ]]; then
      echo '[seco] Pediria confirmação; depois atualizaria portao, tela e cada cliente do cadastro com snapshot e provas.'
      echo '[seco] Provaria HTTPS /entrar 200 e / sem cookie redirecionando.'
    fi
  fi
  exit 0
fi
[[ $modo != publicar || -t 0 ]] || { echo '--publicar exige terminal interativo.' >&2; exit 1; }

ssh_opts=(-i "$ssh_chave" -o BatchMode=yes -o StrictHostKeyChecking=yes)
remoto() {
  local acao=$1 slug=${2:-}
  # slug validado localmente; os outros argumentos são nomes fixos sob /tmp.
  ssh "${ssh_opts[@]}" "$ssh_destino" \
    "sudo bash -s -- '$acao' '$commit' '/tmp/painel-$id.tgz' '/tmp/painel-tela-$id.tgz' '/tmp/painel-node-$id' '$slug'" \
    < deploy/painel-cliente/subir-remoto.sh
}

if [[ $modo == voltar ]]; then
  id=rollback
  remoto voltar "$voltar"
  exit
fi

entradas=(apps/api deploy/painel-cliente apps/cockpit packages/cockpit-core package.json pnpm-lock.yaml pnpm-workspace.yaml)
sujo=$(git status --porcelain --untracked-files=all -- "${entradas[@]}" \
  ':(exclude)apps/cockpit/tsconfig.json' ':(exclude,glob)apps/cockpit/.next*/**')
[[ -z $sujo ]] || { echo "Há mudanças não commitadas nos caminhos do pacote:" >&2; echo "$sujo" >&2; exit 1; }

apps/api/.venv/bin/pytest -q apps/api/tests

id="$(date -u +%Y%m%dT%H%M%S)-${commit:0:12}-$$"
trabalho=$(mktemp -d)
fonte="$trabalho/fonte"
git worktree add --detach "$fonte" "$commit" >/dev/null
limpar() {
  git worktree remove --force "$fonte" >/dev/null 2>&1 || true
  rm -rf "$trabalho"
}
trap limpar EXIT

mkdir -p "$trabalho/painel/apps" "$trabalho/painel/deploy"
cp -a "$fonte/apps/api" "$trabalho/painel/apps/"
rm -rf "$trabalho/painel/apps/api/.venv" "$trabalho/painel/apps/api/.pytest_cache"
find "$trabalho/painel/apps/api" -type d \( -name __pycache__ -o -name .ruff_cache \) -prune -exec rm -rf {} +
cp -a "$fonte/deploy/painel-cliente" "$trabalho/painel/deploy/"
tar -czf "$trabalho/painel.tgz" -C "$trabalho" painel

pnpm --dir "$fonte" install --frozen-lockfile
echo 'Compilando tela cliente standalone...'
( cd "$fonte/apps/cockpit" && COCKPIT_STANDALONE=1 COCKPIT_DIST_DIR=.next-cliente \
    NEXT_PUBLIC_COCKPIT_MODO=cliente API_BACKEND_URL=http://127.0.0.1:8002 \
    COCKPIT_BUILD_SEM_BACKEND=1 pnpm build )
origem="$fonte/apps/cockpit/.next-cliente"
[[ -f $origem/standalone/apps/cockpit/server.js && -d $origem/static ]] || {
  echo 'Build standalone incompleto.' >&2; exit 1;
}
mkdir -p "$trabalho/tela"
cp -a "$origem/standalone/." "$trabalho/tela/"
mkdir -p "$trabalho/tela/apps/cockpit/.next-cliente"
cp -a "$origem/static" "$trabalho/tela/apps/cockpit/.next-cliente/"
cp -a "$fonte/apps/cockpit/public" "$trabalho/tela/apps/cockpit/"
tar -czf "$trabalho/painel-tela.tgz" -C "$trabalho/tela" .
node_bin=$(command -v node)

enviar() {
  scp "${ssh_opts[@]}" "$trabalho/painel.tgz" "$ssh_destino:/tmp/painel-$id.tgz"
  scp "${ssh_opts[@]}" "$trabalho/painel-tela.tgz" "$ssh_destino:/tmp/painel-tela-$id.tgz"
  scp "${ssh_opts[@]}" "$node_bin" "$ssh_destino:/tmp/painel-node-$id"
}
limpar_remoto() {
  ssh "${ssh_opts[@]}" "$ssh_destino" \
    "rm -f /tmp/painel-$id.tgz /tmp/painel-tela-$id.tgz /tmp/painel-node-$id" >/dev/null 2>&1 || true
  limpar
}
trap limpar_remoto EXIT
enviar

remoto teste
if [[ $modo == publicar ]]; then
  printf 'Teste aprovado. Digite PUBLICAR para atualizar portão, tela e demais clientes: ' >&2
  read -r resposta
  [[ $resposta == PUBLICAR ]] || { echo 'Publicação cancelada.' >&2; exit 1; }
  remoto portao
  lista_clientes=$(remoto clientes)
  clientes=()
  if [[ -n $lista_clientes ]]; then mapfile -t clientes <<< "$lista_clientes"; fi
  for cliente in "${clientes[@]}"; do
    [[ $cliente =~ ^[a-z][a-z0-9-]*$ ]] || { echo "Slug inválido no cadastro: $cliente" >&2; exit 1; }
    remoto cliente "$cliente"
  done
  origem_publica=https://agentes.conectamoveis.net.br
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$origem_publica/entrar")
  [[ $status == 200 ]] || { echo "GET /entrar retornou $status" >&2; exit 1; }
  cabecalhos=$(curl -sS -D - -o /dev/null --max-time 15 "$origem_publica/")
  printf '%s\n' "$cabecalhos" | grep -qiE '^HTTP/[0-9.]+ 30[1278]'
  printf '%s\n' "$cabecalhos" | grep -qiE '^location: /entrar'
  echo 'Provas públicas: /entrar 200 e / sem cookie redireciona para /entrar.'
fi
echo "Concluído: $modo, commit $commit"
