# F3 — API: estrela, excluir e `bloqueada_por` (cadeira `api`)

Leia em `docs/conversas/PLANO.md`: "Contrato da API" e a seção F3. O código da F2 já está no
`main` (`apps/api/services/conversas.py`, `routers/conversas.py`); o relato dela em
`docs/conversas/relatos/f2.md`. Você não commita. Relato em `docs/conversas/relatos/f3.md`, até
15 linhas, com o `pytest` contra a base (786 ok + 3 falhas de ambiente).

## Entrega

- `POST /{id}/estrela {valor}`: grava em `conversa_meta` (upsert).
- `DELETE /{id}`: manda o JSONL para a lixeira com `gio trash`, e também a pasta irmã
  `<id>/` (subagentes, anexos), se existir. Antes, o id passa pelo `_SESSION_ID_PATTERN`
  (`services/tmux_driver.py:490`) e o caminho resolvido tem de ficar dentro da pasta do agente.
  Responde 409 se a conversa for a atual ou estiver 🔒. A linha da `conversa_meta` sai junto.
- **`bloqueada_por`** no item da lista (pedido da F8, já no contrato): slug da linha que tem a
  conversa aberta, ou `null`. Quando a trava vem só do "escrito há < 2 min" sem dono conhecido,
  vale `null` com `bloqueada: true`.

## Régua de pronto

Testes: id malicioso (`../`, id de outra pasta), conversa atual → 409, 🔒 → 409, a ⭐ mantendo
uma conversa de 40 dias na lista, `gio trash` ausente ou falhando → erro legível sem apagar
nada, e `bloqueada_por` preenchido. `pytest` sem falha nova.

Na F3 o orquestrador publica a API na VPS e mede a lista real do Pavan. Sua parte termina no
relato.

Viu furo? Escreva no relato; seu caminho vale.
