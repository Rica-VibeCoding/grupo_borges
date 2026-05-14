# Cockpit `grupo_borges` — Brief pro Claude Designer

## Estado atual — 2026-05-12

Este arquivo é o índice histórico do trabalho no Claude Designer. Os 5 turnos já foram entregues e o port para `grupo_borges/apps/web/` já aconteceu.

Fonte viva de implementação: `/home/clawd/repos/grupo_borges`.

Status operacional:

- Frontend Next.js 16 implementado em `apps/web/`.
- Backend FastAPI evoluiu além da Fase 1: `/api/fleet`, dispatch manual auditável, stdout curto de tmux, claim atômico, heartbeat/stale detection e dispatcher automático opcional.
- Hooks HTTP `PostToolUse` configurados nos 6 workspaces principais e confirmados no banco. Lifecycle completo continua opcional.
- Snapshots canônicos de design: `entregas/05-polish-v1.html` e `entregas/03-modal-v2.html`.

## Como usar

Uso histórico/referência. Para novas iterações visuais, abrir o Designer a partir dos snapshots canônicos; para código, editar o monorepo `grupo_borges`.

1. Abra um chat novo no **Claude Design** (`claude.ai/design`).
2. Cole os 5 turnos abaixo em **sessões sequenciais** do projeto (cada turno em chat próprio, mantém histórico organizado).
3. Quando aprovado, exporte via **Send to local coding agent** → handoff bundle pro Daniel-VPS implementar em `apps/web/`.

## Turnos (`turnos-sci-fi/`)

| # | Arquivo | O que adicionar |
|---|---|---|
| 1 | `01-foundation.md` | Foundation visual + 1 card único do Daniel em 5 estados + multi-instância |
| 2 | `02-grid-frota.md` | 6 cards da frota + header + filter bar + KPI panel + footer técnico |
| 3 | `03-modal.md` | Modal de detalhe com 4 tabs (Missão · Skills · Docs · Tabelas) |
| 4 | `04-kanban.md` | Kanban tabular denso (5 colunas Linear-issue-list, IDs em mono colorido) |
| 5 | `05-polish.md` | Banner SSE error · loading scan-line · focus rings · `prefers-reduced-motion` · toast |

**Padrão dos briefings (v3, validado):** paleta + conceito + funções DUROS · forma + composição + animação SOLTOS. Detalhes em `feedback_claude_design_briefing.md` (memória).

**Stack alvo da implementação pós-handoff:** Next.js 16 + Tailwind 4 + Radix primitives + componentes custom + augmented-ui.

## Fixes pontuais (`tweaks/`)

Mini-ajustes pós-entrega vão pra `tweaks/` como prompts versionados:

- `tweak-*.md` — ajustes pra rodar via modo **Tweaks** no canvas (free, não queima Send).
- `send-*.md` — fixes que Tweaks não pegou, agrupados em 1 Send consolidado.

## Estado do trabalho paralelo

- ✅ **Backend Fase 1 fechado** (smoke verde 2026-05-10) e já evoluído nas Fases 4.x.
- ✅ **`grupo_borges/apps/web/` implementado**; não está mais em estado skeleton.
- ✅ **Hooks HTTP `PostToolUse`** nos 6 workspaces principais, apontando para `http://localhost:8000/hooks/PostToolUse`.
- ⏳ **Lifecycle hooks completos** (`UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`) — opcionais se o cockpit precisar de mais granularidade que `PostToolUse` + JSONL watcher.

Estado completo no `daniel/cockpit-bridge.md`.
