# Contrato tecnico — Cockpit Fase 4: card do agente vivo

Data: 2026-05-11

Objetivo simples: fazer o card do agente mostrar trabalho real, nao campo decorativo.

O card ja existe. O Kanban ja existe. O buraco atual e a ligacao entre:

agente -> instancia/sessao -> tarefa atual -> saida curta do terminal

Nao criar um novo Kanban agora. Primeiro abastecer os campos que ja existem.

## Status de execucao — 2026-05-11

- [x] Issue 1 — card do agente mostra tarefa atual derivada de tasks ativas.
- [x] Issue 2 — stdout curto real da sessao no card/modal.
- [ ] Issue 3 — consolidar CLI/modelo/status efetivo pela instancia ativa.
- [x] Issue 4 — UI minima para criar nova tarefa no Kanban.
- [x] Issue 5 — detalhe real de tarefa no Kanban.
- [x] Issue 6 — evolucao manual de status no detalhe.
- [ ] Issue 7 — dispatcher automatico estilo Hermes.

Complementos Hermes-like aplicados neste ciclo:

- [x] Dispatch manual envia mensagem para tmux, muda task para `running`, cria `task_run` e `task_event`.
- [x] Ao mudar para `done`, `blocked` ou `review`, fecha `task_runs` abertos com `ended_at` e `outcome`.
- [x] Re-dispatch simples de task `running` bloqueado na API e no botao do modal.
- [x] Timeline basica no detalhe da task usando `task_events` do buffer SSE/poll.
- [x] Claim/lock atomico de dispatch concorrente.
- [x] Heartbeat do run.
- [x] Crash/stale detection.

## Fases de evolucao a partir daqui

### Fase 4.1 — Consolidar dispatch manual auditavel

Objetivo: transformar o Kanban manual em fluxo real minimo, sem automatizar ainda.

Status: **entregue e validado em 2026-05-11**.

- [x] Criar task pela UI.
- [x] Abrir detalhe real da task.
- [x] Enviar task para sessao tmux do agente.
- [x] Mudar task para `running` no dispatch.
- [x] Criar `task_run` no dispatch.
- [x] Criar evento `dispatch`.
- [x] Bloquear reenvio simples quando status ja e `running`.
- [x] Mudar status manualmente no detalhe.
- [x] Fechar `task_run` aberto quando status vira `done`, `blocked` ou `review`.
- [x] Criar evento `status.changed` com `closed_runs`.
- [x] Timeline basica no detalhe com criacao + eventos.
- [x] Reiniciar backend normal `:8000` com este codigo e validar no fluxo padrao `:3007/:8000`.
- [x] Limpar todas as tasks de teste.
- [x] Commitar bloco atual depois da validacao final.

Validacao real executada:

- Playwright em web isolada `:3010` apontando para API isolada `:8010`.
- Task valida do teste: `LB-4`.
- Fluxo de `LB-4`: criada -> dispatch -> `running` -> botao `EM EXECUCAO` disabled -> status `review`.
- Resultado esperado confirmado no banco: `task_runs.status='done'`, `ended_at` preenchido, `outcome='review'`, eventos `dispatch` + `status.changed`.

Observacao importante:

- O backend normal `:8000` estava com codigo antigo durante o primeiro teste. Por isso `LB-2`/`LB-3` serviram para achar a diferenca entre servidor antigo e codigo novo. Nao usar essas duas como prova do flow final.
- Em seguida o `:8000` foi reiniciado com o codigo atual. Smoke Playwright no fluxo normal `:3007/:8000` criou `LB-5`, validou dispatch -> `running` -> bloqueio de reenvio -> `review` com `closed_runs=1`, e deletou `LB-5` no cleanup.
- Banco confirmado com `tasks=0`, `task_runs=0`, `task_links=0` apos cleanup total.
- `human_id_counters.next_seq` resetado para `1` em todos os agentes, porque todas as tasks existentes eram teste.
- Backend normal `:8000` ficou ativo via `setsid`; `/api/tasks` retorna `[]`.
- Achado visual pendente: em viewport estreita durante o smoke, `scrollWidth` ficou maior que `clientWidth`; em desktop 1440px ficou OK (`1440 == 1440`). Revalidar mobile/estreito antes de fechar polish.
- Achado console pendente: dev console ainda mostra erro React sobre `<script>` dentro de componente; nao bloqueou o flow, mas deve entrar no polish.

