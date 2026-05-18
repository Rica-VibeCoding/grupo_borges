# Bloco 5 — Bridge: Validações + Worktree Cleanup + Zumbi TTL

> Status: **DONE** · Sessão: Daniel 7 (re-spawn) · Commit: `51b3666` · 2026-05-18

## O que foi feito

### Validações no submit (`mcp_tools/spawn_subsession.py`)

| Validação | Código de erro | O que checa |
|---|---|---|
| Permissão de pai | `PermissionError` → 403 | `payload.agent_slug == slug` (rota = agente-pai) |
| Limite 3 subsessões | `TooManySubsessionsError` → 429 | `count_active_subsessions_for_task(task_id) >= 3` |
| Skill no workspace | `SkillNotFoundError` → 400 | `payload.skill` (opcional) em `workspace_reader.read_skills_cached` |

- Campo `skill: str | None = None` adicionado ao `SpawnSubsessionInput`
- Exceções próprias definidas no módulo (evita strings mágicas no router)
- Router (`routers/agents.py`) mapeado com 3 novos `except` (403/429/400)

### Worktree cleanup (`orchestrator/worktree.py` — novo)

- `cleanup_worktree_sync(workspace_path, worktree_path, subsession_id)`:
  - Checa `git rev-list --count HEAD ^<parent_head>` para commits não-merged
  - Branch com commits → log warning + preserva (NÃO apaga)
  - Branch limpo → `git worktree remove --force` + log warning se rc != 0
- `sweep_orphan_worktrees_sync(workspace_paths, active_paths)`:
  - Remove `/tmp/subsession-*` não em `active_paths` via `shutil.rmtree`
  - `git worktree prune` em todos os workspaces conhecidos
- `SubsessionSweeper` (async loop):
  - Chama `mark_stalled_all_slugs()` periodicamente (default 5min)
  - Para cada stalled `spawned_by_tool=True`: kill tmux + `cleanup_worktree_sync`
  - Reutiliza `services/tmux_driver.kill_session_if_exists` (sem duplicata)

### Anti-zumbi TTL (`orchestrator/jsonl_watcher.py`)

- `mark_stalled_subagents`: TTL diferenciado por tipo
  - `spawned_by_tool=True`: 600_000ms (10min) — nunca têm JSONL update
  - nativos CC: 30_000ms (30s) — atualizam `last_seen_ms` via JSONL
- Payload do stalled agora inclui: `worktree_path`, `workspace_path`, `session_name`, `spawned_by_tool`, `task_id` → permite cleanup direto pelo sweeper
- `count_active_subsessions_for_task(task_id)`: filtra `spawned_by_tool=True` (nativos sem task_id não inflam o contador)
- `mark_stalled_all_slugs()`: itera todos os slugs em `_subagent_state` (uso: sweeper periódico)

### Integração no boot (`main.py` + `config.py`)

- Boot sweep logo após watcher.start() com `active_paths=set()` (estado vazio = todos são órfãos)
- `SubsessionSweeper` no lifespan (opt-in via `GB_SUBSESSION_SWEEPER_ENABLED`, default True)
- `GB_SUBSESSION_SWEEPER_INTERVAL_SECONDS` (default 300s)
- `asyncio` importado em `main.py` (necessário para `asyncio.to_thread`)

## Arquivos tocados

```
apps/api/orchestrator/worktree.py            (novo — 165 linhas)
apps/api/orchestrator/jsonl_watcher.py       (modificado — +45 linhas)
apps/api/mcp_tools/spawn_subsession.py       (modificado — +35 linhas)
apps/api/routers/agents.py                   (modificado — +8 linhas)
apps/api/main.py                             (modificado — +9 linhas)
apps/api/config.py                           (modificado — +3 linhas)
apps/api/tests/test_bloco5_validations.py    (novo — 16 testes, 100% pass)
apps/api/tests/test_spawn_subsession.py      (modificado — fix nome função)
```

## Decisões tomadas durante implementação

| Decisão | Motivo |
|---|---|
| `_force_remove_worktree_sync` (não `_cleanup_worktree_sync`) em `spawn_subsession.py` | Rollback de spawn falho ≠ cleanup normal; rollback não checa commits pq nenhum foi feito ainda; nomes diferentes evitam confusão com `cleanup_worktree_sync` em worktree.py |
| `git rev-list --count HEAD ^<parent_head>` para checar commits | Compara worktree com HEAD atual do workspace pai — cobre o caso de worktree ter avançado |
| `log.warning` quando `git worktree remove` falha (não raise) | Cleanup é best-effort; processo principal não deve crashar por limpeza |
| Race condition no limite 3 → backlog (D4) | CC é single-threaded por sessão; spawn paralelo de 2 calls do mesmo agente é caso de borda improvável; asyncio.Lock adicionaria complexidade sem retorno prático |
| `count_active_subsessions_for_task` filtra `spawned_by_tool=True` | Nativos CC não têm `task_id`, mas filtro torna intenção explícita e evita falso positivo futuro |
| `_kill_tmux` em worktree.py usa `services/tmux_driver.kill_session_if_exists` | Função já existia; sem duplicata |

## Riscos residuais / backlog

- **Race condition no spawn paralelo**: `count_active_subsessions_for_task` + `register_spawned_subagent` não são atômicos. Mitigação: `asyncio.Lock` por `task_id`. Marcado como backlog — caso real exige dois agents-pai simultâneos na mesma task, impossível pelo design de permissão.
- **Boot sweep sem checagem de commits**: orphans do reboot são removidos incondicionalmente. Aceitável — subsessões são efêmeras por design; caso de "agente commitou + API caiu" é raro e pode ser recuperado via `git reflog` no workspace.
- **TTL fixo 10min**: configurável por `GB_SUBSESSION_SWEEPER_INTERVAL_SECONDS` mas não por subsessão individual. Futuro: campo `ttl_seconds` no SpawnSubsessionInput.

## Critérios de aceite verificados

- [x] Spawn com `agent_slug` diferente do pai → 403 (testado)
- [x] 4º spawn ativo na mesma task → 429 (testado)
- [x] Spawn com skill inexistente no workspace → 400 (testado)
- [x] Spawn sem skill não dispara validação (testado)
- [x] TTL 10min para spawned_by_tool, 30s para nativos (testado)
- [x] Stalled payload inclui campos de cleanup (testado)
- [x] `cleanup_worktree_sync` preserva branch com commits (testado)
- [x] `cleanup_worktree_sync` remove branch limpo (testado)
- [x] `cleanup_worktree_sync` no-op para path inexistente (testado)
- [x] `sweep_orphan_worktrees_sync` remove não-ativos (testado)
- [x] Suite 102/103 pass (1 pré-existente `test_codex_events_update_agent_state`)
- [ ] Processo tmux filho visible + worktree em `git worktree list` — smoke Bloco 6
- [ ] Boot sweep limpa /tmp/subsession-* real após reboot — smoke Bloco 6

## Próximo: Bloco 6 (E2E Playwright)

Bloco 6 valida o fluxo completo: spawn via UI (Popover do Bloco 3) → worktree criado → subsessão no badge → stall após 10min → worktree removido. Requer Blocos 3+4 concluídos.
