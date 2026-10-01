# F6 — API: Retomar (cadeira `api`)

Leia em `docs/conversas/PLANO.md`: "Armadilhas", "Contrato da API" e a seção F6 (o passo 6 traz
o que a F1 mediu dos diálogos). Seu relato da F5 está em `relatos/f5.md`; o código dela já está
no `main`. Você não commita. Relato em `docs/conversas/relatos/f6.md`, até 15 linhas, `pytest`
contra a base (822 ok + 3 falhas de ambiente).

## Fatos medidos na VPS (01/10)

- **Nova conversa publicada e provada no canarinho:** 200 `pronta` em 18 s. O agente gravou a
  nota pelo `curl`, o `/clear <título>` saiu e a nova recebeu o nome "Canário".
- **Boot com `--resume` não renomeia mais** (`ze_claude` `1c6763f`, guarda dentro de
  `renomear_via_api` no `subir-frota.sh`). Provado no canarinho com
  `systemd-run … --setenv=FROTA_FLAGS_EXTRA=--resume <id>`: título preservado, linha de pé.
- O Ligar monta o `systemd-run` em `services/tmux_driver.py` (procure `--setenv=FROTA_FLAGS_EXTRA`
  e `_FLAG_CONTINUE`). Retomar = o mesmo caminho com `--resume <id>` no lugar de `--continue`.
- `--resume` deixa o JSONL retomado como o mais recente da pasta (mtime mexe na subida).

## Entrega

`POST /{id}/retomar {forcar}` com o fluxo da F6 do plano, reusando o estado de operação da F5
(`/operacao` mostra `estacionando` → `religando` → `pronta`/`erro`). `retomada_em` gravado.

## Régua de pronto

Testes: id de outro agente, 🔒, a própria atual (409), ocupado sem `forcar`, falha no boot (a
linha volta com `--continue` e a resposta é erro legível — nunca linha morta calada), diálogo
detectado na tela. `pytest` sem falha nova. A prova A → B → A no canarinho é minha, depois de
publicar.

Viu furo? Escreva no relato; seu caminho vale.
