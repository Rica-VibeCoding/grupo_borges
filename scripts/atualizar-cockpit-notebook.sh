#!/usr/bin/env bash
# Traz para o cockpit do notebook o que foi publicado na VPS. É o "patch de atualização"
# pedido pelo Rica em 16/10: um comando no terminal dele, `atualizar-cockpit`.
#
# Roda NO NOTEBOOK, no clone ~/Projetos/grupo_borges (ramo `notebook-local`):
#   - junta o origin/main no ramo; conflito → desfaz a junção e para, sem tocar no que está no ar;
#   - dependência mudou → `pnpm install` / `uv pip`; testes do front; compila num estágio;
#   - prova o estágio na 3013 e só então troca a pasta e reinicia; 3008 não voltou → desfaz.
# Doc do cockpit do notebook: ze_claude/pavan/docs/cockpit-notebook.md.
set -euo pipefail

REPO="$HOME/Projetos/grupo_borges"
APP="$REPO/apps/cockpit"
PORTA_PROVA=3013
diz() { printf '[%s] %s\n' "$(date +%T)" "$*"; }

[[ "$(git -C "$REPO" branch --show-current)" == notebook-local ]] || { diz "o clone não está no ramo notebook-local"; exit 1; }
git -C "$REPO" diff --quiet && git -C "$REPO" diff --cached --quiet || { diz "há alteração não salva no clone — nada feito"; exit 1; }

# O ramo já carrega testes que falham (ordem da tropa da VPS, 16/10): o portão é não criar
# falha NOVA, não a suíte toda verde.
falhas() { (cd "$APP" && pnpm test 2>&1 || true) | grep -E '^✖ ' | grep -v 'failing tests' | sed -E 's/ \([0-9.]+ms\)$//' | sort -u; }

git -C "$REPO" fetch -q origin main
ANTES_DA_JUNCAO="$(git -C "$REPO" rev-parse HEAD)"
if [[ -z "$(git -C "$REPO" rev-list HEAD..origin/main)" ]]; then
    diz "já está com tudo da VPS ($(git -C "$REPO" rev-parse --short origin/main))"
    exit 0
fi
diz "testando o front antes da junção"
FALHAS_ANTES="$(falhas)"
# O que é identidade do notebook (o ícone tem outra forma de propósito) fica sempre o daqui.
DO_NOTEBOOK='^apps/cockpit/(public/(apple-touch-icon|icon-192|icon-512)\.png|app/layout\.tsx)$'
if ! git -C "$REPO" merge -q --no-edit origin/main >/dev/null 2>&1; then
    CONFLITOS="$(git -C "$REPO" diff --name-only --diff-filter=U)"
    if [[ -n "$CONFLITOS" ]] && ! grep -qvE "$DO_NOTEBOOK" <<<"$CONFLITOS"; then
        xargs -r git -C "$REPO" checkout --ours -- <<<"$CONFLITOS"
        xargs -r git -C "$REPO" add -- <<<"$CONFLITOS"
        git -C "$REPO" commit -q --no-edit
        diz "ícone do notebook mantido na junção"
    else
        git -C "$REPO" merge --abort
        diz "🔴 a junção com a VPS deu conflito — desfeita, cockpit intocado. Chamar o Daniel:"
        echo "$CONFLITOS"
        exit 1
    fi
fi
mudou() { ! git -C "$REPO" diff --quiet "$ANTES_DA_JUNCAO" HEAD -- "$@"; }
volta() { git -C "$REPO" reset -q --hard "$ANTES_DA_JUNCAO"; diz "junção desfeita"; }

if mudou package.json pnpm-lock.yaml apps/cockpit/package.json; then
    diz "dependências do front mudaram — instalando"
    (cd "$REPO" && pnpm install --frozen-lockfile --reporter=silent) || { volta; exit 1; }
fi

diz "testando o front depois da junção"
NOVAS="$(comm -13 <(echo "$FALHAS_ANTES") <(falhas) | sed '/^$/d')"
if [[ -n "$NOVAS" ]]; then
    diz "🔴 teste novo falhando:"; echo "$NOVAS"; volta; exit 1
fi

ESTAGIO=".next-estagio-$(git -C "$REPO" rev-parse --short HEAD)"
diz "compilando"
rm -rf "${APP:?}/$ESTAGIO"
(cd "$APP" && COCKPIT_DIST_DIR="$ESTAGIO" pnpm exec next build >/tmp/atualizar-cockpit-build.log 2>&1) || {
    diz "🔴 build falhou (log: /tmp/atualizar-cockpit-build.log)"; rm -rf "${APP:?}/$ESTAGIO"; volta; exit 1; }
# O `next build` acrescenta a pasta do estágio ao tsconfig; não é mudança de verdade.
git -C "$REPO" checkout -- apps/cockpit/tsconfig.json

responde() { curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$1/"; }
espera() { for _ in {1..30}; do responde "$1" && return 0; sleep 2; done; return 1; }

diz "provando na $PORTA_PROVA"
cd "$APP"
COCKPIT_DIST_DIR="$ESTAGIO" setsid pnpm exec next start --port "$PORTA_PROVA" --hostname 127.0.0.1 \
    >/tmp/atualizar-cockpit-prova.log 2>&1 &
PROVA=$!
if ! espera "$PORTA_PROVA"; then
    kill -- "-$PROVA" 2>/dev/null || true
    rm -rf "${APP:?}/$ESTAGIO"; volta
    diz "🔴 o estágio não respondeu — cockpit intocado"; exit 1
fi
kill -- "-$PROVA" 2>/dev/null || true

ANTES=".next-antes-$(date +%H%M%S)"
diz "trocando e reiniciando"
mv .next "$ANTES"
mv "$ESTAGIO" .next
systemctl --user restart cockpit-v2
if mudou apps/api; then
    mudou apps/api/requirements.txt && (cd "$REPO/apps/api" && uv pip install -q -r requirements.txt --python .venv/bin/python)
    systemctl --user restart cockpit-api
fi

if ! espera 3008; then
    mv .next ".next-falhou-$(date +%H%M%S)" && mv "$ANTES" .next
    systemctl --user restart cockpit-v2
    diz "🔴 a 3008 não voltou — versão anterior de volta (o código ficou na nova; chamar o Daniel)"
    exit 1
fi
ls -dt .next-antes-* 2>/dev/null | tail -n +3 | xargs -r rm -rf
diz "✅ cockpit do notebook com $(git -C "$REPO" rev-parse --short origin/main) da VPS"
