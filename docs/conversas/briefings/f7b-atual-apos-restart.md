# F7b — API: a conversa atual depois de um restart da API (cadeira `api`)

Seu relato da F6 (`relatos/f6.md`, "Furo 2") e o da F7 descrevem o contexto. Código no `main`
(`94c4c62`). Você não commita. Relato em `docs/conversas/relatos/f7b.md`, até 10 linhas,
`pytest` contra a base (864 ok + 3 falhas de ambiente + 2 xfailed).

## Fato medido na VPS (01/10, 05:13)

- A F6 terminou com o canarinho em `--resume c5ad79bb…` (processo vivo com esse argumento).
- Restart da `cockpit-api` (publicação da F7). A troca em memória sumiu, e o banco ainda dizia
  atual = `a5b2f30c` porque a conversa retomada não tinha recebido mensagem.
- Resultado: a lista marcava `a5b2f30c` como atual ("Em uso agora" errado na tela), e
  `POST /a5b2f30c…/retomar` deu 409 "É a conversa atual desta linha". Só destravou depois que
  mandei uma mensagem ao canarinho.
- `_atual_da_linha` (`routers/conversas.py:74`) = `corrigir_atual(latest_jsonl_session_id)`.

## Entrega

A atual certa mesmo sem a troca em memória e sem mensagem nova. Sinais disponíveis: o
argumento `--resume <id>` do processo `claude` da linha, e o mtime que o `--resume` mexe
(relato F6). Escolha e justifique no relato; um teste que reproduz o caso acima.

Viu furo? Escreva no relato; seu caminho vale.
