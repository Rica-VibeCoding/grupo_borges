# F17 — API: arestas da conferência (cadeira `api`)

Leia `docs/conversas/relatos/f16-conferir.md` (você escreveu) e, no PLANO, a seção "Rodada 2".
Você não commita. Relato em `docs/conversas/relatos/f17-api.md` (até 15 linhas).

## Entrega

1. **Leitura sem o pedido interno.** `ler_fim` (`services/conversas.py:711`) devolve o pedido de
   estacionar do cockpit (com o `curl`) e o "ok" do agente. O feed já sabe reconhecer esse turno:
   `routers/agents.py:2821` marca `origem: "cockpit"` usando o texto de
   `services/operacao_conversa.py:243`. A leitura usa a mesma régua e tira o pedido **e a resposta
   do agente a ele**.
2. **Conversa curta que some.** Conversa de 1 turno ganhou o marco "ficou guardada no Histórico",
   mas a lista esconde (`escondidas_curtas`) e a tela, que filtra no aparelho, não acha na busca.
   Regra: conversa deixada por uma troca do cockpit (tem linha na `conversa_meta` com título,
   nota, estrela, renomeada ou é a `anterior`) nunca é curta. Decida e escreva no relato.
3. **Investigar, sem consertar ainda:** o canarinho caiu ("Fora do ar") ~1 min depois do
   Continuar esta na conversa de 108 turnos (01/10, ~19:0x BRT). O log da API é
   `/tmp/cockpit-api.log` **na VPS** (`ssh clawd@100.116.1.44`, só leitura) e o JSONL do canarinho
   mora no projeto dele em `~/.claude/projects/` lá. Diga a causa com prova, ou "não achei".

## Pronto

- Testes dos itens 1 e 2; `pytest` dos `test_conversas_*` e `ruff` sem falha nova.
- Fora daqui: tela, e mexer no fluxo da troca.

Viu furo? O seu caminho vale.
