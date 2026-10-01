# Rodada 2 — Conferir o caminho inteiro (cadeira de teste)

Leia em `docs/conversas/PLANO.md` a seção "Rodada 2" (decisões e F14–F16). Você não escreve
código de produto e não commita. Relato em `docs/conversas/relatos/f16-conferir.md`, até 15
linhas, terminando em **APROVADO** ou **REPROVADO** com o motivo.

## O que está no ar (01/10, `b3352f1`)

- Tela: https://borges.tailfe77db.ts.net:3446, agente **canarinho**. API e tela publicadas.
- O canarinho (motor DeepSeek) é alvo de teste: pode ser religado à vontade. **Nenhum outro
  agente**: nunca toque em Continuar esta, Nova conversa nem Voltar pra anterior em outro cartão.
- Você está num PC Windows. Navegador de celular 390×844 com o que tiver à mão (Playwright com
  o Chrome instalado, por exemplo), **sem interceptar a rede**: aqui é tudo de verdade.

## O caminho (pela tela, nada por `curl`)

1. Mande uma mensagem curta ao canarinho e espere a resposta (a conversa precisa de turno).
2. Gaveta → **Nova conversa** → a gaveta fecha, o chat mostra o marco "Conversa nova" e o atalho
   **Voltar pra anterior** com o título da que saiu.
3. **Voltar pra anterior** → a anterior volta no chat e o atalho some.
4. Gaveta → Nova conversa de novo → mande uma mensagem → o atalho some no primeiro turno.
5. Histórico → tocar numa conversa antiga → abre a **leitura** (mensagens e nota) **sem trocar**
   o agente (o chat atrás continua o mesmo) → voltar.
6. Na leitura de outra: **Renomear** → o nome novo aparece na lista. ⭐ e tirar.
7. **Continuar esta** → a espera em barra → ela vira a atual.
8. **Concluída** numa conversa que não é a atual → sai de *Todas*, aparece em *Concluídas*.
9. Se der: mande algo longo ao canarinho e, com ele trabalhando, abra uma leitura: tem de
   aparecer a linha "… está trabalhando" e o botão âmbar. Não precisa tocar.

Capturas de cada passo em `C:\tmp\f16-conferir\`. O que estranhar como usuário (texto, demora,
tela confusa, animação que trava) também entra no relato.

Viu furo? Escreva no relato; seu caminho vale.
