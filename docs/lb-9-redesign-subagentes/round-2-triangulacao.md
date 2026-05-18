# LB-9 — Triangulação Daniel 1+2+3 + Context7 Tara 2

> Round 2 do debate, modelo Consigliere↔Líder↔Tara
> Data: 2026-05-18 00:08 BRT
> Sessões efêmeras: Daniel 2 (19101a79), Daniel 3 (1bbfa2eb), Tara 2 — todas fechadas após entrega

## Matriz de convergência

| Tópico | Daniel 1 | Daniel 2 | Daniel 3 | Consenso |
|---|---|---|---|---|
| **Caminho** | Híbrido B+A-gatilho | Híbrido B+A-extensão | Híbrido B+A-tool_use | ✅ **UNÂNIME: B-base + A automático via tool MCP** |
| **Visibilidade** | flag `is_visible` | coluna `visible: bool` | campo `visibility:"card"\|"background"` | ✅ **UNÂNIME: 1 flag/campo, mesma infra tmux+JSONL** |
| **Como LLM acorda** | Tool MCP + OneLineChip | Tool MCP `create_subsession` | Tool MCP `spawn_subagent` | ✅ **UNÂNIME: tool MCP, NÃO slash** |
| **Onde mora painel** | Aba SUB no card do AGENTE | Card da TASK | Card da TASK | ⚠️ **2x1 pra TASK** |
| **JP-11 (badge)** | JUNTO | JUNTO | Backlog mas alta prio | ✅ **2x1 pra JUNTO** |

## Validações + refinamentos da Tara 2 (Context7 oficial)

### Picker UI inline (`shadcn/ui v3.5.0`)
- **Padrão cravado:** `Popover` + `Command`/cmdk + `Button` trigger
- **NÃO usar `Dialog`** pro picker — `Popover` ancora no rodapé do card, preserva contexto, não captura fluxo global
- `Combobox` (busca + grupos + status) > `Select` (lista fechada simples) — adotar Combobox
- Next 16 App Router: picker é Client Component isolado, resto pode seguir Server Component
- Resolve a divergência **"onde mora o painel"**: Popover no rodapé do card task ✅ se alinha com Daniel 2+3

### Real-time count (FastAPI 0.128.0)
- Backend `StreamingResponse` SSE via Starlette
- ⚠️ **Alerta oficial:** WebSocket em memória só escala 1 processo (em multiworker exige `encode/broadcaster` + Redis/PG)
- **Padrão recomendado pelo Context7:**
  - **SSE no root layout** (1 conexão por cliente, latência subsegundo, badge independente do modal)
  - **Polling REST 5s como fallback/reconcile** (TanStack Query)
- Cravado: SSE root + polling reconcile. Mata o JP-11 de vez.

### MCP tool spec `spawn_subsession` (MCP spec 2025-11-25)
- Tools PODEM ter side effect (criar processo, gravar estado) — confirmado, não é abuso
- **Input refinado pelo Context7:**
  ```json
  { "task_id", "agent_slug", "parent_session_id",
    "visibility": "public"|"private"|"internal",
    "prompt", "metadata" }
  ```
- **Retorno imediato (handle, NÃO síncrono longo):**
  ```json
  { "subsession_id", "pid/session_name",
    "status": "starting", "stream_url"? }
  ```
- ⚠️ **Limitação cardinal:** não esperar conclusão na chamada. Retorna handle + emite progresso por recurso/stream/evento.
- **Refinamento sobre Daniel 2+3:** `visibility` ternária (`public`/`private`/`internal`) em vez de boolean — mais expressiva. Vale debater se cabe ou é overkill.
- `task_id` no payload **resolve o risco do Daniel 2** (correlação subsessão↔task).
- `stream_url` no retorno é ouro pra UX — endpoint dedicado pra acompanhar progresso.

## Riscos consolidados (engineering, não precisa do Rica)

1. **Zumbi/órfão:** background sem card precisa kill switch automático. `mark_stalled` + auto-close 10min idle.
2. **Race `.git/index`:** 2 subsessões editando = caos. Mitigação: detectar `is_subagent` + `Edit/Write` na prompt → forçar worktree.
3. **`--cwd` errado quebra silenciosamente** (memória `claude_bg_sem_flag_cwd`). Validar no spawn.
4. **CPU VPS:** múltiplas subsessões paralelas saturam. Definir limite por task.
5. **Skill mismatch:** validar compat skill↔agente no submit.
6. **Custo opaco:** UI mostra tokens estimados por subsessão.

## Decisões pendentes pra ti, Rica

1. **Semântica "trabalhar com X"** (do round 1 — ainda aberta) — handoff puro? Compartilhar contexto? Só ouvir?
2. **Limite de subsessões simultâneas** — por task? Por agente-pai? Número fixo?
3. **Background é silencioso ou tem log stream visível** (ex: aba "logs background" colapsada)?
4. **Skill selector** — só skills do workspace do pai ou pool global cross-workspace?
5. **Permissão de spawn** — qualquer agente, ou só o pai da task?
6. **Painel mora no card da TASK ou do AGENTE** — Context7 + 2/3 Daniels apontam TASK + Popover no rodapé. Confirma?
7. **`visibility`: ternária (public/private/internal) ou boolean simples (oficial/background)?** Tara propôs ternária; Daniels propuseram boolean.

## Próximo passo (após decisões)

1. Daniel (1, sessão oficial) escreve **plano vN** em Markdown, multi-arquivos (são ~5-6 blocos: backend tool MCP, backend SSE+polling, frontend Popover na task, frontend badge fix, migrations, testes E2E).
2. Pavan revisa (two-eyes principle).
3. Rica autoriza v_final.
4. Execução multi-sessão (Daniel + Tara abundante).
