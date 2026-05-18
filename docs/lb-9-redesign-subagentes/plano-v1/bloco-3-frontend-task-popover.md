# Bloco 3 — Frontend: Card da Task + Popover de spawn

## Escopo

Adicionar ao card de task o painel de spawn de subsessões: botão `[+ Subsessão]` no rodapé, Popover com Combobox de skills, toggle visible/background, textarea de prompt opcional, e lista das subsessões ativas da task. Remove o código do botão "+" e `NewInstanceForm` do `agent-card.tsx`.

## Decisão estrutural (v2 — Pavan)

**SEM picker "com quem trabalhar".** Decisão Rica #1 cravou handoff puro: subsessão é spawn de filho independente — não há "parceiro". O painel só pergunta: qual skill, qual prompt, visível ou background. Decisão final.

## Arquivos tocados

- `/home/clawd/repos/grupo_borges/apps/web/components/agent-card.tsx` ← remover linhas 195-221 (Dialog+NewInstanceForm) e 248-320 (form)
- `/home/clawd/repos/grupo_borges/apps/web/components/task-card.tsx` ← verificar nome exato; pode ser `task-item.tsx` ou similar em `apps/web/components/`
- `/home/clawd/repos/grupo_borges/apps/web/components/subsession-popover.tsx` ← novo componente
- `/home/clawd/repos/grupo_borges/apps/web/lib/hooks/use-subsessions.ts` ← novo hook (ou em arquivo existente de hooks)

> Ler `apps/web/components/` pra confirmar nome do componente do card de task antes de editar.

## Pré-condições

- Bloco 1 concluído: endpoint `POST /api/agents/{slug}/subagents/spawn` disponível
- Bloco 2 concluído: `GET /api/agents/{slug}/subagents` disponível pra listar ativos por task
- shadcn `Popover` e `Command` (Combobox) instalados no projeto — verificar `components/ui/`; se ausentes, instalar via `npx shadcn@latest add popover command`

## Context7 — queries Tara consulta ANTES de codar

```
resolve_library_id("shadcn-ui") → shadcn/ui v3.5.0
get_library_docs(<id>, topic="Popover component usage App Router")
get_library_docs(<id>, topic="Combobox Command cmdk searchable list")
get_library_docs(<id>, topic="Popover anchor positioning rodapé card")

resolve_library_id("nextjs")
get_library_docs(<id>, topic="Client Component form submission fetch")
```

Relatório salvo em `/tmp/tara-bloco-3-context7.md`. Confirmar padrão exato de `Popover` + `Command` antes de escrever o componente.

## Passos

1. **Ler** `apps/web/components/agent-card.tsx` inteiro pra entender o que remover (linhas 195-221 e 248-320) e o que preservar (badge, restante do card).
2. **Ler** o componente de card de task pra entender onde adicionar o rodapé.
3. **Remover** de `agent-card.tsx`: Dialog, NewInstanceForm e o form com SelectField/checkbox `is_subagent`. Manter badge `subagent-badge` (alimentado pelo Bloco 2).
4. **Criar** `subsession-popover.tsx` (Client Component):
   - Props: `taskId: string, agentSlug: string, workspaceSkills: string[]`
   - Trigger: `Button` `[+ Subsessão]` no rodapé
   - Popover content:
     - `Combobox` de skills (`workspaceSkills` como opções, busca por nome)
     - Toggle: `visible` (padrão true) vs `background`
     - `Textarea` prompt (opcional, placeholder "Instrução adicional…")
     - `Button` "Spawnar" — chama `POST /api/agents/{agentSlug}/subagents/spawn` com `{ task_id, agent_slug, prompt, visibility }`
     - Lista de subsessões ativas da task (via `GET /api/agents/{slug}/subagents?task_id=X`) acima do trigger, usando OneLineChip pattern (DS-71)
5. **Criar** hook `use-subsessions.ts`:
   - `useTaskSubsessions(taskId, agentSlug)` → TanStack Query, `refetchInterval: 5000`, endpoint `GET /api/agents/{slug}/subagents?task_id=X`
6. **Integrar** `<SubsessionPopover>` no componente do card de task.
7. **Buscar** skills do workspace do pai: endpoint existente `GET /api/agents/{slug}/skills` (linha 207-215 em `agents.py`) — usar como fonte do Combobox.

## Critério de aceite

- Card de task tem botão `[+ Subsessão]` no rodapé
- Popover abre ancorado no rodapé, não captura fluxo global (não é Dialog)
- Combobox lista só skills do workspace do agente-pai (não de outros agentes)
- Spawn com `visibility=false` não aparece no contador do card de agente
- Spawn com `visibility=true` aparece no contador após SSE ou polling
- Lista de subsessões ativas da task aparece acima do botão
- `agent-card.tsx` não tem mais Dialog/NewInstanceForm (botão "+" removido)
- Typecheck + build passam

## Riscos específicos

- **Nome do componente de task:** pode não ser `task-card.tsx`. Ler o diretório antes.
- **`workspaceSkills` pro Combobox:** endpoint `GET /api/agents/{slug}/skills` retorna lista estática de `.claude/skills/`. Verificar formato do retorno antes de mapear pra opções do Combobox.
- **Popover no mobile:** container do card pode ter `overflow:hidden` que corta o Popover. Testar no iOS WebKit (Playwright webkit) — Rica usa Chrome iPhone 15 que é WebKit por baixo.
- **Fetch no Client Component:** confirmar que a URL do endpoint usa variável de ambiente (`NEXT_PUBLIC_API_URL` ou similar) e não está hardcoded.
