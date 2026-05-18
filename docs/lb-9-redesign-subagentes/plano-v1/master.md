# LB-9 — Plano v2 — Master

> Fonte canônica das decisões: `../decisoes-cravadas.md`
> Versão: v2 — 2026-05-18 (revisão Pavan sobre v1 do Daniel 4)
> Autor original: Daniel 4 · Revisor + decisões finais: Pavan

## Changelog v1 → v2 (Pavan)

- **A-automático (OneLineChip) → BACKLOG.** Caminho B (Popover) cobre 100%. A-automático é aditivo, não estrutural — entra depois sem refazer.
- **Worktree sempre na subsessão.** Substitui regex Edit/Write (frágil, falso negativo = race git). Custo 1s no spawn, cleanup centralizado.
- **`_subagent_state` continua chaveado por `parent_uuid`.** Adiciona campo `task_id` na entrada — não muda a chave (que quebraria SSE existente).
- **SSE: 1 EventSource global multiplexado, novo endpoint `/api/events/stream`.** Substitui N streams por slug. Server filtra eventos por slugs subscritos pelo cliente.
- **Bloco 3 cravado: handoff puro = sem picker "trabalhar com X".** Subsessão é spawn de filho independente. Picker de parceiro = nunca (decisão Rica #1).
- **Ordem de execução ajustada:** Bloco 5 ‖ (Bloco 3 ‖ Bloco 4) — mais paralelismo.

## Decisões cardinais (não regredir)

| # | Decisão |
|---|---|
| 1 | Handoff puro como semântica de "trabalhar com X" |
| 2 | Máx 3 subsessões simultâneas por task |
| 3 | Background silencioso (JSONL no arquivo, sem aba de log) |
| 4 | Skills só do workspace do agente-pai |
| 5 | Só o agente-pai da task pode spawnar |
| 6 | Painel mora no **card da TASK** (Popover no rodapé) |
| 7 | `visibility` é boolean (`true`=visível no card, `false`=background) |
| ➕ | Caminho: Híbrido B-base + A-automático via tool MCP |
| ➕ | LLM acorda via tool MCP `spawn_subsession`, NÃO slash |
| ➕ | JP-11 fix entra **junto** — SSE root layout + polling REST 5s reconcile |

## Princípio cross-bloco: D4 (cortar overengineering)

Custo alto + retorno baixo = NÃO. Dúvida entre 2 caminhos → o mais simples. Marcar alternativa como backlog, não implementar.

## Ritual fim-de-fase (D2) — executar em CADA bloco

1. Context7 via Tara sobre as libs do bloco → relatório em `/tmp/tara-bloco-N-context7.md`
2. Implementação (Daniel delega o máximo pra Tara)
3. Review paralelo: `code-reviewer` (subagent CC) + skill `simplify`
4. Triagem honesta dos relatórios (checar direto no código, não aplicar cego)
5. Aplicar o que faz sentido
6. Testes: typecheck + build + lint + pytest + Playwright onde indicado
7. `git pull --rebase` + commit convencional (paths explícitos) + push
8. Atualizar bridge `bloco-N-bridge.md` ANTES de fechar

## Ordem de execução (v2)

```
(Bloco 1 ‖ Bloco 2) → Bloco 5 ‖ (Bloco 3 ‖ Bloco 4) → Bloco 6
```

Justificativa:
- **Bloco 1 ‖ Bloco 2** — backend disjunto: tool MCP (`mcp_tools/`) ‖ SSE infra (`routers/agents.py` + `layout.tsx`). Spawnar 2 sessões em paralelo.
- **Bloco 5 ‖ (Bloco 3 ‖ Bloco 4)** — depois que 1+2 fecham, validações backend (5) + frontend task popover (3) + frontend badge (4) rodam em 3 sessões paralelas. Backend e frontend não brigam por arquivos.
- **Bloco 6 (E2E)** só depois de tudo funcional + smoke manual no `:3007`.

## Candidatos a simplificar (D4) — APLICADOS NO v2

1. **`stream_url` no retorno do tool** — omitido. Nenhum consumer planejado.
2. **Tokens estimados por subsessão** — omitido. Abrir `fc_backlog` `tipo='melhoria'` quando UI consolidar.
3. **TTL configurável por subsessão** — omitido. Fixo 10min, sem campo no Popover.
4. **`parent_session_id` no payload do tool** — omitido. `agent_slug` + `task_id` resolvem correlação.
5. **A-automático (OneLineChip de proposta espontânea)** — omitido v2, vai pra backlog. Caminho B (Popover) cobre 100%. A-automático é aditivo (novo evento SSE + estado de proposta pendente) — pode ser adicionado depois sem refazer nada estrutural. Decisão Pavan: custo de manutenção alto pra ganho UX marginal.
6. **Regex Edit/Write na prompt (Bloco 5)** — substituído por **worktree sempre**. Regex frágil (falso negativo = race git real); worktree custa 1s no spawn e mata a categoria de risco de vez.

## Regras cardinais cravadas pelo Pavan (v2)

- **Worktree sempre em subsessão.** Spawn cria `git worktree add` automático em `/tmp/subsession-<id>/`. Cleanup centralizado: helper `cleanup_worktree(subsession_id)` chamado em `mark_stalled` e em status `done`. Race git extinto por construção.
- **`_subagent_state` continua chaveado por `parent_uuid`** (não migrar pra `task_id` — quebraria SSE atual). Adicionar campo `task_id` na entrada para correlação de query.
- **1 EventSource global multiplexado.** Endpoint novo `GET /api/events/stream?slugs=daniel,pavan,...`. Cliente subscreve só os slugs visíveis. Server filtra e emite. Substitui N streams por slug.
- **Handoff puro = sem picker "com quem trabalhar".** Subsessão é filho independente. Popover do Bloco 3 NÃO tem campo de parceiro. Decisão Rica #1 cravada.

## Blocos

- [Bloco 1 — Backend: Tool MCP `spawn_subsession`](bloco-1-backend-tool-mcp.md)
- [Bloco 2 — Backend: SSE root layout + polling JP-11](bloco-2-backend-sse-polling-jp11.md)
- [Bloco 3 — Frontend: Card da Task + Popover](bloco-3-frontend-task-popover.md)
- [Bloco 4 — Frontend: Badge fix + OneLineChip](bloco-4-frontend-badge-onelinechip.md)
- [Bloco 5 — Validações + permissões + zumbi](bloco-5-validacoes-permissoes.md)
- [Bloco 6 — E2E Playwright](bloco-6-e2e-playwright.md)
