# F11 — Conferir o caminho inteiro (cadeira `teste`)

Leia em `docs/conversas/PLANO.md` a seção F11. Você não escreve código de produto e não
commita. Relato em `docs/conversas/relatos/f11.md`, até 15 linhas, terminando em **APROVADO** ou
**REPROVADO** com o motivo.

## O que está no ar (01/10)

- Tela: https://borges.tailfe77db.ts.net:3446, agente **canarinho** → gaveta → "Histórico de
  conversas". API e tela publicadas (F5, F6, F7, F10).
- O canarinho (motor DeepSeek) é alvo de teste: pode ser religado à vontade. Nenhum outro
  agente. Nunca aperte Retomar nem Nova conversa em outro cartão.
- Navegador: `playwright-core` com `/usr/bin/google-chrome-stable`, celular 390×844 (exemplo de
  montagem em `/tmp/f10/shot.mjs`, mas **sem** interceptar a rede: aqui é tudo de verdade).

## O caminho (pela tela, nada por `curl`)

1. Nova conversa → espera → o cartão "Em uso agora" muda; a conversa que saiu aparece na lista
   com título e nota escritos pelo agente.
2. Retomar uma conversa antiga com ⚠️ → espera → ela vira a atual.
3. O briefing: mande ao canarinho, pela caixa de texto do cockpit, "O sistema te deu contexto
   sobre o que mudou ao retomar? Cite literalmente ou diga nada." A resposta tem de citar o
   "Briefing de retorno do cockpit".
4. ⭐ numa conversa; filtro Especiais mostra; tirar a ⭐.
5. Excluir uma conversa curta (poucos turnos, não a atual) → some da lista.
6. Recarregar a página no meio de uma espera (repita o passo 2 com outra conversa): a espera
   volta.

Capturas de cada passo em `/tmp/f11/`. O que estranhar como usuário (texto, demora, tela
confusa) também entra no relato.

Viu furo? Escreva no relato; seu caminho vale.
