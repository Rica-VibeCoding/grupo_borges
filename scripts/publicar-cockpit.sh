#!/usr/bin/env bash
# Publica o Cockpit v2 na 3008 da borges (a :3446 do Rica) a partir do origin/main.
#
# Um comando só, pra VPS e pro notebook:
#   na borges, como clawd:   scripts/publicar-cockpit.sh
#   no notebook:             scripts/publicar-cockpit.sh   (entra por SSH e roda lá)
#
# O roteiro é o do docs/cockpit-v2-stack.md §2, sem atalho:
#   - compila do origin/main num worktree próprio, nunca da árvore compartilhada:
#     build de base atrasada tira do ar o que outra sessão publicou (30/09), e build
#     da árvore suja publica trabalho pela metade (`-wip` no deploymentId);
#   - compila num estágio e só troca a pasta depois: compilar direto no `.next`
#     derruba os chunks da produção durante o build (04/08);
#   - prova o estágio numa porta reserva ANTES de trocar, e volta sozinho se a 3008
#     não responder depois do restart.
set -euo pipefail

REPO=/home/clawd/repos/grupo_borges
APP="$REPO/apps/cockpit"
PORTA_PROVA=3013
GUARDAR_ANTES=3

# Fora da borges: roda lá, como clawd, a versão deste script que está no origin/main.
if [[ "$(id -un)" != clawd ]]; then
    if [[ "$(hostname)" == vps-arm-borges* ]]; then
        exec sudo -n -u clawd bash "$(readlink -f "$0")"
    fi
    exec ssh -o BatchMode=yes ubuntu@borges \
        "sudo -n -u clawd bash -c 'cd $REPO && git fetch -q origin main && bash <(git show origin/main:scripts/publicar-cockpit.sh)'"
fi

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

exec 9>/tmp/publicar-cockpit.lock
flock -n 9 || { echo "outra publicação em curso — espere ela terminar"; exit 1; }

diz() { printf '[%s] %s\n' "$(date +%T)" "$*"; }

git -C "$REPO" fetch -q origin main
HASH="$(git -C "$REPO" rev-parse --short origin/main)"
ESTAGIO=".next-estagio-$HASH"

# O `next start` roda na árvore compartilhada: node_modules, public/ e next.config.ts
# vêm de lá, não do worktree. Dependência diferente quebra em runtime; avisar o resto.
if ! git -C "$REPO" diff --quiet HEAD origin/main -- package.json pnpm-lock.yaml apps/cockpit/package.json; then
    diz "a árvore da borges está com dependências diferentes do origin/main — pull + install lá antes de publicar"
    exit 1
fi
if ! git -C "$REPO" diff --quiet HEAD origin/main -- apps/cockpit/next.config.ts apps/cockpit/public; then
    diz "⚠️ next.config.ts ou public/ mudaram no origin/main e a árvore da borges não tem — o start usa os de lá"
fi

porta_livre() { ! ss -ltn | grep -q ":$PORTA_PROVA "; }
# Antes do build, que leva minutos — e de novo na hora da prova.
porta_livre || { diz "a $PORTA_PROVA está ocupada"; exit 1; }

# Mesmo disco do app: o `mv` do estágio troca o nome em vez de copiar.
WT="$(mktemp -d "$REPO-publicar.XXXX")"
PROVA_PID=""
limpa() {
    [[ -n "$PROVA_PID" ]] && kill -- "-$PROVA_PID" 2>/dev/null || true
    rm -rf "${APP:?}/$ESTAGIO"
    git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
}
trap limpa EXIT

diz "compilando $HASH num worktree próprio"
git -C "$REPO" worktree add -q --detach "$WT" origin/main
(cd "$WT" && corepack pnpm install --frozen-lockfile --prefer-offline --reporter=silent)
(cd "$WT/apps/cockpit" && COCKPIT_DIST_DIR="$ESTAGIO" corepack pnpm exec next build)

DPL="$(node -p 'require(process.argv[1]).config.deploymentId' \
    "$WT/apps/cockpit/$ESTAGIO/required-server-files.json")"
[[ "$DPL" != *-wip* ]] || { diz "deploymentId $DPL saiu sujo — não publico"; exit 1; }
rm -rf "${APP:?}/$ESTAGIO"
mv "$WT/apps/cockpit/$ESTAGIO" "$APP/$ESTAGIO"
# O worktree sai ANTES da prova: se o build tiver amarrado algum caminho dele, a
# prova falha aqui, com a produção intocada, e não depois da troca.
git -C "$REPO" worktree remove --force "$WT"

responde() {  # responde <porta>: a página E um chunk dela têm de voltar 200
    local html chunk
    html="$(curl -fsS --max-time 10 "http://127.0.0.1:$1/")" || return 1
    chunk="$(grep -oE '/_next/static/chunks/[^"]+\.js' <<<"$html" | head -1)"
    [[ -n "$chunk" ]] && curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:$1$chunk"
}
espera() { for _ in {1..30}; do responde "$1" && return 0; sleep 2; done; return 1; }

diz "provando o estágio na $PORTA_PROVA"
porta_livre || { diz "a $PORTA_PROVA está ocupada"; exit 1; }
cd "$APP"
COCKPIT_DIST_DIR="$ESTAGIO" setsid corepack pnpm exec next start --port "$PORTA_PROVA" --hostname 127.0.0.1 \
    >/tmp/publicar-cockpit-prova.log 2>&1 &
PROVA_PID=$!
espera "$PORTA_PROVA" || { diz "o estágio não respondeu — produção intocada (log: /tmp/publicar-cockpit-prova.log)"; exit 1; }
kill -- "-$PROVA_PID" 2>/dev/null || true
PROVA_PID=""

ANTES=".next-antes-$HASH-$(date +%H%M%S)"
diz "trocando a pasta e reiniciando a 3008"
mv .next "$ANTES"
mv "$ESTAGIO" .next
systemctl --user restart cockpit-v2

if ! espera 3008; then
    diz "a 3008 não voltou — desfazendo"
    mv .next ".next-falhou-$HASH-$(date +%H%M%S)" && mv "$ANTES" .next
    systemctl --user restart cockpit-v2
    espera 3008 && diz "voltou a versão anterior" || diz "🔴 a 3008 não respondeu nem com a anterior"
    exit 1
fi

NO_AR="$(curl -fsS --max-time 10 http://127.0.0.1:3008/ | grep -oE 'data-dpl-id="[^"]+"' | head -1 | cut -d'"' -f2)"
[[ "$NO_AR" == "$DPL" ]] || diz "⚠️ a página diz $NO_AR e o build gravou $DPL"

# Guarda só as últimas pastas de volta; cada uma pesa centenas de MB. As de um
# build que falhou ficam só até a próxima publicação que deu certo.
ls -dt .next-antes-* 2>/dev/null | tail -n +$((GUARDAR_ANTES + 1)) | xargs -r rm -rf
rm -rf .next-falhou-*

diz "✅ publicado $HASH (deploymentId $DPL) — https://borges.tailfe77db.ts.net:3446"
