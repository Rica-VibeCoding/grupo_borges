# Fase 4 — animações da tela de voz (cadeira `ui`)

Base: seu clone como está (main `e51a92e` + voz sem commit, incluindo a legenda do item 7). Não mexer em
`feed/feed.tsx`, `shell/seletor-conta.tsx`, `app/layout.tsx`.

## Pedido do Rica (28/09)
"Animações bem legais, bem modernas", leves, dentro da stack que já temos. Decisão tomada (não reabrir):
- **Sem biblioteca nova.** CSS Modules com `transform`/`opacity`, curvas `linear()` com cara de mola,
  `@starting-style` para entrada, `transition-behavior: allow-discrete` para saída.
- **Troca entre estados e telas:** `document.startViewTransition()` nativo (Safari 18.2+), com
  `view-transition-name` só no que persiste (a esfera). Sem suporte → troca direta, sem erro.
  `::view-transition { pointer-events: none }` não pode travar toque; confira.
- **Fora:** `<ViewTransition>` do React (canário), Motion, `interpolate-size`/`calc-size`, `animation-timeline`
  como essencial, animar `width`/`height`/`top`, `filter: blur` ou `backdrop-filter` animado.

## Onde
`components/conversa/*` — esfera, moldura, tela, retrato, texto-da-voz (e a legenda nova).
1. Abrir e fechar a tela de voz a partir do chat: esfera continua, o resto entra/sai em cascata curta.
2. Troca ouvindo → pensando → falando: a esfera muda de ritmo sem salto; o rótulo de estado troca com fade+deslize.
3. Legenda: frase nova sobe e aparece, anterior esmaece (continua o item 7, só o movimento).
4. "Toque para falar": convite sutil (respiro do anel), sem chamar mais atenção que hoje.
Durações curtas (150–400 ms), nada em loop além da esfera. `prefers-reduced-motion`: zera movimento e
**não** pode mudar o comportamento (hoje, com ela, a tela de voz abre o chat — conserte junto).

## Regras
- UI se testa clicando na tela: `browser-harness` (Chrome do agente no PC) para abrir o dev, abrir/fechar a voz,
  trocar estado e conferir console limpo. Playwright só para microfone falso (ciclo com o Canário real) e WebKit
  iPhone (checar que a troca sem suporte não quebra).
- Medir: nenhuma animação longa no main thread (Performance do Chrome ou `PerformanceObserver` long-animation-frame).
- Não reinicie o dev 3009. Proibido: VPS, commit, agente real além do Canário. Teto 30% de contexto.

## Fecha quando
`npm test` e `type-check` verdes, com números. Relato em `relatos/fase4-ui.md` (seção nova): o que anima,
duração de cada coisa, resultado no WebKit e com reduced-motion. Última linha sozinha: `FIM-DAS-ANIMACOES`.

## Adendo do Rica (28/09, testando no iPhone) — vale acima do item 3
- **Palavra por palavra, animado:** o texto (fala dele E do agente) aparece palavra a palavra, cada uma entrando com
  fade+leve subida. No agente, as palavras de cada frase se distribuem ao longo da duração daquele áudio (a frase
  começa com o áudio, como hoje); interromper congela onde está.
- **Janela de 3 linhas rolando:** sempre as 3 últimas linhas visíveis; o texto sobe suave conforme cresce, e o que passa
  do topo some no degradê que já existe. Vale para a fala dele e a do agente. Animar só `transform`, nunca `height`.
- **Não reiniciar a conversa:** o Rica viu a tela piscar e a conversa recomeçar do zero enquanto você salvava
  arquivos (recarga do dev). Salve em lote, e registre no relato se a recarga derruba a conversa (se sim, é item novo,
  não conserte agora).
- **Estado tem que ser a verdade:** hoje aparece "falando" enquanto o agente ainda pensa ou trabalha. Três estados
  distintos, cada um com animação própria na esfera e rótulo: *pensando* (esperando a resposta, sem ferramenta),
  *trabalhando* (o agente está usando ferramenta — o feed já mostra tool use), *falando* (só enquanto um áudio toca).
  Entre frases/áudios sem som não é "falando". Teste de unidade da regra de estado antes da animação.

## Revisão do Pavan (28/09) — antes de fechar
- **Nada de `box-shadow` animado:** respira, pulsa e a sombra da esfera por `--nivel-da-voz` repintam a cada quadro
  (bateria do iPhone). Sombra vai num `::after` e anima só `opacity`/`transform` dele.
- **`backdrop-filter: blur(20px)` do retrato:** caro com animação passando por baixo. Medir no WebKit; se custar, trocar
  por fundo sólido translúcido sem blur enquanto anima.
