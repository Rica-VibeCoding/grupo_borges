# grupo_borges

Cockpit multi-agente — escritório central da frota Claude Code do Rica.

## O que é

Web app que orquestra 6 agentes (Pavan, Daniel, Lucas, Vinicius, Felipe, Barsi), cada um rodando em sua sessão Claude Code. Permite plantar missões, observar handoffs em tempo real, gerenciar skills/tabelas/docs por agente, e abrir múltiplas instâncias paralelas pra missões grandes.

## Stack

- **Front:** Next.js 16 + React 19 + Tailwind 4 + shadcn/ui → Vercel
- **Backend:** FastAPI Python → VPS (systemd + Tailscale Serve pra HTTPS)
- **Banco:** SQLite WAL local na VPS
- **Bridge:** SSE (`sse-starlette`)
- **Auth:** Tailscale identity headers (sem senha custom)

## Status

**Fase 1 (Bootstrap backend) ✅ entregue 2026-05-09 — smoke test verde 2026-05-10.**

Backend FastAPI rodando em `127.0.0.1:8000` na VPS, capturando JSONL em tempo real via `watchfiles` (1857+ eventos no DB ao final do smoke). Próximo passo: prompt do Designer pra Fase 2 (UI).

Plano completo + 5 fases em [`PLANO.md`](./PLANO.md). Manual de implementação em [`AGENTS.md`](./AGENTS.md).

Frota viva em [`agents.yaml`](./agents.yaml).

## Estrutura

```
grupo_borges/
├── apps/
│   ├── web/          # Next.js → Vercel
│   └── api/          # FastAPI → VPS
├── packages/
│   └── shared-types/ # tipos TS gerados do schema Pydantic
├── .claude/
│   └── agents/       # subagents formalizados (daniel-research, etc)
├── agents.yaml       # config dos 6 agentes
├── PLANO.md
└── AGENTS.md
```

## Pra começar

Backend (VPS):

```bash
cd apps/api
uv sync
cp .env.example .env  # ajustar paths se não for VPS
uv run uvicorn main:app --host 127.0.0.1 --port 8000
```

Smoke checks:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/agents       # lista os 6 agentes
curl -X POST -H "Content-Type: application/json" \
  -d '{"session_id":"x","hook_event_name":"PostToolUse","cwd":"/home/clawd/repos/ze_claude/daniel","transcript_path":"/dev/null"}' \
  http://127.0.0.1:8000/hooks/PostToolUse
```

Frontend ainda no esqueleto (`apps/web/`) — aguardando handoff do Claude Designer (Fase 2).

## License

Privado — uso pessoal do Rica.