### Fase 4.2 — Stdout curto da sessao

Objetivo: fazer o cockpit enxergar trabalho real, nao so status.

- [x] Capturar ultimas linhas uteis da sessao tmux do agente.
- [x] Hidratar `pane_excerpt` no snapshot `/api/fleet` sem gravar no banco.
- [x] Mostrar stdout curto no card do agente.
- [x] Mostrar stdout curto no detalhe/modal.
- [x] Limitar tamanho do excerpt para proteger UI e payload.
- [x] Manter fallback limpo para agente sem sessao/sem saida.

Aceite:

- Card do agente deixa de mostrar apenas `— nenhuma saída capturada —` quando ha sessao tmux ativa com output.
- `/api/fleet` nao trava se uma sessao tmux estiver lenta ou ausente.

Status: **entregue e validado em 2026-05-11**.

Decisao tecnica:

- `apps/api/services/tmux_driver.py` ganhou `capture_pane_excerpt()`.
- A captura usa `libtmux` `pane.capture_pane(start=-N, end='-', escape_sequences=True, join_wrapped=True)`.
- A chamada roda via `asyncio.to_thread` + `asyncio.wait_for`, com timeout curto.
- Sessao/pane ausente ou timeout retornam `None`; UI mostra fallback.
- `/api/fleet` hidrata o excerpt fora da transacao SQLite e nao grava `agent_state.pane_excerpt` nesta fase.
- Excerpt maximo: 1200 chars.

Validacao:

- `python3 -m compileall apps/api/services apps/api/routers` verde.
- `corepack pnpm type-check` verde.
- `corepack pnpm build` verde.
- `/api/fleet` retornou stdout real para sessoes tmux ativas e `None` para agentes sem sessao/output.
- Playwright em `:3007/:8000`: cards de `daniel`, `pavan`, `lucas`, `barsi` e `vinicius` exibiram stdout real; modal do agente exibiu `STDOUT · PANE`; desktop 1440px sem scroll horizontal.

### Fase 4.3 — Claim/lock atomico de dispatch

Objetivo: impedir corrida real de dispatch.

- [x] Criar claim transacional antes do envio para tmux.
- [x] Garantir que duas chamadas concorrentes nao criem dois `task_runs`.
- [x] Definir contrato equivalente sem novo estado: claim muda para `running` dentro de transacao SQLite `BEGIN IMMEDIATE`.
- [x] Se tmux falhar depois do claim, marcar task/run como `blocked` com evento `dispatch.failed`.
- [x] Expor erro claro na UI/API (`409 task ja esta em execucao`).

Aceite:

- Dois cliques/processos concorrentes na mesma task resultam em no maximo um dispatch real.

Status: **entregue e validado em 2026-05-11**.

Decisao tecnica:

- `dispatch` agora faz `claim_task_dispatch()` antes de enviar mensagem para tmux.
- O claim cria o `task_run`, muda a task para `running` e atualiza `agent_state.current_task_id` na mesma transacao.
- Se a task ja estiver `running`, a API retorna `409`; a UI usa o `detail` do backend em vez de mensagem generica.
- O evento `dispatch` so e gravado depois da entrega ao tmux.
- Falha de sessao tmux depois do claim fecha o run como `blocked`, limpa `current_task_id` e grava `dispatch.failed`.

Validacao:

- Context7 consultado para FastAPI, Next.js 16/React e libtmux antes da implementacao.
- `python3 -m compileall apps/api/db apps/api/routers apps/api/services` verde.
- `corepack pnpm type-check` verde.
- `corepack pnpm build` verde.
- `git diff --check` verde.
- Teste concorrente real: duas chamadas simultaneas para a mesma task geraram 1 resposta `202`, 1 resposta `409`, exatamente 1 `task_run` aberto e exatamente 1 evento `dispatch`.
- Smoke Playwright no fluxo normal `:3007/:8000`: task temporaria criada pela UI, despachada para Barsi, botao ficou `EM EXECUCAO`, segundo dispatch via API retornou `409 task ja esta em execucao`, evento `dispatch` confirmado e task de smoke deletada no cleanup.

