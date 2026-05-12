# AGENTS.md — Manual de implementação grupo_borges

Lido pelo Codex CLI E pelos Claude Codes que mexem neste repo.

## O que este repo é

Cockpit web multi-agente. Front Next.js → Vercel. Backend FastAPI → VPS (Tailscale-only). SQLite WAL local. SSE pra streaming. Sem senha custom — Tailscale identity headers.

**Estado atual (2026-05-10):** Fase 1 (backend) ✅ entregue e smoke verde. Frontend (`apps/web/`) é skeleton, aguardando Fase 2.

## Antes de codar (regra dura)

1. `git pull --rebase`
2. Ler `PLANO.md` pra entender estado atual + fase corrente
3. Consultar `daniel/fabrica-de-software/claude-code/` no monorepo `ze_claude` pra padrões CC (subagents, hooks, skills, MCP, JSONL) — síntese acionável já curada
4. Context7 obrigatório em feature de framework (Next 16, FastAPI, libtmux, shadcn)

## Estrutura do monorepo

```
grupo_borges/
├── apps/
│   ├── web/                  # Next.js → Vercel
│   │   ├── app/              # App Router, server components
│   │   └── components/       # shadcn-based
│   └── api/                  # FastAPI → VPS
│       ├── main.py           # entry + middleware Tailscale
│       ├── routers/          # tasks, agents, skills, tables, docs, stream
│       ├── orchestrator/     # tmux_driver, jsonl_watcher, handoff, heartbeat
│       ├── db/               # schema.sql + store.py (write queue)
│       └── config/
│           └── agents.yaml   # symlink ou cópia do raiz
├── packages/
│   └── shared-types/         # tipos TS gerados do schema Pydantic
├── .claude/
│   └── agents/               # subagents formalizados (daniel-research, etc)
└── agents.yaml               # config dos 6 agentes
```

## Stack — versões

- pnpm 10.x · Turbo latest · Node 22
- Next.js 16.x · React 19.x · TypeScript 5.7+ strict
- Tailwind 4.x (sem `tailwind.config.js` — tema em CSS via `@theme inline`)
- shadcn/ui (`shadcn@latest`, NÃO `shadcn-ui`)
- Python 3.11+ · FastAPI 0.115+ · sse-starlette · libtmux · watchfiles · markdown-it-py

## Padrões

### Frontend (Next.js)
- App Router (server components + server actions). NUNCA `pages/api/*`.
- Data fetching via `fetch({ next:{ tags, revalidate }})` — não `getServerSideProps`/`getStaticProps`
- `useActionState` (R19), NÃO `useFormState`
- `params`/`searchParams` são `Promise` — sempre `await`
- `cookies()` é async — `await cookies()`
- Tema em `globals.css` via `@theme inline` (Tailwind 4)

### Backend (FastAPI)
- Tudo `async def` + `await`
- SSE via `sse-starlette` `EventSourceResponse`
- DB: 1 thread escritor (queue) + leituras paralelas (cada request abre conn própria com `check_same_thread=False`)
- Pragmas obrigatórios: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`
- libtmux: `capture_pane(escape_sequences=True, join_wrapped=True)`, `send_keys(enter=False)` + `enter()` em sequência
- watchfiles: filtros pra `*.jsonl` em `~/.claude/projects/<encoded>/<uuid>.jsonl` + subpasta `subagents/`

### Auth
- Tailscale identity headers (`Tailscale-User-Login`) validado em middleware FastAPI
- Sem senha custom no MVP — tailnet basta
- CORS configurado pra `https://<grupo-borges>.vercel.app` no front

## Forbidden patterns

- ❌ `pages/api/*` → ✅ `app/api/*/route.ts`
- ❌ API key Anthropic/OpenAI no backend → ✅ sempre OAuth via Claude Code
- ❌ Acesso público ao backend → ✅ Tailscale-only (fail-closed bind)
- ❌ Supabase no MVP → ✅ SQLite WAL local
- ❌ Polling pra estado dos agentes → ✅ watchfiles em JSONL + heartbeat
- ❌ `useFormState` → ✅ `useActionState`
- ❌ `cookies().get(...)` síncrono → ✅ `(await cookies()).get(...)`

## Naming

- Pastas/arquivos: kebab-case (`tmux-driver.py` é exceção — Python prefere snake_case → `tmux_driver.py`)
- Python módulos: snake_case
- TS funções/vars: camelCase · tipos: PascalCase
- DB: snake_case (`tasks`, `agent_state`, `task_runs`)

## Git workflow

- Identidade: `Ricardo Borges <conectamoveis@gmail.com>` (Vercel preview exige)
- Conventional commits: `feat(scope)`, `fix(scope)`, `docs(scope)`, `refactor:`, `chore:`
- `git pull --rebase` antes de cada edit longo
- NUNCA `--force push`. NUNCA `git add -A` na raiz quando outro Zé tá editando paralelo

## Quando NÃO confiar em treino

