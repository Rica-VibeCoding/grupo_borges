# LB-9 — Decisões cravadas + diretivas operacionais

> **Status:** consenso fechado pelo Rica em 2026-05-18 00:30 BRT após 2 rounds de debate (Daniel 1+2+3 + Tara 2 Context7).
> **Fonte canônica.** Qualquer sessão que dê /clear lê este arquivo + `round-1-debate.md` + `round-2-triangulacao.md` pra reconstruir contexto.
> **Próximo passo:** Daniel 1 escreve plano v1 multi-arquivos com base aqui.

## 7 decisões finais

| # | Tópico | Decisão | Fundamentação |
|---|---|---|---|
| 1 | Semântica "trabalhar com X" | **Handoff puro** | Default mata 80% dos casos, custo de contexto zero. Compartilhar contexto/só-ouvir = backlog se faltar na prática. |
| 2 | Limite simultâneas | **Max 3 por task** | Rica cravou. |
| 3 | Background tem log visível? | **Silencioso** (JSONL no arquivo) | Aba colapsada com log = overengineering (1-2 dias dev, retorno marginal). |
| 4 | Skill selector | **Só skills do workspace do pai** | Rica cravou. Pool global cross-workspace = futuro se necessário. |
| 5 | Permissão de spawn | **Só o agente-pai da task** | Rica cravou. |
| 6 | Painel mora onde | **Card da TASK** (Popover no rodapé) | Daniel 2+3 + Context7 (`Popover` + `Combobox` shadcn v3.5.0). |
| 7 | `visibility` tipo | **Boolean** (`is_visible` ou `visibility:"card"\|"background"`) | Ternária = overengineering pro escopo cravado (max 3, só pai, painel na task). |
| ➕ | Caminho geral | **Híbrido B-base + A-automático** via tool MCP | Unânime nos 3 Daniels. |
| ➕ | Como LLM acorda | **Tool MCP `spawn_subsession`**, NÃO slash | Unânime. |
| ➕ | JP-11 fix | **JUNTO** — SSE no root layout + polling REST 5s reconcile | Context7 oficial (FastAPI 0.128.0). |

## Especificação técnica consolidada

### Backend

**Tool MCP `spawn_subsession`** (MCP spec 2025-11-25):
- Input: `{ task_id, agent_slug, prompt, visibility:bool, metadata? }`
  - `task_id` — RESOLVE correlação subsessão↔task (risco apontado por Daniel 2)
  - `agent_slug` — sempre o próprio agente-pai (validar no submit)
  - `visibility:bool` — `true` = aparece no card; `false` = background silencioso
- Retorno **imediato** (handle, não síncrono longo): `{ subsession_id, session_name, status:"starting", stream_url? }`
- Side effect: cria processo filho tmux + registra estado em `_subagent_state` + grava JSONL
- Limitação cardinal: tool NÃO espera conclusão — emite progresso via stream/recurso/evento

**Endpoint REST novo** (fix JP-11):
- `GET /api/agents/{slug}/subagents` — snapshot de `_subagent_state` (independente de SSE aberto)
- Frontend faz polling 5s via TanStack Query como reconcile

**SSE no root layout** (fix JP-11):
- Mover EventSource de `chat-panel.tsx` pra root layout
- 1 conexão por cliente, latência subsegundo, badge funciona com modal fechado

**Validações no submit do spawn:**
- `agent_slug` == pai (permissão)
- Contar subsessões ativas pra `task_id` < 3 (limite)
- Skill solicitada existe no workspace do pai (compat)
- Detectar `Edit/Write` no prompt → forçar worktree (race `.git/index`)
- `--cwd` correto (memória `claude_bg_sem_flag_cwd`)

### Frontend

**Card do agente** (`agent-card.tsx`):
- REMOVE botão "+" + `NewInstanceForm` (linhas 195-221, 248-320)
- MANTÉM badge `subagent-badge` mas alimentado pelo novo endpoint REST + SSE root

**Card da Task** (novo Popover):
- Botão `[+ Subsessão]` no rodapé do card task
- Abre `Popover` com `Combobox` (shadcn v3.5.0):
  - Campo skill: `Combobox` listando skills do workspace do pai
  - Toggle: oficial (visible) vs background (silent)
  - Textarea prompt (opcional)
- Submit chama tool MCP `spawn_subsession` via endpoint interno
- Lista de subsessões ativas da task acima do botão (com handle pra inspecionar)

**Tool MCP A-automático**:
- Quando agente-pai emite `spawn_subsession` espontaneamente, ChatPanel mostra **OneLineChip de confirmação** `[Sim] [Não]`
- Sim → executa tool → subsessão aparece no contador via SSE
- Não → tool retorna `{status:"declined"}`

## Diretivas operacionais (Rica — 2026-05-18)

**D1 — Orquestração de contexto pra sobreviver a /clear**
- Toda sessão (Pavan, Daniel, Tara) lê este `decisoes-cravadas.md` + `round-*.md` no boot
- Bridge documental forte por fase (cada bloco do plano tem `bloco-N-bridge.md` atualizado ANTES de fechar a fase)
- Memória project no Pavan/Daniel pra retomada cega

**D2 — Todas as fases têm ritual fim-de-fase**
Por fase (ritual completo do playbook):
1. **Context7 via Tara** sobre as stacks da fase (relatório `/tmp/tara-<bloco>-context7.md`)
2. **Implementação** (Daniel delegando o máximo pra Tara)
3. **Relatório paralelo de 2 subagents CC:**
   - `code-reviewer` (subagent CC)
   - `code-simplifier` / `simplify` (skill CC)
4. **Check veracidade dos relatórios direto no código** (não aplicar cego)
5. **Aplicar o que faz sentido** (triagem honesta — rejeitar com motivo)
6. **Testes:** typecheck, build, lint, pytest, Playwright (via Daniel — sandbox Tara bloqueia network)
7. **Commit + push** (paths explícitos, conventional commit, `pull --rebase` antes)
8. **Bridge atualizado** com seção da fase ANTES de fechar (lição da S2 cockpit)

**D3 — Context7 antes de escrever cada fase**
- ANTES de qualquer codar/planejar, Tara consulta Context7 das libs envolvidas
- Salva relatório em `/tmp/tara-<bloco>-context7.md` e mata premissas falsas

**D4 — Cortar overengineering**
- Princípio cardinal: custo alto + retorno baixo = NÃO
- Quando em dúvida entre 2 caminhos, escolher o mais simples e marcar o outro como backlog
- Daniel/Tara/Pavan podem propor "vou simplificar X" sem perguntar — Rica confia na triagem

## Próximos passos

1. **Pavan** salva memória project `project_lb9_decisoes_cravadas.md` pra sobreviver a /clear
2. **Pavan** dispara Daniel 1 (sessão oficial, já fechou checkpoint) com brief pra escrever plano v1 multi-arquivos em `plano-v1/`:
   - `master.md` — índice + decisões cardinais + ordem dos blocos
   - `bloco-1-backend-tool-mcp.md`
   - `bloco-2-backend-sse-polling.md`
   - `bloco-3-frontend-task-popover.md`
   - `bloco-4-frontend-badge-onelinechip.md`
   - `bloco-5-migrations-validacoes.md`
   - `bloco-6-e2e-playwright.md`
3. **Pavan** revisa v1 → ajustes → v2 (two-eyes principle)
4. **Rica** autoriza v_final
5. **Execução multi-sessão** com ritual D2 por bloco