### Fase 4.4 — Heartbeat e stale/crash detection

Objetivo: saber se uma task `running` ainda esta viva.

- [x] Atualizar `task_runs.last_heartbeat` a partir de hooks/eventos reais.
- [x] Detectar run sem heartbeat recente.
- [x] Marcar stale/crash como `blocked` na task e `timed_out` no run.
- [x] Mostrar heartbeat/stale no detalhe da task.
- [x] Registrar evento auditavel de stale/crash.

Aceite:

- Uma task `running` sem sinal por tempo demais nao fica eternamente verde.

Status: **entregue e validado em 2026-05-11**.

Decisao tecnica:

- `task_runs.last_heartbeat` e atualizado quando chegam hooks Claude Code ou eventos Codex para o agente que possui task `running`.
- O snapshot/listagem chama `mark_stale_runs()` antes de devolver dados para a UI.
- Threshold inicial: 600s (`RUN_STALE_THRESHOLD_SECONDS`), maior que o offline do agente para reduzir falso positivo.
- Quando expira, o run vira `timed_out`, a task vira `blocked`, `agent_state.current_task_id` e limpo e entra evento `run.stale`.
- `GET /api/tasks` e `GET /api/tasks/{id}` passaram a incluir dados do run atual: id, status, heartbeat, started/ended e outcome.
- `/api/fleet.health` expoe `stale_threshold_seconds`.
- O card do agente ficou simples: tempo de vida do agente (`ha Xmin`), tarefa atual e botoes de instancia rente a direita.
- O detalhe da task mostra dados do run e alerta quando o heartbeat esta vencido.

Validacao:

- `python3 -m compileall apps/api/db apps/api/routers apps/api/services` verde.
- `corepack pnpm type-check` verde.
- `corepack pnpm build` verde.
- `git diff --check` verde.
- Backend normal `:8000` e web normal `:3007` reiniciados com codigo novo.
- Smoke real: task temporaria criada e despachada, hook `PostToolUse` atualizou `last_heartbeat`, heartbeat antigo forcado virou `run.stale`, task ficou `blocked`, run ficou `timed_out`, e task de smoke foi deletada.
- Smoke Playwright em `:3007/:8000`: UI carregou e confirmou que `RUN·HB` nao aparece mais nos cards; o campo tecnico fica no detalhe da task.

### Fase 4.5 — Dispatcher automatico opcional

Objetivo: aproximar do Hermes completo, mas so depois do manual estar auditavel.

- [x] Definir contrato de `ready`: somente tasks `status='ready'` entram no loop automatico.
- [x] Preservar `backlog` como controle manual/rascunho; o loop nunca consome backlog.
- [x] Loop opcional pega tasks `ready`.
- [x] Aplica claim/lock atomico (`BEGIN IMMEDIATE`) antes de enviar para tmux.
- [x] Despacha para a sessao correta.
- [x] Respeita override manual: nao claimar agente que ja tem task `running`.
- [x] Registra eventos auditaveis com `payload.source='auto'`.

Aceite:

- O cockpit consegue mover trabalho de `ready` para execucao sem o Rica clicar, mas mantendo trilha auditavel e controle manual.

Status: **implementado e validado localmente em 2026-05-12**.

Decisao tecnica:

- O dispatcher automatico e opt-in via `GB_AUTO_DISPATCH_ENABLED=1`; default desligado.
- Settings novas: `GB_AUTO_DISPATCH_INTERVAL_SECONDS` e `GB_AUTO_DISPATCH_BATCH_SIZE`.
- `AutoDispatcher` roda no lifespan do FastAPI apenas quando habilitado, chama `mark_stale_runs()` antes do ciclo e consome no maximo `batch_size` claims por tick.
- `claim_next_ready_dispatch()` seleciona a proxima task `ready` por `priority DESC, created_at ASC`, ignora agentes ja ocupados com task `running`, muda a task para `running`, cria `task_run` e atualiza `agent_state.current_task_id` na mesma transacao.
- Falha de tmux apos claim usa o mesmo caminho auditavel do dispatch manual: task/run viram `blocked` e entra `dispatch.failed` com `payload.source='auto'`.

