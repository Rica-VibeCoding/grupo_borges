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
