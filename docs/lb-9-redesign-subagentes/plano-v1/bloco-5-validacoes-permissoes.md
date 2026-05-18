# Bloco 5 — Validações, permissões, worktree e zumbi TTL

## Escopo

Adicionar validações ao submit do `spawn_subsession` (permissão de pai, limite de 3, skill no workspace, `--cwd` correto) e implementar o ciclo de worktree (criar no spawn, cleanup no done/stalled) + mecanismo anti-zumbi (TTL 10min + `mark_stalled` agressivo + sweep periódico).

## Decisão estrutural (v2 — Pavan)

**Worktree SEMPRE.** Não tem regex pra detectar Edit/Write — toda subsessão nasce em `/tmp/subsession-<id>/` via `git worktree add HEAD`. Custo: ~1s no spawn. Benefício: extingue race `.git/index` por construção, zero `if`s, zero falso negativo. Cleanup centralizado no helper `cleanup_worktree(subsession_id)` chamado em `mark_stalled` e em status `done`.

## Arquivos tocados

- `/home/clawd/repos/grupo_borges/apps/api/mcp_tools/spawn_subsession.py` ← adicionar validações no início da função
- `/home/clawd/repos/grupo_borges/apps/api/orchestrator/jsonl_watcher.py` ← `mark_stalled_subagents` + TTL sweep
- `/home/clawd/repos/grupo_borges/apps/api/routers/agents.py:207-215` ← `GET /api/agents/{slug}/skills` (usar pra validar skill no workspace)
- `/home/clawd/repos/grupo_borges/apps/api/orchestrator/background_tasks.py` (verificar nome; pode ser `scheduler.py` ou APScheduler) ← cron de sweep de zumbis a cada 5min

> Verificar: como o projeto roda tarefas background periódicas (APScheduler, FastAPI lifespan, cron VPS). Ler `apps/api/` antes de decidir onde colocar o sweep.

## Pré-condições

- Bloco 1 concluído: `spawn_subsession.py` existe com lógica de spawn mas sem validações

## Context7 — queries Tara consulta ANTES de codar

```
resolve_library_id("fastapi")
get_library_docs(<id>, topic="HTTPException validation 422 error response")
get_library_docs(<id>, topic="lifespan background tasks periodic")
```

Relatório salvo em `/tmp/tara-bloco-5-context7.md`.

## Passos

### Validações no submit (ordem de execução)

1. **Ler** `spawn_subsession.py` (Bloco 1) e `_subagent_state` pra entender estrutura atual.
2. Validação **permissão de pai**: `agent_slug` no payload deve corresponder ao agente-pai da `task_id`. Buscar `task_id` → `agent_slug` do pai em `_subagent_state` ou em banco. Rejeitar `403` se divergir.
3. Validação **limite de 3**: contar subsessões ativas (`status not in ("done","error","stalled")`) para o `task_id`. Se `>= 3`, retornar `429 { detail: "Limite de 3 subsessões ativas por task atingido" }`.
4. Validação **skill no workspace**: chamar função interna que lê `workspace_path/.claude/skills/`. Retornar `400` se skill não estiver lá.
5. Validação **`--cwd` correto**: o spawn (Bloco 1) já usa `cd <worktree_path> && claude --bg ...`. Aqui só validar que `worktree_path` foi gerado corretamente antes do exec.

### Worktree (criar e limpar)

6. **Criar worktree (Bloco 1 chama):** `git worktree add /tmp/subsession-<subsession_id> HEAD` no workspace do pai. Registrar `worktree_path` em `_subagent_state[parent_uuid]`.
7. **Helper `cleanup_worktree(subsession_id)`** (novo módulo `apps/api/orchestrator/worktree.py`):
   - Lê `worktree_path` de `_subagent_state`
   - Se branch tem commits ainda não merged → log warning, NÃO deleta (preserva trabalho do agente-filho)
   - Se branch limpo → `git worktree remove <path>` + `git branch -D <branch>` se houver
8. **Chamar `cleanup_worktree`** em: (a) `mark_stalled_subagents`, (b) handler de `status:"done"`, (c) sweep periódico que detecta órfãos.

### Anti-zumbi TTL

9. **Ler** `jsonl_watcher.py:286-335` pra entender `mark_stalled_subagents` atual.
10. **Adicionar campo** `last_seen_at` em cada entrada de `_subagent_state`, atualizado a cada evento JSONL do processo filho.
11. **Sweep periódico (5min):** iterar `_subagent_state`, identificar entradas com `last_seen_at > 10min` e `status == "running"` → marcar `stalled` → `tmux kill-session -t <session_name>` → `cleanup_worktree(subsession_id)`.
12. **Sweep de boot:** ao iniciar API, varrer `/tmp/subsession-*` órfãos (sem entrada em `_subagent_state`) e remover.
13. **Integrar** sweeps no mecanismo de tarefas periódicas do projeto (APScheduler ou FastAPI lifespan).

## Critério de aceite

- Spawn com `agent_slug` diferente do pai retorna `403`
- 4º spawn ativo na mesma task retorna `429`
- Spawn com skill inexistente no workspace retorna `400`
- **Toda subsessão (sem exceção)** cria worktree (verificar com `git worktree list`)
- Worktree é removido quando subsessão muda pra `done` ou `stalled` (branch limpo) ou logado como pendente (branch com commits)
- Subsessão ociosa por 10min → tmux killed + `stalled` + worktree handling
- Reboot da API limpa worktrees `/tmp/subsession-*` órfãos
- Typecheck + pytest unitário no módulo de validações + worktree helper

## Riscos específicos

- **Fonte da `task_id → agent_slug` do pai:** depende de como a task foi criada. Verificar schema da task em banco ou em `_subagent_state` antes de implementar. Se não tiver, adicionar campo `owner_agent_slug` no momento de criação da task.
- **Worktree com commits não-merged:** cleanup preserva worktree (não deleta). Logar warning + emitir evento SSE pra dev ver no cockpit que tem worktree pendente de merge.
- **`/tmp` em VPS pode estar em tmpfs:** worktrees somem em reboot. Aceitável — subsessões são efêmeras por design.
- **`_subagent_state` in-memory:** sweep periódico só funciona enquanto API está de pé. Sweep de boot (passo 12) cobre o caso de reboot. Backlog: persistir estado em banco.