Validacao:

- Context7 consultado para FastAPI lifespan antes da implementacao.
- Smoke isolado com SQLite temporario confirmou:
  - task `backlog` nao e consumida;
  - task `ready` vira `running`;
  - `task_run` e evento `dispatch` sao criados;
  - evento `dispatch` recebe `payload.source='auto'`;
  - uma segunda task `ready` do mesmo agente nao e claimada enquanto ha task `running`.
- `python -m compileall apps/api/db apps/api/routers apps/api/orchestrator apps/api/services apps/api/main.py apps/api/config.py` verde.
- `corepack pnpm type-check` verde.
- `API_BACKEND_URL=http://127.0.0.1:8000 corepack pnpm build` verde.
- `git diff --check` verde.

### Fase 4.6 — Lifecycle e microestado do agente

Objetivo: mostrar no card o ultimo microestado real do agente, alimentado por
hooks/JSONL/Codex, sem depender apenas de heartbeat generico.

- [x] Persistir microestado em `agent_state`.
- [x] Derivar microestado de hooks Claude Code (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart/Stop`, `Stop`).
- [x] Derivar microestado de JSONL watcher como fallback.
- [x] Derivar microestado de eventos Tara/Codex.
- [x] Expor microestado no `/api/fleet`.
- [x] Renderizar `MICRO` na linha do slug (`// agente | MICRO ...`), sem usar a linha de cargo.
- [x] Registrar listeners SSE para `hook:*`, `tara.*` e `codex.*`.
- [x] Usar fallback pelo ultimo `task_event` quando o banco ainda nao tem lifecycle persistido.

Aceite:

- Quando chega um hook de tool, o card passa a indicar a ferramenta recente.
- Quando chega `Stop`/turno concluido, o microestado volta para idle.
- O frontend consome o snapshot do backend sem reimplementar regra de negocio.

Status: **implementado e validado localmente em 2026-05-12**.

Decisao tecnica:

- `agent_state` ganhou `lifecycle_status`, `lifecycle_detail`, `lifecycle_event` e `lifecycle_updated_at`.
- O backend grava detalhes curtos e truncados para proteger UI/banco.
- `PreToolUse` representa ferramenta em execucao; `PostToolUse` representa ferramenta concluida; `Stop` representa idle.
- JSONL continua sendo fallback defensivo quando hook HTTP falha.
- O card renderiza apenas `MICRO`, mantendo `status` macro (`running/idle/offline`) como decisao do backend.
- A linha de cargo do agente saiu do card para abrir espaco ao microestado.

Validacao:

- Context7 consultado para FastAPI lifespan/SSE antes da implementacao.
- `python3 -m compileall apps/api/db apps/api/routers apps/api/orchestrator apps/api/services apps/api/main.py apps/api/config.py` verde.
- `corepack pnpm type-check` verde.
- `API_BACKEND_URL=http://127.0.0.1:8000 corepack pnpm build` verde.
- `git diff --check` verde.
- Smoke isolado SQLite temporario confirmou persistencia e retorno no `fleet_snapshot`.
- Smoke isolado SQLite temporario confirmou fallback por ultimo evento (`hook:PreToolUse` -> `tool/Bash`).
- Smoke FastAPI `TestClient` confirmou `POST /hooks/PreToolUse` atualizando `/api/fleet` com `lifecycle_status='tool'`, `lifecycle_detail='Bash'`, `lifecycle_event='hook:PreToolUse'`.

### Fase 4.7 — Lifecycle move task para review/blocked

Objetivo: fazer o Kanban acompanhar o fim real de uma execucao, sem marcar
automaticamente como concluido.

- [x] `Stop`, `jsonl:assistant` com `end_turn`, `jsonl:result`, `tara.exec.completed` e `codex.turn.completed` fecham run aberto e movem task `running` para `review`.
- [x] `StopFailure`, `tara.exec.failed`, `codex.turn.failed` e `codex.error` fecham run aberto e movem task `running` para `blocked`.
- [x] Falha isolada de tool (`PostToolUseFailure`) nao bloqueia a task automaticamente.
- [x] Cada transicao gera evento auditavel: `lifecycle.review` ou `lifecycle.blocked`.
- [x] SSE frontend escuta `lifecycle.review` e `lifecycle.blocked` para refetch.
- [x] Activity feed resume esses eventos em linguagem simples.

Aceite:

- Quando um agente termina uma task em execucao, ela sai de `running` e entra em `review`.
- Quando uma falha terminal acontece, ela sai de `running` e entra em `blocked`.
- Nada vira `done` sem decisao humana.

Status: **implementado e validado localmente em 2026-05-12**.

Decisao tecnica:

- O fechamento por lifecycle usa `agent_state.current_task_id` quando existe; se nao existir, escolhe a task `running` mais recente do agente.
- `review` fecha o `task_run` como `done` com `outcome='awaiting_review'`.
- `blocked` fecha o `task_run` como `blocked` com `outcome='lifecycle_failed'`.
- `agent_state.current_task_id` e limpo ao sair de `running`.
- O evento de lifecycle inclui `source_event`, `closed_runs` e `outcome` no payload.

Divida registrada:

- Hoje `Stop` significa “turno terminou”, nao “entrega aprovada”. Por isso o destino e `review`, nao `done`.
- Ainda falta amarrar conclusao semantica real por protocolo de entrega do agente (ex: marcador explicito no output, comentario no cockpit ou botao humano de aprovar).
- Em agentes com mais de uma task `running` e sem `current_task_id`, o fallback escolhe a mais recente; precisa evoluir para vinculo session/instance/task antes de paralelismo pesado.

Validacao:

- `python3 -m compileall apps/api/db apps/api/routers apps/api/orchestrator apps/api/services apps/api/main.py apps/api/config.py` verde.
- `corepack pnpm type-check` verde.
- `API_BACKEND_URL=http://127.0.0.1:8000 corepack pnpm build` verde.
- `git diff --check` verde.
- Smoke SQLite temporario confirmou `hook:Stop` -> task `review`, run `done`, outcome `awaiting_review`.
- Smoke SQLite temporario confirmou `hook:StopFailure` -> task `blocked`, run `blocked`, outcome `lifecycle_failed`.
- Smoke FastAPI `TestClient` confirmou `POST /hooks/Stop` gerando evento `lifecycle.review`.

## Retomada rapida apos reinicio

1. Ler este arquivo.
2. Conferir `git status --short --branch`.
3. Se o backend normal ainda estiver rodando codigo antigo, reiniciar `:8000` antes de testar.
4. Rodar validacoes minimas:
   - `cd apps/web && corepack pnpm type-check`
   - `cd apps/web && API_BACKEND_URL=http://127.0.0.1:8000 corepack pnpm build`
   - `python3 -m compileall apps/api/db apps/api/routers apps/api/services`
5. Repetir smoke Playwright no fluxo padrao `:3007/:8000`.

## Estado atual confirmado

- `name`, `slug`, `role`, `cli_default`, `model_default` vem de `agents.yaml`, sincronizado na tabela `agents` (`role` nao aparece mais no card).
- `last_seen`, `current_task_id`, `pane_excerpt`, `state_cli`, `state_model` vem de `agent_state`.
- `lifecycle_status`, `lifecycle_detail`, `lifecycle_event`, `lifecycle_updated_at` vem de hooks/JSONL/Codex normalizados em `agent_state`.
- `instances` vem de `agent_instances` pelo snapshot `/api/fleet`.
- O card usa `/api/fleet` e mostra:
  - `agent.name`
  - `agent.slug` + `agent.lifecycle_status/detail` como `// slug | MICRO ...`
  - `agent.state_model ?? agent.model_default`
  - `agent.state_cli ?? agent.cli_default`
  - `agent.current_task_id ?? '—'`
  - `agent.pane_excerpt ?? '— nenhuma saída capturada —'`
  - `formatLastSeen(agent.last_seen, server_now)`
  - `agent.instances.length`

## Issue 1 — Alimentar tarefa atual do agente

Problema:

O campo `TAREFA` existe no card, mas fica vazio porque `agent_state.current_task_id` quase nunca e preenchido.

Contrato:

- Definir quando uma task vira "tarefa atual" do agente.
- Fonte preferida: tabela `tasks`, usando `assignee`, `instance_id` e status ativo.
- Status ativos sugeridos: `running`, depois `ready`, depois `backlog`, por prioridade/recencia.
- O snapshot `/api/fleet` deve devolver `current_task_id` coerente sem depender de gambiarra no frontend.

Aceite:

- Se Daniel tiver uma task em `running`, o card mostra o human id ou id dessa task.
- Se nao houver task ativa, mostra `—`.
- O Kanban e o card concordam sobre a mesma task.

Arquivos provaveis:

- `apps/api/db/store.py`
- `apps/api/routers/fleet.py`
- `apps/web/components/agent-card.tsx` somente se precisar ajustar exibicao.

## Issue 2 — Alimentar stdout curto da sessao

Problema:

O card tem area `STDOUT`, mas `pane_excerpt` nao esta sendo preenchido por fluxo real. Resultado: `— nenhuma saída capturada —`.

Contrato:

- Capturar um trecho curto da tmux session ativa do agente/instancia.
- Gravar ou hidratar como `pane_excerpt`.
- Nao fazer streaming completo de terminal nesta issue.
- Limitar tamanho para proteger UI e banco.
- Se nao houver tmux session valida, manter `pane_excerpt = null`.

Aceite:

- Agente com sessao tmux ativa mostra as ultimas linhas uteis no card.
- Agente sem sessao ou sem saida mostra fallback limpo.
- A captura nao trava `/api/fleet`.

Arquivos provaveis:

- `apps/api/services/tmux_driver.py`
- `apps/api/db/store.py`
- `apps/api/routers/fleet.py`
- `apps/web/components/agent-card.tsx` somente se precisar ajustar truncamento.

## Issue 3 — Consolidar estado efetivo do card

Problema:

CLI/modelo/status aparecem, mas podem misturar default do agente com estado real da instancia. O rodape e o topo usam a mesma variavel, mas a fonte ainda precisa ser definida com clareza.

Contrato:

- Definir prioridade unica para CLI/modelo no card:
  1. instancia ativa vinculada a task running, se existir
  2. ultima instancia ativa do agente, se existir
  3. `agent_state`, se preenchido
  4. defaults de `agents.yaml`
- Status do agente continua vindo do backend, nao do frontend.
- Frontend so renderiza o snapshot, sem reimplementar regra de negocio.

Aceite:

- `MDL/CLI` e rodape mostram a mesma fonte efetiva.
- `+N` continua mostrando instancias ativas.
- Card nao mostra `claude_code/opus` default se a instancia ativa for Codex.

Arquivos provaveis:

- `apps/api/db/store.py`
- `apps/api/routers/fleet.py`
- `apps/web/components/agent-card.tsx`

## Ordem recomendada

1. Issue 1 primeiro: tarefa atual.
2. Issue 2 depois: stdout curto.
3. Issue 3 por ultimo: consolidar CLI/modelo/status com base nas instancias reais.

## Atualizacao — Kanban e criacao/evolucao de tarefas

Achado apos inspeção da UI:

- Existe backend `POST /api/tasks`, mas nao existe UI para criar tarefa.
- O Kanban lista tasks reais do banco, mas as colunas sao fixas por status.
- Cards atuais no banco parecem seed/smoke de desenvolvimento.
- Clique no card do Kanban ainda e WIP: mostra toast, nao abre detalhe.
- Mudanca de status existe no backend via `PATCH /api/tasks/{id}`, mas nao ha controle visual nem drag-and-drop.
- Telegram/tmux nao cria task automaticamente hoje.

## Issue 4 — Criar UI minima para nova tarefa

Problema:

O cockpit tem API para criar task, mas nao tem botao/formulario para o Rica plantar uma missao diretamente no Kanban.

Contrato:

- Adicionar entrada "Nova tarefa" no cockpit.
- Campos minimos:
  - titulo
  - responsavel/agente
  - descricao/body opcional
  - prioridade opcional
  - status inicial, default `backlog`
- Chamar `POST /api/tasks`.
- Apos criar, atualizar snapshot (`mutate`) para card e Kanban refletirem a nova task.

Aceite:

- Rica cria uma tarefa pelo painel sem curl/API manual.
- A tarefa aparece em FILA se status `backlog`.
- O card do agente passa a poder mostrar essa tarefa como `current_task_id`.

Arquivos provaveis:

- `apps/web/lib/api.ts`
- `apps/web/components/kanban-board.tsx` ou novo componente dedicado
- `apps/api/routers/tasks.py` apenas se faltar validação/retorno

## Issue 5 — Criar detalhe de tarefa no Kanban

Problema:

O clique no card do Kanban hoje mostra apenas toast `ABRIR DETALHE · WIP`.

Contrato:

- Clique em uma task abre modal/drawer de detalhe.
- Mostrar campos:
  - human_id/id
  - titulo
  - body
  - assignee
  - status
  - priority
  - origin_agent
  - instance_id
  - created_at/started_at/completed_at
- Usar dados ja carregados no snapshot quando suficiente; buscar `GET /api/tasks/{id}` se precisar detalhe fresco.

Aceite:

- Clicar `JP-1`, `DS-2`, etc abre detalhe real.
- Nao aparece mais apenas toast WIP.

Arquivos provaveis:

- `apps/web/components/kanban-board.tsx`
- novo `apps/web/components/task-detail-modal.tsx`
- `apps/web/lib/api.ts`

## Issue 6 — Permitir evolucao manual de status

Problema:

O Kanban mostra colunas por status, mas nao existe UI para mover task entre `backlog`, `running`, `review`, `blocked`, `done`.

Contrato:

- No detalhe da task, adicionar controle de status.
- Chamar `PATCH /api/tasks/{id}` com o novo status.
- Atualizar snapshot apos sucesso.
- Drag-and-drop pode ficar para depois; primeiro fazer controle simples e confiavel.

Aceite:

- Rica consegue mudar uma task de FILA para EXECUTANDO manualmente.
- Ao mudar para `running`, a task sai de FILA e aparece em EXECUTANDO.
- Ao mudar para `done`, aparece em CONCLUIDO.

Arquivos provaveis:

- `apps/web/components/task-detail-modal.tsx`
- `apps/web/lib/api.ts`
- `apps/api/routers/tasks.py` se precisar ajustar contrato

## Issue 7 — Automatizar ciclo tarefa ↔ execucao (fase posterior)

Problema:

Telegram/tmux/hooks ainda nao criam nem evoluem tasks automaticamente.

Contrato futuro:

- Quando uma missao for criada/entregue para agente, task pode virar `ready` ou `running`.
- Quando hooks/observabilidade detectarem execucao real vinculada a uma task, atualizar status para `running`.
- Quando houver entrega/review, atualizar para `review` ou `done`.
- Precisa antes resolver a amarracao `task -> instance/session`.

Aceite futuro:

- O Kanban acompanha trabalho real sem Rica precisar mover tudo manualmente.
- Manual continua existindo como override.

## Dados de smoke/seed

As tasks atuais como `DS-1`, `DS-2`, `JP-1`, `FC-1`, `LM-1`, `VZ-1` parecem dados de smoke/dev.

Decisao pendente:

- Manter para teste visual durante Fase 4.
- Depois limpar ou arquivar antes de lancamento.

## Delegacao sugerida

Daniel decide o contrato e revisa.

Tara pode implementar issues disjuntas depois do OK:

- Tara A: Issue 1
- Tara B: Issue 2
- Tara C: Issue 4 ou Issue 5, se o contrato visual estiver fechado
- Daniel: Issue 3 + Issue 6 + integracao final

Nao abrir multi-sessoes antes de cravar o contrato, porque as tres issues mexem no mesmo conceito de "estado efetivo do agente".
