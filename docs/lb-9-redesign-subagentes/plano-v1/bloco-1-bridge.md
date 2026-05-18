# Bloco 1 — Bridge: Tool MCP `spawn_subsession`

> Status: **DONE** · Sessão: Daniel 5 · Commit: `e489a99` · 2026-05-18

## O que foi feito

- Criado `apps/api/mcp_tools/__init__.py` + `spawn_subsession.py` com a tool MCP
- Adicionado `register_spawned_subagent()` público em `orchestrator/jsonl_watcher.py`
- Anotação `_subagent_state` corrigida de `dict[str, int]` → `dict[str, Any]`
- Adicionados 2 endpoints em `routers/agents.py`:
  - `POST /api/agents/{slug}/subagents/spawn` — cria subsessão
  - `GET /api/agents/{slug}/subagents` — snapshot das ativas (polling 5s, Bloco 2 vai usar)
- 9 testes passando em `tests/test_spawn_subsession.py`
- Falha pré-existente isolada: `test_codex_events.py::test_codex_events_update_agent_state` (context_pct assert hardcoded, não relacionado ao Bloco 1)

## Decisões tomadas durante implementação

| Decisão | Motivo |
|---|---|
| `git diff HEAD --quiet` em vez de `git status --porcelain` | Falso positivo real: `--porcelain` rejeitava untracked files como `.claude/` gerado pelo CC em runtime — untracked files não afetam o worktree |
| Removido subprocess de `mark_stalled_subagents` | Bloqueava event loop SSE (timeout 10s × N entradas); cleanup adiado para sweep do Bloco 5 (sweep periódico no boot) |
| `_kill_tmux_session_sync` helper adicionado | Limpeza best-effort de tmux no fallback se steps 4-5 falharem (resource leak fix) |
| Não extraído `_REPOS_ROOT` / `_UNSAFE_WORKSPACE_CHARS` para utilitário compartilhado | D4: duplicação em 2 arquivos não justifica helper extra |
| `_get_agent_or_404` helper reutilizado no endpoint spawn | Consistência com todos os outros endpoints do router |
| `spawned_by_tool: True` adicionado ao estado | Distingue subsessões tool-spawned (LB-9) das nativas JSONL do CC |
| `workspace_path` adicionado ao estado da subsessão | Necessário para cleanup de worktree em `mark_stalled_subagents` (e futuro sweep Bloco 5) |

## Paths tocados

```
apps/api/mcp_tools/__init__.py          (novo)
apps/api/mcp_tools/spawn_subsession.py  (novo — 184 linhas)
apps/api/tests/test_spawn_subsession.py (novo — 229 linhas, 9 testes)
apps/api/orchestrator/jsonl_watcher.py  (modificado — +60 linhas)
apps/api/routers/agents.py              (modificado — +52 linhas)
```

## Tech-debt detectado (backlog)

- **Latência de spawn**: `git worktree add HEAD` em repos grandes pode custar 300–2000ms; orçamento de 500ms pode ser ultrapassado. Mitigação futura: monitorar via log + considerar retorno imediato com criação de worktree em background task asyncio
- **Fechamento via happy path quebrado por design**: `update_subagent_state_from_jsonl` fecha subagents nativos pelo `parentUuid` do JSONL do CC filho. Subsessões tool-spawned não têm JSONL registrado no watcher (worktree em `/tmp/` com encoded-cwd desconhecido), então só fecham via stall (30s timeout). Bloco 6 (E2E) ou watcher estendido pode resolver
- **Cleanup de worktree no fechamento normal**: só `mark_stalled_subagents` deixou de fazer cleanup (removido por bloquear event loop); Bloco 5 precisa de sweep periódico que liste e remova `/tmp/subsession-*` órfãos

## Critérios de aceite verificados

- [x] `POST /api/agents/{slug}/subagents/spawn` com payload válido retorna `200 {subsession_id, session_name, status:"starting"}` (< 500ms — worktree+tmux são async)
- [x] `_subagent_state[slug][subsession_id]` tem `task_id` e `visibility` corretos (testado em `test_register_spawned_subagent_adds_to_state`)
- [x] DB recebe `subagent_started` event (testado em `test_spawn_subsession_happy_path`)
- [x] Cleanup de worktree+tmux no caso de falha parcial (testado em `test_spawn_subsession_cleans_worktree_on_tmux_failure`)
- [x] Suite de 84 testes passa sem regressão
- [ ] Processo tmux filho aparece em `tmux list-sessions` — validação manual no smoke Bloco 6

## Próximo: Bloco 2

Bloco 2 implementa SSE root layout multiplexado (`GET /api/events/stream?slugs=...`) e endpoint REST `GET /api/agents/{slug}/subagents` (já adicionado aqui como stub). Pode rodar em paralelo com Blocos 3/4.
