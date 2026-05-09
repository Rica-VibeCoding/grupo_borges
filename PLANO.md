# PLANO — grupo_borges

> Plano de implementação em 5 fases. Atualizar conforme avança.

## Visão

Cockpit web que orquestra 6 agentes Claude Code do Rica. 1 tela: cards de agente em cima + kanban horizontal embaixo (cada linha = "1 worker × 1 missão"). Click no card abre modal com 4 abas (Missão · Skills · Docs · Tabelas). Multi-instância paralela com modelo/CLI escolhível por instância.

## Stack

- **Front:** Next.js 16 + React 19 + Tailwind 4 + shadcn/ui → Vercel
- **Backend:** FastAPI Python → VPS (systemd + Tailscale Serve)
- **Banco:** SQLite WAL local (`apps/api/db/grupo_borges.db`) com write queue (1 thread escritor)
- **Bridge:** SSE (`sse-starlette`)
- **Auth:** Tailscale identity headers (sem senha custom)
- **Dev workflow:** PC primário (escrita) → GitHub → VPS pull (deploy/teste real)

## Padrões adotados (após pesquisa Context7+comunidade)

- **Multi-agent handoff:** `langgraph-swarm` com `Command(goto=..., graph=Command.PARENT)` — agente pinga outro autonomamente
- **Controle tmux:** `libtmux` (`capture_pane(escape_sequences=True, join_wrapped=True)` + `send_keys(enter=False)`)
- **Watch JSONL do CC:** `watchfiles` em `~/.claude/projects/<encoded>/<uuid>.jsonl` + `subagents/agent-{id}.jsonl`
- **Markdown @include resolver:** helper Python custom (regex `^@(.+\.md)$`) + `markdown-it-py` pro preview
- **Multi-instância:** 3 subagents do mesmo agente principal com `isolation: worktree` (cada instância em git worktree temporário, sem merge hell). Fallback: 3 sessões CC separadas pra missões longas

## UI

### Layout (1 tela)
- Topo: 6 cards de agente (avatar + status + nº instâncias ativas)
- Click no card → modal com 4 abas: Missão · Skills · Docs · Tabelas
- Embaixo: kanban horizontal — cada linha é "1 worker × 1 missão" com badge de status

### Visual escolhido (2026-05-09): Console Moderno
- Tipografia: Inter Sans (UI) + JetBrains Mono (IDs, timestamps, paths)
- Paleta: Grafite `#0e0e10` · Off-white `#f5f3ee` · Accent bronze `#b87332`
- Cantos `rounded-md` (4-6px), bordas 1px hairline
- Ícones: Lucide
- Light + dark mode
- Inspiração: Linear app, Vercel dashboard, Geist UI

## Schema SQLite (essencial)

6 tabelas: `tasks`, `task_links`, `task_runs`, `task_events`, `agent_state`, `agent_instances`.

Pragmas: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`.

Detalhe completo em `apps/api/db/schema.sql` (Fase 1).

## Endpoints (skeleton)

```
GET  /api/agents                    → estado dos 6 cards
GET  /api/tasks?status=running      → listar tasks
POST /api/tasks                     → criar task
PATCH /api/tasks/{id}               → mover lane / mudar assignee
POST /api/tasks/{id}/handoff        → agente A pinga agente B
POST /api/tasks/{id}/comment        → comentar
GET  /api/skills?agent=daniel       → skills + shared
POST /api/skills/install            → criar symlink
GET  /api/tables?agent=barsi        → tabelas Supabase do agente
GET  /api/docs?file=daniel/SOUL.md  → ler doc com @includes resolvidos
PUT  /api/docs                      → salvar (commit auto)
GET  /api/stream                    → SSE com eventos em tempo real
```

## 5 Fases

### Fase 1 — Bootstrap backend
- ✅ Criar repo `Rica-VibeCoding/grupo_borges` (público) — em curso
- ⏳ Monorepo Turbo + pnpm — `apps/web/` + `apps/api/` + `packages/shared-types/`
- ⏳ `apps/api/`: FastAPI app + middleware Tailscale + db schema + `tmux_driver.py` + `jsonl_watcher.py` + `/api/agents` (read state) + `/api/stream` SSE
- ⏳ systemd unit + Tailscale Serve config
- ⏳ Validar contra tmux real da VPS via SSH

### Fase 2 — UI no Claude Designer (em paralelo, com prompt do Daniel)
- ⏳ Daniel entrega prompt detalhado (telas, cards, modal, kanban horizontal, paleta, fontes, mock data via `agents.yaml`)
- ⏳ Designer gera Next.js 16 + Tailwind 4 + shadcn/ui
- ⏳ Mock conectado, design polido
- ⏳ SSE plugado no backend

### Fase 3 — Integração funcional
- `/api/tasks` CRUD + `/api/tasks/handoff` (LangGraph swarm)
- `/api/skills` + `/api/tables` + `/api/docs` (com @include resolver + commit auto)
- `agent_instances` + tmux dinâmico + escolha de modelo

### Fase 4 — Polimento
- Editor docs preview lado a lado
- PWA install + Tailscale mobile
- Testes mínimos

### Fase 5 — Lançamento
- Validação completa contra a frota
- Vercel produção
- Migração dos handoffs do Telegram pro cockpit

## Acervo de pesquisa

`daniel/fabrica-de-software/claude-code/` (no monorepo `ze_claude`) tem síntese acionável de:
- ✅ Subagents (`subagents.md`)
- ⏳ Hooks lifecycle
- ⏳ JSONL session format
- ⏳ Skills system
- ⏳ MCP servers

## Regra dura — decisão e pesquisa

- **Rica decide comportamento/UX.** Daniel decide técnica.
- Antes de implementar feature de escala: **pesquisar Context7 + comunidade** (GitHub, Discord, hermes-workspace, AutoGen, CrewAI, LangGraph) — padrões maduros, não invenção.
- Reportar: decisão técnica + 1-2 linhas de fundamento.
- Razão: escalar com segurança, evitar dívida técnica.

## Regras duras (NÃO esquecer)

- ⛔ Backend **Tailscale-only** — executa `send-keys`, expor publicamente é fatal
- ⛔ Sempre **OAuth**, nunca API key
- ⛔ **SQLite no MVP** — sem Supabase até dor real
- ⛔ Hermes Workspace + hermes-agent são **MIT** — estudar, não copiar código
- ✅ Default áudio Telegram pra Rica
