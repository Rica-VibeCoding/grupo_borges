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

MVP em construção. Plano completo + 5 fases em [`PLANO.md`](./PLANO.md). Manual de implementação em [`AGENTS.md`](./AGENTS.md).

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

(em construção — ainda sem código rodando, só estrutura inicial e plano. Fase 1 do `PLANO.md`)

## License

Privado — uso pessoal do Rica.
