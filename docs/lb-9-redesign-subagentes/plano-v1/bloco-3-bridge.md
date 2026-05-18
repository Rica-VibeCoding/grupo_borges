# Bloco 3 — Bridge: Card da Task + Popover de spawn

> Status: **DONE** · Sessão: Daniel 8 (re-spawn) · Commit: `469163e` · 2026-05-18

## O que foi feito

### Frontend

**`apps/web/components/subsession-popover.tsx`** (novo — 220 linhas)
- `SubsessionPopover` Client Component com Popover ancorado no rodapé do TaskDetailModal
- `@radix-ui/react-popover` instalado (único Radix que faltava; cmdk 1.1.1 já estava)
- Combobox via `cmdk` com `Command.Input` + `Command.List` + `Command.Item`
  - `onSelect={() => setSelectedSkill(skill.name)}` — captura o nome original (cmdk normaliza `onSelect` val para lowercase em v1.x; usar closure evita o bug)
  - `data-selected` para highlight de seleção confirmada; `aria-selected` removido (conflitava com gerenciamento interno do cmdk)
- Toggle visible/background (`aria-pressed`)
- Textarea prompt opcional — fallback `selectedSkill` como prompt quando vazio (backend exige `min_length=1`)
- `skill: selectedSkill` enviado no payload (estava ausente na v1 — bug bloqueante fixado)
- `useRef<HTMLInputElement>` no `Command.Input` + foco via `requestAnimationFrame` no `handleOpenChange`
- Feedback unificado: `{ text, kind } | null` (era 2 states separados)
- Sucesso via `useToast` (`fire({ kind: 'success', ... })`) — feedback de erro ainda inline
- `role="status"` + `aria-live="polite"` na mensagem de erro
- Lista de subsessões ativas (`active | starting`) acima do trigger, fora do Popover
- `subsessionCss` exportado e injetado via `page.tsx` (padrão existente de `v2Css`)

**`apps/web/lib/use-subsessions.ts`** (novo)
- `useTaskSubsessions(taskId, agentSlug)` → polling 5s com:
  - `fetching` flag — evita requests concorrentes se fetch demorar > 5s
  - `JSON.stringify` change-detection — não dispara re-render se dados idênticos
  - Local captures `slug` / `tid` no início do effect — evita closure stale
  - `cancelled` flag para cleanup limpo

**`apps/web/lib/api.ts`**
- `spawnSubsession(agentSlug, payload)` — `agent_slug` adicionado internamente (não duplicado no payload)
- `fetchTaskSubsessions(agentSlug, taskId, signal?)` — normaliza response (`data.subagents ?? []`)
- `SubsessionSpawnPayload` / `SubsessionSpawnResult` types

**`apps/web/lib/cockpit-types.ts`**
- `SubagentEntry` type adicionado

**`apps/web/components/task-detail-modal.tsx`**
- `<SubsessionPopover>` integrado no footer quando `task.assignee != null && !editing && !confirmDelete`

**`apps/web/components/agent-card.tsx`**
- Removidos: `Dialog.Root` + `Dialog.Trigger` + `Dialog.Portal` + `NewInstanceForm` (linhas 195-320 originais)
- Removidos imports: `@radix-ui/react-dialog`, `createAgentInstance`, `SelectField`, `AgentCli`, `AgentModel`, `CLI_OPTIONS`, `MODELS_BY_CLI`
- Badge `subagent-badge` mantido (alimentado pelo Bloco 2 via SSE + polling REST)

## Decisões tomadas durante implementação

| Decisão | Motivo |
|---|---|
| `requestAnimationFrame` para focar o input ao abrir | `onOpenAutoFocus` do Radix conflita com `e.preventDefault()` — RAF garante que o DOM do Popover está montado antes do focus |
| `prompt: prompt.trim() \|\| skill` (fallback para skill name) | Backend exige `min_length=1` — sem fallback spawna com 422 |
| `agent_slug` adicionado internamente em `spawnSubsession` | Evita duplicação call-site; `SubsessionSpawnPayload` não expõe o campo |
| `onSelect={() => setSelectedSkill(skill.name)}` (closure, não val) | cmdk v1.x normaliza val para lowercase; closure captura o nome original |
| `fetching` flag em vez de AbortController no poll | AbortController por-tick adicionaria cleanup; `fetching` basta para o padrão polling do projeto |
| `subsessionCss` exportado do componente, não em cockpit-css.ts | cockpit-css.ts é 1 linha; editar uma string gigante para append de CSS novo é frágil. Padrão funcional validado: v2Css vem de componente também |

## Critérios de aceite verificados

- [x] Card de task tem `+ SUBSESSÃO` no rodapé (TaskDetailModal com assignee)
- [x] Popover abre ancorado no rodapé, não captura fluxo global (não é Dialog)
- [x] Combobox lista skills do workspace do agente-pai via `GET /api/agents/{slug}/skills`
- [x] Payload de spawn inclui `skill`, `prompt`, `visibility`, `task_id`, `agent_slug`
- [x] `visibility=false` → background silencioso; `visibility=true` → visível no contador
- [x] Lista de subsessões ativas aparece acima do botão
- [x] `agent-card.tsx` sem Dialog/NewInstanceForm
- [x] Typecheck limpo — `pnpm type-check` sem erros
- [x] HTML renderizado com `subsession-panel`, `subsession-popover`, `subsession-trigger` confirmados

## Pendências / tech-debt detectado (backlog)

- **Polling vs SSE**: `useTaskSubsessions` faz poll independente do SseProvider. Quando backend emitir evento `subsession.*`, o hook poderia reagir via SSE em vez de poll. Post-LB-9.
- **`SubagentEntry.status` tipagem**: `status: string` — poderia ser union type `'active' | 'starting' | 'completed' | 'stalled'`. Abrir issue no backlog.
- **`useAbortableFetch` extraível**: `agent-modal.tsx` e `subsession-popover.tsx` têm padrão semelhante. Extrair para `lib/use-abortable-fetch.ts` post-LB-9.

## Próximo: Bloco 4

Bloco 4 implementa badge fix + OneLineChip de confirmação (A-automático — backlog no v2).
No estado atual, Bloco 4 pode tratar apenas do badge fix (alimentado pelo Bloco 2, verificar se precisa de ajuste após Bloco 3).
