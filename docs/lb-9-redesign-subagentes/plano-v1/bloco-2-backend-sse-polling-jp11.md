# Bloco 2 — Backend: SSE global multiplexado + polling REST (fix JP-11)

## Escopo

Corrigir JP-11 com **1 EventSource global multiplexado** no root layout do Next.js, novo endpoint `GET /api/events/stream?slugs=daniel,pavan,...` que server-filtra eventos por slugs subscritos. Substitui N streams por slug (não escala: 7 agentes = 7 conexões por cliente). Endpoint REST `GET /api/agents/{slug}/subagents` como snapshot reconcile via polling 5s. Badge funciona com modal fechado.

## Arquivos tocados

**Backend:**
- `/home/clawd/repos/grupo_borges/apps/api/routers/events.py` ← **novo router**: `GET /api/events/stream?slugs=a,b,c` (SSE global multiplexado, server-side filter por slugs)
- `/home/clawd/repos/grupo_borges/apps/api/routers/agents.py` ← novo endpoint `GET /{slug}/subagents` (snapshot reconcile)
- `/home/clawd/repos/grupo_borges/apps/api/orchestrator/jsonl_watcher.py` ← expor `subagent_active_snapshot` por slug se já não for + emitir evento no canal global

**Frontend:**
- `/home/clawd/repos/grupo_borges/apps/web/app/layout.tsx` (ou `app/(dashboard)/layout.tsx`) ← adicionar `<SseProvider>`
- `/home/clawd/repos/grupo_borges/apps/web/components/sse-provider.tsx` ← novo Client Component com **1 EventSource global**; expõe API `subscribe(slug)` / `unsubscribe(slug)` via context
- `/home/clawd/repos/grupo_borges/apps/web/lib/subagent-activity-context.tsx` ← refatorar hook pra usar `subscribe(slug)` do SseProvider
- `/home/clawd/repos/grupo_borges/apps/web/components/chat-panel.tsx` ← remover EventSource local (verificar linhas antes)

> Verificar: pode já existir um SSE provider ou contexto de eventos no projeto. Ler `apps/web/lib/` e `apps/web/app/layout.tsx` antes de criar componente novo.

## Pré-condições

- Nenhuma do LB-9 (é fix independente de JP-11)
- Entender onde o EventSource atual vive: `apps/web/lib/subagent-activity-context.tsx:91-102`

## Context7 — queries Tara consulta ANTES de codar

```
resolve_library_id("nextjs") → Next.js 16 App Router
get_library_docs(<id>, topic="root layout client component provider pattern")
get_library_docs(<id>, topic="server component vs client component boundary")

resolve_library_id("fastapi") → FastAPI 0.128.0
get_library_docs(<id>, topic="SSE StreamingResponse Starlette")
get_library_docs(<id>, topic="multiworker SSE scaling broadcaster")

resolve_library_id("tanstack-query")
get_library_docs(<id>, topic="polling interval refetchInterval")
```

Relatório salvo em `/tmp/tara-bloco-2-context7.md`. Confirmar padrão de provider no App Router antes de criar o `SseProvider`.

## Passos

1. **Ler** `apps/web/app/layout.tsx` (root e qualquer layout de dashboard) e `apps/web/lib/subagent-activity-context.tsx` pra entender estrutura atual.
2. **Backend:** adicionar `GET /api/agents/{slug}/subagents` em `routers/agents.py` retornando snapshot de `_subagent_state` filtrado por `slug`. Sem autenticação extra se o padrão do projeto não exige pra outros endpoints do slug.
3. **Backend:** criar `routers/events.py` com `GET /api/events/stream?slugs=a,b,c`:
   - StreamingResponse SSE
   - Filtro server-side: emite só eventos cujos `slug` está na query
   - Quando cliente reconecta com novos slugs, antiga conexão fecha
4. **Frontend:** criar `components/sse-provider.tsx` como Client Component:
   - **1 EventSource global** (não singleton por slug — singleton absoluto)
   - Mantém `Set<string>` de slugs subscritos; debounce 200ms ao mudar subscribers
   - Reconecta endpoint `/api/events/stream?slugs=...` quando set muda
   - Expõe `subscribe(slug, handler)` / `unsubscribe(slug)` via context
   - `onerror` com backoff exponencial (1s → 2s → 4s → max 30s) pra evitar reconnect loop (regressão JP-11)
5. **Frontend:** adicionar `<SseProvider>` no layout correto (onde todos os agents são renderizados).
6. **Frontend:** refatorar `subagent-activity-context.tsx` — cada `useSubagentActiveCount(slug)` chama `subscribe(slug)` no mount, `unsubscribe(slug)` no unmount.
7. **Frontend:** remover `EventSource` de `chat-panel.tsx` onde duplicava.
8. **Frontend:** atualizar `useSubagentActiveCount(slug)` pra também ter fallback polling via TanStack Query `GET /api/agents/{slug}/subagents` com `refetchInterval: 5000`.

## Critério de aceite

- Badge de subagente no `agent-card` mostra contagem correta **sem o modal/ChatPanel aberto**
- Fechar e reabrir o modal não reseta o contador
- `GET /api/agents/{slug}/subagents` retorna JSON com lista de subsessões ativas do slug
- Só 1 conexão SSE visível no DevTools Network quando múltiplos cards de agente estão visíveis
- Typecheck + build passam no frontend

## Riscos específicos

- **Server Component boundary:** `SseProvider` precisa ser Client Component mas o layout pode ser Server. Padrão: wrapper Client importado dentro do Server layout. Context7 confirma isso.
- **EventSource URL hardcoded:** verificar se a URL SSE atual usa variável de ambiente ou path relativo. Não quebrar endpoint existente.
- **Multiworker SSE:** Context7 alertou que SSE in-memory não escala em multiworker. No v1 VPS roda worker único — aceitável. Marcar como backlog Redis broadcaster se escalar.
- **Reconnect loop:** JP-11 era EventSource que reabre em loop. Garantir que `SseProvider` tem `onerror` com backoff e não reconecta infinitamente.
