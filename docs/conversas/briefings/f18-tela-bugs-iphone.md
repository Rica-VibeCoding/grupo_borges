# F18 — Tela: três defeitos que o Rica viu no iPhone (cadeira `tela`)

Carregue `frontend-design`. Leia `docs/conversas/relatos/f16.md` e `f17-tela.md` (o código é seu).
Você não commita. Relato em `docs/conversas/relatos/f18-tela.md` (até 15 linhas); capturas em
`C:\tmp\f18\`, 390×844. **Doc antes de código; prova de duas metades** (o defeito sumiu **e** o
atalho/feed seguem funcionando no caso normal).

## 1. "Voltar pra anterior" não some quando a conversa já tem turno — causa medida

Print do Rica (Fluyt, 02/10 ~00:14 UTC): a Nova deu 502 (`/rename` não chegou: `tmux input
indisponível ou armado antes do paste`, `/tmp/cockpit-api.log` na VPS), a conversa nova nasceu,
o Rica mandou uma mensagem **pelo Telegram**, o agente trabalhou 21 passos — e o atalho seguiu
aberto, âmbar, "Interromper e voltar".

Causa: `temPrimeiroTurno` (`apps/cockpit/lib/conversa-trocada.ts:76`) descarta todo texto que
começa com `<` — e mensagem de canal chega como `<channel source="plugin:telegram…">`. Sem marco
(a troca falhou), nada mais esconde o atalho, e a lista só é relida quando a `chave` muda.
Fala vinda de canal (Telegram, WhatsApp) é turno. Avalie também: agente `trabalhando` fora de
troca = a conversa tem turno.

## 2. O atalho flutua por cima do conteúdo

No mesmo print, o atalho (`absolute`, `voltar-pra-anterior.tsx`) e a linha "Fluyt está
trabalhando. Voltar interrompe." (texto sem fundo) ficam por cima do cartão "A troca de conversa
não terminou" — as letras se sobrepõem. Com o atalho aberto, nada do feed pode ficar embaixo dele
ilegível.

## 3. Texto duplicado depois de puxar uma conversa — reproduzir antes de teorizar

O Rica: "logo depois que eu puxei uma conversa, quando coloquei um texto, ele entra duplicado".
Ele retomou o Pavan às ~00:13 UTC (`POST …/pavan/conversas/7b0d9b4e…/retomar` 200) e mandou
mensagens enquanto o agente trabalhava (no stream elas vêm como `kind: queued` + `attachment`).
Reproduza no **canarinho** em https://borges.tailfe77db.ts.net:3446: Continuar esta numa
conversa antiga → mande texto pelo composer, com o agente parado e com ele trabalhando. Se
duplicar, ache a causa (replay da F13 + stream `since_id`? bolha otimista + `queued`?). Se não
reproduzir, diga o que tentou. Pode **olhar** o chat do Pavan na 3446; nunca mande nada nem
toque em troca fora do canarinho.

## Pronto

- `test` e `type-check`: base e depois, falhas antigas separadas.
- Fora daqui: `apps/api/` (se a causa do 3 estiver lá, descreva no relato e pare), o pulso dourado.

Viu furo? O seu caminho vale.