Context7 obrigatório em:
- Feature nova de Next 16 / React 19 / FastAPI / Tailwind 4
- libtmux assinaturas
- sse-starlette padrões
- shadcn CLI (`shadcn@latest`)
- LangGraph swarm handoff

## Workflow obrigatório antes de codar (REGRA DURA — firmada pelo Rica 2026-05-10)

Toda implementação de escala neste repo passa por 8 passos em ordem. Documentado originalmente em `ze_claude/daniel/memory/2026-05-10-cockpit-3-endpoints.md`:

1. **Ultrathink** — mapear escopo, edge cases, antecipar achados de review antes de escrever 1 linha
2. **Context7** — `mcp__context7_global__query-docs` na stack tocada (Next 16, Tailwind 4, Radix, libtmux, etc) pra forma atual; nunca confiar só em treino
3. **Implementar** + **smoke test verde** (`pnpm dev` / `curl /health` / typecheck — o que couber)
4. **2 agents em paralelo:** `code-simplifier:code-simplifier` + `general-purpose` (com prompt explícito de code review)
5. **Validar in loco** — convergências aplicam; discordâncias descartam *com argumento técnico*, não silêncio
6. **Aplicar cirurgicamente** — só os fixes acordados; sem refator profundo de oportunidade
7. **Re-smoke** + commit (conventional + scope) + push
8. **Atualizar `daniel/cockpit-bridge.md`** com tech-debt nova ou estado da fase

## Fase B — apps/web/ (corrente, 2026-05-10)

Bundle do Claude Designer chegou em `/tmp/cockpit-bundle/cockpit-grupo-borges-spec-padr-es/`:
- `README.md` — instruções do Designer pro coding agent
- `chats/chat[1-6].md` — transcript da iteração (chat6 = última)
- `project/Cockpit · Polish v1.html` (67KB) — **arquivo PRIMÁRIO** (cockpit completo + 5 estados: live / loading / sse-off / reduced-motion / toast)
- `project/Cockpit · Agent Modal v1.html` (57KB) — modal 4-tabs
- `project/kanban-tweaks.jsx`, `project/tweaks-panel.jsx` — componentes JSX prontos
- `project/uploads/` — referências históricas (NÃO usar como template)

**Refactor incremental (firmado por Daniel-PC):**
1. Plantar `Polish v1.html` quase ipsis litteris em `apps/web/app/page.tsx` (HTML + CSS inline). Validar `pnpm dev`.
2. Extrair componentes mantendo CSS: `agent-card`, `kanban-board`, `kpi-strip`, `filter-bar`, `agent-modal`, `sse-banner`, `toast-stack`
3. Plugar SSE real **só depois da estrutura nascer**: `lib/api.ts` → `/api/fleet` + `EventSource('/api/stream')`, troca mock por dados reais

## Backend vivo — endpoints disponíveis (`:8000` localhost, Tailscale-only em prod)

- `GET /health` — probe
- `GET /api/agents` — lista 6 agentes
- `GET /api/agents/{slug}` — detalhe
- `GET /api/agents/{slug}/instances` — instâncias (paralelismo)
- `GET /api/agents/{slug}/sparkline` — série horária 24h
- `GET /api/fleet` — **agregado num único shot** (6 agents + instances + sparklines + KPIs + health) — preferir este pro hydration inicial
- `GET /api/tasks` — CRUD completo
- `GET /api/stream` — SSE de eventos
- `POST /hooks/{event_kind}` — interno (hooks Claude Code postam aqui), não chamar do front

Schema canônico em `apps/api/db/schema.sql`. Status enum: `Literal["idle","running","blocked","done","offline"]`. tmux session: `<slug>` ou `<slug>-N`.

## Tara Kaur — parceira Codex (gpt-5.5)

Codex CLI rodando neste repo a partir de 2026-05-10. Nome: **Tara Kaur** (sânscrito *estrela* + sikh *princesa/leoa*, par com Daniel Singh).

- Coordenação: Daniel-VPS (Opus 4.7) pensa/decide/revisa; Tara executa código (refactor mecânico, plant de bundle, scaffolding, testes, fix pontual).
- Ela **só lê `AGENTS.md`**, não `CLAUDE.md` nem `OPS.md`. Tudo que precisa pra codar com excelência mora aqui.
- Prompt curto (≤25 linhas, regra firmada). Stacked instructions degradam output.
- Em paralelo é OK *desde que tarefas sejam disjuntas* (arquivos/áreas diferentes). Edit concorrente no mesmo arquivo → não.
- Diff revisado por Daniel-VPS antes de commit. Tara não commita sem aval explícito.

## Comunicação com Rica

- Respostas finais devem ser listas simples, curtas e objetivas.
- Começar pela conclusão, sem contexto longo.
- Evitar relatórios verbosos; no máximo 3-5 bullets quando possível.
- Separar claramente: feito, pendente, próximo passo.
- Output confuso ou prolixo é inaceitável.
