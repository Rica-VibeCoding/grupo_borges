# Bloco 2 — Bridge (LB-9)

> Executor: Daniel 6 · Data: 2026-05-18 · Commit: cb1f03c

## O que foi feito

### Backend

**`apps/api/routers/events.py`**
- Novo endpoint `GET /api/events/stream?slugs=a,b,c` — SSE global multiplexado
- Protocol: snapshot inicial → poll 250ms → stall scan 10s → heartbeat 15s
- Server-side filter por slugs; cliente usa 1 conexão pra N slugs
- Fix de race window: cursor seq capturado ANTES do snapshot (não depois)
- Helper local `_public_subagent_status` (evita dict comprehension inline 3x)

**`apps/api/routers/agents.py`** (Bloco 1 + Bloco 2)
- Endpoint `GET /{slug}/subagents` adicionado por Bloco 1 (já estava lá quando B2 chegou)
- B2 adicionou e depois removeu duplicata — endpoint canônico é o do Bloco 1 (linha ~930)

### Frontend

**`apps/web/components/sse-provider.tsx`** (novo)
- Client Component; 1 EventSource global por cliente
- `subscribe(slug, handler)` / `unsubscribe(slug)` via context
- Debounce 200ms no rebuild da URL ao mudar set de slugs
- Backoff exponencial onerror: 1s → 2s → 4s → 8s → 15s → 30s
- `mountedRef` garante cleanup limpo na desmontagem

**`apps/web/app/layout.tsx`**
- `<SseProvider>` wrapping `{children}` no body

**`apps/web/lib/subagent-activity-context.tsx`**
- `useSubagentActiveCount(slug)` refatorado: SSE + polling REST 5s
- SSE via `sseCtx.subscribe(slug, handler)` — eventos em tempo real
- Polling REST `GET /api/agents/{slug}/subagents` a cada 5s como reconcile
- Change-detection no polling: `setStatusMap` só atualiza se dados diferirem
- SSE Map guard: não cria `Map` nova para entry já idêntica
- GC de entries terminais (completed/stalled) com TTL 10s
- Provider legado e `useSetSubagentStatusForAgent` mantidos (compat com page.tsx)

**`apps/web/components/chat-panel.tsx`**
- Removidos effects `publishSubagent` + import `useSetSubagentStatusForAgent`
- Badge não depende mais do ChatPanel estar aberto (JP-11 corrigido)

## Decisões tomadas

- **Sem TanStack Query**: não instalado no projeto. Polling via vanilla fetch + `setInterval`. D4 compliant.
- **Sem módulo compartilhado SSE helpers**: helper local em events.py em vez de novo arquivo (D4).
- **SubagentActivityProvider mantido**: compat backward, sem mudança em page.tsx.
- **Race window fix**: cursor capturado antes do snapshot → possíveis duplicatas de 'active' são idempotentes no frontend.

## Testes executados

- `pnpm type-check` → limpo ✓
- `pytest` (84 passed, 8 xpassed — sem test_codex_events.py que tinha falha pré-existente) ✓
- Smoke REST: `GET /api/agents/daniel/subagents` → JSON com 3 subagents ativos ✓
- Smoke SSE: `curl /api/events/stream?slugs=daniel,pavan` → eventos `subagent_status` chegando com campo `slug` ✓

## Pendências / backlog

- `SubagentActivityProvider` + `useSetSubagentStatusForAgent` em `subagent-activity-context.tsx` podem ser removidos quando page.tsx e outros callers forem atualizados (cleanup pós-LB-9)
- SSE multiworker: se escalar para múltiplos workers, precisará de broadcaster Redis (in-memory não compartilha entre processos). Para VPS single-worker: sem problema.
- `'starting'` status de Bloco 1 não tem tipo TS (entries com `status='starting'` não são contadas no badge e não entram no GC). Se Bloco 1 emitir 'starting' via SSE, essas entries ficarão na Map indefinidamente. Bloco 1 deve adicionar 'starting' ao tipo ou converter para 'active' imediatamente.
