# Fase 4 — item 7: legenda da fala do agente acompanha a voz (cadeira `ui`)

Pauta: `docs/modo-conversa/fase4-rodada-da-voz.md`, item 7. Base: seu clone como está (main `e51a92e` + voz nova
sem commit: `texto-da-voz.tsx`, `legenda-da-voz.ts`, item 5). Não mexer em `feed/feed.tsx`,
`shell/seletor-conta.tsx`, `app/layout.tsx` (consertos meus).

## O que o Rica viu no iPhone (28/09, 15:02)
"Ele trava em três linhas e não sobe conforme a IA vai falando." Hoje a resposta do agente (`respostaDoZe`) aparece
inteira, cortada em 3 linhas com esmaecido, e fica parada enquanto a voz lê o resto.

## Pedido
- Com "Mostrar texto" ligado, a legenda acompanha a voz **por frase**: a frase que está sendo falada fica em
  destaque; a anterior sobe e esmaece; o que ainda não foi falado não aparece. Mesma família visual discreta do
  texto novo (B e C).
- A voz já sai frase por frase (`use-fila-de-voz.ts`, efeito `falar` em `use-modo-conversa.ts`): a troca de frase
  vem do início de cada áudio, não de tempo estimado. Palavra por palavra fica fora.
- Interromper (falar por cima) congela a legenda na frase em que parou; texto novo do agente segue enfileirando.
- "Mostrar texto" desligado: nada muda.

## Regras
- Teste vermelho antes para a regra pura (qual frase está em destaque dado o índice do áudio tocando).
- UI se testa clicando na tela: skill `browser-harness` (Chrome do agente no PC) para abrir o dev, conferir console
  limpo e a tela; Playwright com microfone falso para o ciclo de voz com o Canário real (`e2e/fase4-ao-vivo-2.cjs` e
  `e2e/teste/fase4-bateria-real.cjs` caso 1). Resposta longa de verdade: peça ao Canário 4–5 frases.
- Não reinicie o dev 3009 nem deixe arquivo meio escrito. Proibido: VPS, commit, agente real além do Canário.
- Teto 30% de contexto.

## Fecha quando
- `npm test` e `type-check` verdes, com números. Relato em `relatos/fase4-ui.md` (seção nova), com a sequência de
  frases observada numa resposta real. Última linha sozinha: `FIM-DA-LEGENDA`.
