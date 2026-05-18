# Bloco 4 — Frontend: Badge fix pós-Bloco 2

## Escopo

Garantir que o `subagent-badge` no card do agente está alimentado pelo novo stack SSE-global+polling do Bloco 2 e não pelo EventSource local removido.

## Decisão estrutural (v2 — Pavan)

**OneLineChip de confirmação (A-automático) saiu do v2.** Vai pra backlog. Caminho B (Bloco 3) cobre 100% dos casos. A-automático é aditivo (novo evento SSE `spawn_proposal` + estado de proposta pendente no backend + race entre proposta+accept) — pode ser adicionado depois sem refazer nada estrutural. ROI baixo pra custo de manutenção alto.

## Arquivos tocados

- `/home/clawd/repos/grupo_borges/apps/web/components/agent-card.tsx:157-166` ← badge, verificar se hook ainda funciona após Bloco 2
- `/home/clawd/repos/grupo_borges/apps/web/lib/subagent-activity-context.tsx` ← deve estar refatorado pelo Bloco 2; apenas verificar

> Sem `chat-panel.tsx`, sem `one-line-chip.tsx`, sem emit `spawn_proposal` — A-automático saiu do v2.

## Pré-condições

- Bloco 1 concluído: tool MCP `spawn_subsession` existe
- Bloco 2 concluído: SseProvider no root layout + hook refatorado
- DS-71 implementado: componente OneLineChip existente em `apps/web/components/`

## Context7 — queries Tara consulta ANTES de codar

```
resolve_library_id("nextjs")
get_library_docs(<id>, topic="useContext event-driven pattern Client Component")

resolve_library_id("fastapi")
get_library_docs(<id>, topic="SSE emit custom event type")
```

Relatório salvo em `/tmp/tara-bloco-4-context7.md`. Confirmar formato de evento SSE customizado (campo `event:` no protocolo) antes de implementar o `spawn_proposal`.

## Passos

1. **Ler** `agent-card.tsx:157-166` após Bloco 2 estar aplicado.
2. **Confirmar** que `useSubagentActiveCount(slug)` consome o `SseProvider` global (via `subscribe(slug)`) e não cria `EventSource` próprio.
3. **Confirmar** que o hook também tem fallback polling via TanStack Query (`GET /api/agents/{slug}/subagents`, `refetchInterval: 5000`).
4. Se badge quebrado: ajustar o hook pra consumir context do `SseProvider` corretamente.
5. **Testar manualmente:** spawnar subsessão via Bloco 3, confirmar que badge incrementa no card **sem modal aberto** (golden test do JP-11 fix).

## Critério de aceite

- Badge no card do agente reflete contagem real de subsessões ativas **com modal fechado** (golden JP-11)
- Contador incrementa/decrementa em ≤ 6s (5s polling + margem) mesmo sem SSE
- Contador incrementa em ≤ 1s quando SSE está conectado
- Typecheck + build passam

## Riscos específicos

- **Dependência de Bloco 2:** se Bloco 2 não estiver completo, badge fix não tem como ser feito. Executar na ordem correta.
- **Hook `useSubagentActiveCount` pode ter caches obsoletos** após refactor do `subagent-activity-context.tsx`. Validar com `Set` invalidando ao montar.
