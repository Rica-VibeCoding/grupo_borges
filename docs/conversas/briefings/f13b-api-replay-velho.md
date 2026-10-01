# F13b — API: o stream abre num replay velho e despeja o resto ao vivo (cadeira `api`)

Código no `main` (F13 em `a54111b`). Você não commita. Relato em
`docs/conversas/relatos/f13b.md`, até 10 linhas, `pytest` contra a base (892 ok + 3 falhas de
ambiente + 2 xfailed).

## Fato medido na VPS (01/10, 06:33 UTC, canarinho, API publicada com a F13)

`curl -sN localhost:8002/api/agents/canarinho/messages/stream` aberto, depois Retomar de
`aacb8488` (atual era `c5ad79bb`). Saída gravada; contagem dos eventos:

- `replay-start` → 199 `message` de `c5ad79bb`, ids **1531748–1532027** → `replay-end`.
- Logo depois, **518 `message` ao vivo** de `c5ad79bb` com ids 1532028–1543146 e `timestamp`
  de **02:33 a 06:33** (o histórico, não fala nova), mais 80 de `aacb8488` (57 com
  `origem: cockpit`), e só então `conversa-trocada` → replay de 200 da `aacb8488`.
- No banco, as linhas de `c5ad79bb` com id ≥ 1532028 já existiam antes de o stream abrir
  (`created_at` desde 02:33). E há uuid repetido: `c5ad79bb` tem 883 linhas para 732 uuids;
  `aacb8488`, 30 para 21 depois de 1540612.

Ou seja: o replay da abertura não é a cauda, e o "ao vivo" entrega centenas de mensagens
velhas. Também: as 80 de `aacb8488` chegaram antes do `conversa-trocada`.

## Entrega

Descubra se é da F13 (abertura pela `_atual_da_linha`) ou anterior, e conserte: abertura =
cauda real da conversa atual; ao vivo = só o novo; nenhuma mensagem da conversa nova antes do
`conversa-trocada`. Explique os uuid repetidos (re-ingestão no `--resume`?) e diga se o feed
mostra duplicado. Teste que reproduz.

Viu furo? Escreva no relato; seu caminho vale.
