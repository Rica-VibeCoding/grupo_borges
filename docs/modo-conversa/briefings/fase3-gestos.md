# Fase 3 — gestos no lugar dos botões (cadeira `ui`, depois do toque)

Pedido do Rica, 27/09, sobre a captura da tela limpa no iPhone: "Botão direito superior vai para a tela do
chat na mesma linha. [O] Voltar vira arrastar com o dedo para a esquerda; para voltar à conversa, arrastar
para a direita. Botão iniciar/retomar vira toque na tela." Configurações: ele escolheu **arrastar para cima**.

## O que muda
1. **Canto superior direito:** o ícone passa a abrir o chat de texto do mesmo agente (`/agente/{slug}`, a
   mesma linha). Sai o nome ao lado se sobrar ambíguo; decida pela captura.
2. **Voltar sai.** Na tela da conversa, **arrastar para a esquerda** leva ao chat (`/agente/{slug}`).
3. **No chat** (`app/agente/[slug]/`), **arrastar para a direita** volta para `/conversa/{slug}`. Não pode
   brigar com rolagem horizontal (bloco de código, tabela), seleção de texto nem com o composer: só conta
   gesto claramente horizontal, acima de um limiar, que não começou dentro de algo rolável ou editável.
4. **Arrastar para cima** na conversa abre a folha de configurações (visual, fone, mostrar texto). A folha
   fecha arrastando para baixo e tocando fora, como já fecha.
5. Gesto nenhum pode disparar o toque de começar/parar: arrasto não é toque. Sair da tela com a conversa
   ativa encerra como o parar (freio incluso).
6. Leitor de tela e teclado não fazem gesto: o botão de configurações e o link do chat continuam existindo
   para eles (visualmente ocultos se preciso). A primeira vez que abrir, uma dica curta de 2 s ("arraste
   para cima: configurações") é aceitável; depois nunca mais (guardado no aparelho).
7. Borda esquerda do Safari é o "voltar" do navegador — não dependa dela; teste que o arrasto começado no
   meio da tela funciona.

## Limites e fecho
Como `fase3-toque.md`, mais a pasta `app/agente/[slug]/` para o item 3 (diff mínimo lá). Testes puros da
detecção de gesto (limiar, direção, origem), `npm test` e `type-check` verdes, E2E com toque simulado dos
três gestos em Fio e Matéria, relato em `relatos/fase3-ui.md`. Sem commit. Última linha: `FIM-DOS-GESTOS`.
