# Bloco 1 — Backend: Tool MCP `spawn_subsession`

## Escopo

Implementar a tool MCP `spawn_subsession` que cria uma subsessão filho (processo tmux) para um agente-pai, registra em `_subagent_state`, grava JSONL e retorna handle imediato. Não inclui validações de limite/permissão (Bloco 5) nem SSE (Bloco 2).

## Arquivos tocados

- `/home/clawd/repos/grupo_borges/apps/api/mcp_tools/spawn_subsession.py` ← novo
- `/home/clawd/repos/grupo_borges/apps/api/mcp_tools/__init__.py` ← registrar tool
- `/home/clawd/repos/grupo_borges/apps/api/orchestrator/jsonl_watcher.py` ← integrar `_subagent_state` write
- `/home/clawd/repos/grupo_borges/apps/api/routers/agents.py` ← endpoint `POST /api/agents/{slug}/subagents/spawn` que expõe a tool ao frontend (se MCP não for chamável diretamente pelo client web)

> Verificar: se o MCP server já tem mecanismo de registro automático de tools via diretório, usar esse padrão. Ler `apps/api/mcp_tools/` ou equivalente antes de criar arquivo novo.

## Pré-condições

- Nenhuma (é a fundação). Bloco 5 virá adicionar validações ao submit.
- Ambiente de dev rodando em `:3007` (Tailscale Serve).

## Context7 — queries Tara consulta ANTES de codar

```
resolve_library_id("mcp") → buscar "MCP spec 2025-11-25" ou "Model Context Protocol"
get_library_docs(<id>, topic="tool side effects return handle") → padrão de retorno imediato (NÃO síncrono)
get_library_docs(<id>, topic="tool input schema definition")
```

Relatório salvo em `/tmp/tara-bloco-1-context7.md`. Matar premissas sobre como registrar tool e formato exato do schema antes de escrever uma linha.

## Passos

1. **Ler** `apps/api/orchestrator/jsonl_watcher.py:286-335` e `apps/api/routers/agents.py:95-160` pra entender estrutura atual de `_subagent_state` e como instâncias são criadas hoje.
2. **Ler** diretório `apps/api/mcp_tools/` (ou onde o servidor MCP registra tools) pra entender padrão do projeto.
3. **Criar** `spawn_subsession.py`:
   - Schema de input: `{ task_id: str, agent_slug: str, prompt: str, visibility: bool, metadata?: dict }`
   - **Worktree sempre** (regra cardinal v2): `git worktree add /tmp/subsession-<subsession_id> HEAD` antes do spawn. Spawn usa esse worktree como cwd.
   - Lógica: `cd /tmp/subsession-<subsession_id> && claude --bg ...` (NUNCA flag `--cwd` — ver memória `claude_bg_sem_flag_cwd`).
   - **Chave de `_subagent_state` continua `parent_uuid`** (não migrar pra `task_id` — quebraria SSE atual e `_subagent_status_events`). Adicionar **campo** `task_id` na entrada: `{ subsession_id, parent_uuid, task_id, pid, session_name, worktree_path, status:"starting", visibility, agent_slug, started_at }`.
   - Gravar entrada JSONL em log do agente-pai.
   - Retornar **imediatamente**: `{ subsession_id: str, session_name: str, status: "starting" }`. Sem `stream_url` (v2 simplificou).
4. **Registrar** a tool no `__init__.py` ou mecanismo de registro do projeto.
5. **Expor** `POST /api/agents/{slug}/subagents/spawn` no router se necessário pra o client web chamar.

## Critério de aceite

- `POST /api/agents/{slug}/subagents/spawn` com payload válido retorna `200 { subsession_id, session_name, status:"starting" }` em < 500ms (não bloqueia)
- Processo tmux filho aparece em `tmux list-sessions` após o spawn
- `_subagent_state` tem a entrada com `task_id` e `visibility` corretos
- Arquivo JSONL do agente-pai tem linha de evento `subagent_started`
- `mypy`/typecheck passa no módulo novo

## Riscos específicos

- **`--cwd` silencioso:** `claude --bg --cwd /x` crasha sem sinalizar (validado). Mitigação: sempre `cd <cwd> && claude --bg ...`.
- **`_subagent_state` é in-memory:** se API reiniciar, estado some + worktrees viram órfãos. Aceitável v2 — Bloco 5 tem sweep periódico que limpa worktrees órfãos no boot.
- **Colisão de IDs:** `subsession_id` é UUIDv4 gerado no servidor.
- **Worktree falha se há mudanças não-commitadas no path?** `git worktree add` aceita HEAD limpo ou commit. Se houver dirty index, falhar com `409 { detail: "Workspace pai tem mudanças não-commitadas — commita antes de spawnar" }`.
