# F2 — API: a lista de conversas (cadeira `api`)

Leia em `docs/conversas/PLANO.md`: "Decisões", "Armadilhas", "Contrato da API" e a seção F2.
O relato da F1 (`docs/conversas/relatos/f1.md`) traz o que foi medido sobre `custom-title`.
Você não commita. Relato em `docs/conversas/relatos/f2.md`, até 15 linhas, com os números do
`pytest` contra a base da F0 (765 ok + 3 falhas de ambiente em `test_tmux_driver_ciclo_de_vida`).

## O que já existe — reusar, não reescrever

- `encoded_cwd()` (`apps/api/orchestrator/jsonl_watcher.py:95`) converte o `workspace_path` do
  `agents.yaml` no nome da pasta em `~/.claude/projects/`. A colisão de pastas entre agentes já
  custou um dia (docstring de `_mapear_por_encoded`, `:723`): duas linhas com o mesmo
  `workspace_path` não podem listar as conversas uma da outra. Hoje não há colisão no
  `agents.yaml`, mas a lista tem de se comportar como o watcher se houver.
- Conversa atual da linha: `db.latest_jsonl_session_id(slug)` (`apps/api/db/store.py:1586`).
- Validação de id: `_SESSION_ID_PATTERN` (`apps/api/services/tmux_driver.py:490`).
- Tabela nova: `db/schema.sql` com `CREATE TABLE IF NOT EXISTS`, aplicada por `_apply_schema`
  (`store.py:331`).
- Molde de teste de rota: `tests/test_agent_input.py`.

## Régua de pronto

- `services/conversas.py` + a rota `GET /api/agents/{slug}/conversas` exatamente como o contrato.
- Lê só começo e fim de cada JSONL, com cache por `mtime`. A pasta real do Pavan na VPS tem ~172
  arquivos; a F3 mede o tempo lá — desenhe para passar folgado de 1 s com cache.
- Título pela ordem de queda do contrato; título igual ao nome do agente (`name` do
  `agents.yaml`, e variantes como "José Pavan") conta como ausente.
- `atual` e `bloqueada` como a F2 do plano descreve.
- Fixtures em `tests/fixtures/conversas/` com JSONL de verdade, encurtados (sem dado pessoal).
  Testes cobrindo no mínimo: queda do título, arquivo truncado/linha quebrada não derruba a
  lista, `curtas`, janela de 30 dias + ⭐, `bloqueada`, motor não-CC devolvendo `suportado:false`.
- `pytest` inteiro sem falha nova.

## Fora

Escrita de qualquer tipo (estrela, excluir, estacionar), selo ⚠️ (`pendencia` fica `null`) e tela.

Enxergou furo no contrato ou no plano? Escreva no relato antes de contornar; seu caminho vale,
você está com o código na frente.
