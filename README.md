# grupo_borges

Cockpit multi-agente — escritório central da frota Claude Code do Rica.

## O que é

Web app que orquestra 6 agentes (Pavan, Daniel, Lucas, Vinicius, Felipe, Barsi), cada um rodando em sua sessão Claude Code. Permite plantar missões, observar handoffs em tempo real, gerenciar skills/tabelas/docs por agente, e abrir múltiplas instâncias paralelas.

## Estado atual — V2.5 (2026-05-13)

Cockpit operacional em produção. Card de cada agente mostra estado vivo + última ação narrativa em pt-BR.

**Documentação canônica é este README.** Bridges, planos de fase e auditorias intermediárias foram apagadas após cada entrega — o código no repo é a fonte da verdade. Pra entender qualquer comportamento atual: leia o código, não busque memos.

## Stack

- **Front:** Next.js 16 + React 19 + Tailwind 4 + shadcn/ui → Vercel
- **Backend:** FastAPI Python → VPS (systemd + Tailscale Serve pra HTTPS)
- **Banco:** SQLite WAL local na VPS
- **Bridge:** SSE (`sse-starlette`)
- **Auth:** Tailscale identity headers

## Estrutura

```
grupo_borges/
├── apps/
│   ├── web/          # Next.js → Vercel
│   └── api/          # FastAPI → VPS
├── packages/
│   └── shared-types/ # tipos TS gerados do schema Pydantic
├── .claude/agents/   # subagents formalizados
├── agents.yaml       # config dos 6 agentes
└── AGENTS.md         # manual operacional dos agentes
```

## Cockpit — modelo visual

### 3 estados primários + offline silencioso

| Estado | Cor / luz | Animação | Quando ocorre |
|---|---|---|---|
| **Ocioso** | cyan `#00f0ff` | estática | idle, done, Stop ("passou a bola"), turnos completos |
| **Trabalhando** | emerald `#10b981` | pulse 2s suave | qualquer tool ativa, thinking, responding, subagent |
| **Aguardando** | amber `#f59e0b` | pulse 1s intenso | blocked, StopFailure, PostToolUseFailure, precisa olhar |
| **Offline** | opacity 0.46 | sem glow | sem heartbeat há >5min |

Contraste semântico: **estático = pode ignorar**, **animado = requer atenção**. Quanto mais rápido pulsa, mais urgente.

### Last-action narrativa

Cada card mostra o último evento *pintável* (com summarize não-null), com texto em pt-BR — ex: `"escrevendo `apps/web/page.tsx`"`, `"rodou bash …/foo.sh"`, `"passou a bola"`, `"erro ao parar"`. A linha sempre fica visível: quando não há evento mapeado, mostra placeholder `"— sem atividade recente"`. Card não muda de altura entre estados.

### Mapeamento backend → estados

Implementação canônica em:
- `apps/api/routers/hooks.py::_hook_lifecycle` — hooks Claude → 4 estados
- `apps/api/db/store.py::derive_agent_status` — combina lifecycle + last_seen
- `apps/web/components/agent-card.tsx` — render + glow

Cobertura de eventos em `summarize()` em `apps/web/components/activity-feed.tsx`.

### Scripts repro pra debug

Em `~/repos/ze_claude/daniel/scripts/`:
- `v23-item2-repro-stop-hold.sh` — Pre + Stop (Trabalhando → Ocioso)
- `v25-aguardando-repro.sh` — Pre + StopFailure (Trabalhando → Aguardando)

Rodam contra `http://127.0.0.1:8000` no card do agente `lucas` (offline limpo). Saída texto com checkpoints de lifecycle no banco.

## Rodar local

Backend:

```bash
cd apps/api
uv sync
cp .env.example .env  # ajustar paths se não for VPS
uv run uvicorn main:app --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd apps/web
corepack pnpm install
corepack pnpm dev   # default: :3007 na VPS
```

Smoke:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/fleet | jq '.agents[] | {slug, status, lifecycle_status, lifecycle_detail}'
```

## License

Privado — uso pessoal do Rica.
