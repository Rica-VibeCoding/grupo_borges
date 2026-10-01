# F16 — Tela: Nova conversa na gaveta e Voltar pra anterior (cadeira `tela`)

Carregue a skill `frontend-design`. Leia em `docs/conversas/PLANO.md` a seção "Rodada 2" (decisões 3
e 4, "Movimento da rodada 2", bloco F16) e os relatos `docs/conversas/relatos/f15-prototipo.md` e
`f15.md`. A captura `5-nova-vazia.png` / `5b-gaveta.png` do protótipo está em `C:\tmp\f15\`: o Rica
aprovou esse desenho.

Você não commita. Relato em `docs/conversas/relatos/f16.md` (até 15 linhas); capturas em
`C:\tmp\f16\`, 390×844.

## Onde mora (`main`, depois de `5d3e401`)

- Gaveta: `apps/cockpit/components/gaveta/gaveta-nova.tsx` (a porta do Histórico) e
  `cartao-em-uso.tsx`, onde a Nova conversa vive hoje (F10). Ações e o 409 `ocupado` em
  `usa-acoes-de-conversa.ts` (`pedeNova`).
- Marco da troca no chat (F13): `app/agente/[slug]/usa-troca-no-chat.ts`, `lib/conversa-trocada.ts`,
  `components/feed/marco-da-troca.tsx`.
- API (F14, já no `main`): a lista traz `anterior` (id ou `null`); retomar é
  `POST /{id}/retomar {forcar}`, já no `cockpit-core/api.ts`.

## Entrega

1. **Nova conversa na gaveta**, ao lado da porta do Histórico, um toque. Mesmo comportamento do
   Continuar esta: ocioso, sem confirmação; ocupado, linha + âmbar. Sai do cartão de cima (não fica
   em dois lugares).
2. **Voltar pra anterior** na conversa nova vazia, acima do composer, com o título da anterior
   embaixo. Usa o `anterior` da API; some no primeiro turno e quando `anterior` vier `null`. Sem foto
   do agente.
3. Movimento dos dois pelos itens da seção do plano.

## Pronto

- `test` e `type-check`: base e depois, falhas antigas separadas.
- Fluxo no navegador: Nova pela gaveta → Voltar pra anterior → a anterior volta e o atalho some.
- Fora daqui: `apps/api/`, publicação.

Viu furo? O seu caminho vale: você está com a tela na frente e eu não.
