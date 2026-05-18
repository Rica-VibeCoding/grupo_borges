# LB-9 — Redesign UX de subagentes — Round 1 do debate

> Task cockpit: `7a1a369a-737a-452d-958d-ae63229aecd8` (LB-9)
> Modelo: Consigliere↔Líder↔Tara (skill `consigliere`)
> Líder: Daniel · Consigliere: Pavan
> Data: 2026-05-17 23:30 BRT

## O que Rica pediu (LB-9 textual)

1. **Remover** botão "+" no card + modal "novo subagente" + código em torno (sem praticidade).
2. **Substituir** por um dos caminhos (ou híbrido):
   - (A) LLM monta sua subsessão "na medida que acorda com o dev" — espontâneo.
   - (B) Painel na própria Task com escolha de skill + parceiro + sessão oficial (no card) vs background (com contexto da workspace, sem poluir card).
   - "Entre outras coisas boas UIUX na Criação da Task" — espaço pra inovar.
3. **Manter** contador de subagentes do card, **mas refletindo sessões reais** (hoje só funciona se ChatPanel/SSE aberto — caveat JP-11).

## Estado atual (recon Pavan)

Frontend (`apps/web/`):
- `components/agent-card.tsx:195-221` — Dialog + NewInstanceForm (botão "+")
- `components/agent-card.tsx:248-320` — form com SelectField (CLI/Modelo) + checkbox `is_subagent`
- `components/agent-card.tsx:157-166` — badge `subagent-badge` via `useSubagentActiveCount(slug)`
- `lib/subagent-activity-context.tsx:91-102` — hook alimentado por SSE (caveat JP-11)

Backend (`apps/api/`):
- `routers/agents.py:95-160` — POST `/api/agents/{slug}/instances` (cria, pula bootstrap se `is_subagent=true`)
- `routers/agents.py:420-530` — GET `/api/agents/{slug}/messages/stream` (SSE emite `subagent_status` events)
- `routers/agents.py:207-215` — GET `/api/agents/{slug}/skills` (lista estática `.claude/skills/`)
- `orchestrator/jsonl_watcher.py:286-335` — `subagent_active_snapshot`, `mark_stalled_subagents`
- `_subagent_state[parent_uuid]` — tracking ciclo de vida via `tool_use` → `tool_result`

## Pesquisa Pavan — patterns SOTA (UX inline spawn agent)

Subagent `general-purpose` consultou 13 ferramentas SOTA. Top 3 patterns recorrentes:

1. **Painel lateral persistente, modal só em ambiguidade.** Cursor "Agents Window", Devin "Command Center", Replit Board, Vercel v0 sidebar — todos têm surface dedicada sempre visível. Modal só em config destrutiva.
2. **Spawn inline por slash/quick-action, config implícita por contexto.** `/multitask` Cursor, `@mention agent` Linear, `Task` tool auto Claude Code. Usuário NÃO escolhe modelo/skill na hora — defaults vêm do contexto.
3. **Auto-spawn pelo próprio agente quando faz sentido.** Devin filhas autônomas, Replit divide task, Roo Orchestrator. Usuário NÃO decide — agente oferece/executa. "Agents tab" só aparece quando há filhas (Devin) pra não poluir.

Dissidência interessante: **Linear inverte a metáfora** — agente é "additional contributor" no issue do humano, não sessão separada. Útil pra handoff humano↔IA sem trocar UI.

## Proposta Daniel (LB-9 round 1)

### (1) Caminho — Híbrido B-base + A-gatilho

> B puro (painel na Task) dá controle determinístico ao Rica: sabe quem spawnou, qual skill, qual parceiro — crítico pra debug/repro. A puro (LLM espontâneo) é mágico mas opaco — Rica não saberia depois "por que essa sub-sessão existe". Híbrido: B é caminho oficial; A vira sugestão inline do LLM ("Posso spawnar Tara com skill codex pra esse refactor?") com [Sim] [Não] de 1 click.

### (2) Oficial vs background — diff técnica mínima

> Mesma infra (tmux pane + JSONL). Diferença só por flag `is_visible` (default `true`). Background = `is_visible=false` → UI esconde do contador/card mas backend trata igual. Lifecycle: background ganha TTL (auto-close em 10min ociosidade). NÃO worktree — overkill, só usar quando edit paralelo no mesmo arquivo (agent-view já cobre isso).

### (3) Como LLM acorda subsessão

> Tool MCP `spawn_subsession(skill?, partner?, prompt?, mode?)`. No chat, LLM solta OneLineChip de sugestão com [Sim] [Não]. Sim → executa tool, sub-sessão aparece no contador via SSE. NÃO slash (Rica disse que `/` já tá poluído).

### (4) Onde mora o painel

> Aba lateral nova "SUB" no modal do agente (já tem CHAT/PANE/INF/SKILLS/DOCS/TABELAS/HANDOFF — vira a 8ª). Card já apertado, painel precisa de 4-5 campos (skill, parceiro, modo, prompt opcional, TTL), dropdown sofre em mobile. Lista de sub-sessões ativas no topo + botão `[+ Nova]` que expande form colapsado. Replace direto do `+` do card.

### (5) Fix JP-11 (badge SSE-dependent)

> **JUNTO.** Sem o fix, redesign nasce com mesma dor: Rica abre painel, vê 0 sub-sessões porque SSE não conectou. Solução: endpoint `GET /api/agents/{slug}/subagents` retornando snapshot de `_subagent_state`; badge faz polling 5s + SSE como otimização. Polling é fallback, SSE é live.

### (6) Riscos / pontos cegos

- **Subagente zumbi:** Rica fecha modal, sub-sessão segue queimando tokens. `mark_stalled` agressivo + auto-kill em 10min idle.
- **Race no `.git/index`:** 2 sub-sessões editando = caos (já caímos nisso). Mitigação: detectar `is_subagent` + tem `Edit/Write` na prompt → forçar worktree.
- **Custo opaco:** sub-sessões consomem contexto e $$. UI precisa mostrar tokens estimados por sub-sessão no painel SUB.
- **Skill mismatch:** spawnar Tara com skill `voz` (que é do Daniel) → erro silencioso. Validar compat skill↔agente no submit.
- **Decisão pro Rica:** o que significa "trabalhar com X" — handoff de task? Compartilhar contexto? Apenas ouvir? Define semântica antes de cravar UI.

## Pontos de convergência (Pavan ↔ Daniel)

✅ Híbrido B-base + A-gatilho.
✅ Painel em aba dedicada (não modal, não dropdown).
✅ JP-11 fix entra junto (não backlog).
✅ Distinção visível/background = flag, não infra duplicada.

## Pontos abertos pra round 2

1. **Cravar UX de "spawn inline" do LLM:** OneLineChip [Sim]/[Não] vs sugestão na aba SUB?
2. **Semântica "trabalhar com X"** (decisão Rica): handoff puro? Compartilhar contexto? Só ouvir?
3. **Tara entra Context7** sobre stack técnica: `cmdk` lib + shadcn `CommandDialog`, polling+SSE pattern, MCP tool spec do `spawn_subsession`.
4. **Refletir Linear "agent como additional contributor" no issue** — pode simplificar UI (agente vira owner-2 da task, não "subsessão"). Vale debater.
5. **Aba SUB vira 8ª tab — ou compactar com algum existente?** (ex: HANDOFF + SUB fundidas).

## Próximos passos

1. Aguardar Daniel finalizar checkpoint atual e ficar livre.
2. Compor round 2 com pesquisa Pavan + perguntas finas + escalações pro Rica.
3. Tara entra pra Context7 técnico (passo 6 do playbook, antes de codar).
