# Contrato tecnico — Cockpit Fase 4: card do agente vivo

Data: 2026-05-11

Objetivo simples: fazer o card do agente mostrar trabalho real, nao campo decorativo.

O card ja existe. O Kanban ja existe. O buraco atual e a ligacao entre:

agente -> instancia/sessao -> tarefa atual -> saida curta do terminal

Nao criar um novo Kanban agora. Primeiro abastecer os campos que ja existem.

## Status de execucao — 2026-05-11

- [x] Issue 1 — card do agente mostra tarefa atual derivada de tasks ativas.
- [ ] Issue 2 — stdout curto real da sessao no card/modal.
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
- [ ] Claim/lock atomico de dispatch concorrente.
- [ ] Heartbeat do run.
- [ ] Crash/stale detection.

## Fases de evolucao a partir daqui

### Fase 4.1 — Consolidar dispatch manual auditavel

Objetivo: transformar o Kanban manual em fluxo real minimo, sem automatizar ainda.

Status: **em validacao final**.

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
- [ ] Commitar bloco atual depois da validacao final.

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

- [ ] Capturar ultimas linhas uteis da sessao tmux do agente.
- [ ] Hidratar `agent_state.pane_excerpt` ou devolver `pane_excerpt` no snapshot `/api/fleet`.
- [ ] Mostrar stdout curto no card do agente.
- [ ] Mostrar stdout curto no detalhe/modal quando fizer sentido.
- [ ] Limitar tamanho do excerpt para proteger UI e banco.
- [ ] Manter fallback limpo para agente sem sessao/sem saida.

Aceite:

- Card do agente deixa de mostrar apenas `— nenhuma saída capturada —` quando ha sessao tmux ativa com output.
- `/api/fleet` nao trava se uma sessao tmux estiver lenta ou ausente.

### Fase 4.3 — Claim/lock atomico de dispatch

Objetivo: impedir corrida real de dispatch.

- [ ] Criar claim transacional antes do envio para tmux.
- [ ] Garantir que duas chamadas concorrentes nao criem dois `task_runs`.
- [ ] Definir estado intermediario se necessario (`dispatching`) ou contrato equivalente.
- [ ] Se tmux falhar depois do claim, reverter para estado seguro ou marcar `blocked`.
- [ ] Expor erro claro na UI.

Aceite:

- Dois cliques/processos concorrentes na mesma task resultam em no maximo um dispatch real.

### Fase 4.4 — Heartbeat e stale/crash detection

Objetivo: saber se uma task `running` ainda esta viva.

- [ ] Atualizar `task_runs.last_heartbeat` a partir de hooks/eventos reais.
- [ ] Detectar run sem heartbeat recente.
- [ ] Marcar stale/crash como `blocked`, `timed_out` ou estado definido.
- [ ] Mostrar alerta no card/modal.
- [ ] Registrar evento auditavel de stale/crash.

Aceite:

- Uma task `running` sem sinal por tempo demais nao fica eternamente verde.

### Fase 4.5 — Dispatcher automatico opcional

Objetivo: aproximar do Hermes completo, mas so depois do manual estar auditavel.

- [ ] Loop opcional pega tasks `ready`.
- [ ] Aplica claim/lock.
- [ ] Despacha para a sessao correta.
- [ ] Respeita override manual.
- [ ] Registra eventos auditaveis.

Aceite:

- O cockpit consegue mover trabalho de `ready` para execucao sem o Rica clicar, mas mantendo trilha auditavel e controle manual.

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

- `name`, `slug`, `role`, `cli_default`, `model_default` vem de `agents.yaml`, sincronizado na tabela `agents`.
- `last_seen`, `current_task_id`, `pane_excerpt`, `state_cli`, `state_model` vem de `agent_state`.
- `instances` vem de `agent_instances` pelo snapshot `/api/fleet`.
- O card usa `/api/fleet` e mostra:
  - `agent.name`
  - `agent.slug`
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
