# Fase 4 — texto da tela de voz entra na proposta visual (cadeira `ui`)

Pauta: `docs/modo-conversa/fase4-rodada-da-voz.md`. Base: seu clone como está — o item 5 (foto, direções B/C,
`direcao-da-voz.ts`, `retrato-da-voz.tsx`) ainda não tem commit e é o ponto de partida. `components/feed/feed.tsx`
tem uma linha minha (`useFlushSync: false`): não mexer.

## O que o Rica disse testando no iPhone (28/09, palavras dele)
- Tela parada: "Toque para falar… tá um negócio meio grotesco, meio grande demais". Quer "alguma coisa que estimule o
  usuário a tocar para falar, ou um texto menor".
- Palavras ao vivo enquanto ele fala: "pode ser menor e tem que ser mais discreto… de repente mais opaca ou
  futurística… uma experiência mais agradável que combine com tudo que tá rolando aqui".
- Estados (ouvindo, pensando, respondendo): "ficar acima da animação ou alguma coisa que combine e fique dentro dela".
  Hoje "Respondendo" sai em título enorme embaixo da esfera, com "Quando ele terminar, volto a ouvir".
- Resumo dele: "mudar toda essa parte textual para que ela faça mais parte da proposta toda… pode gastar bastante
  pensando em como seria isso para a gente deixar top". A decisão de desenho é nossa — não volta para ele.

## Como fazer
1. Pesquisa curta antes de desenhar: como ChatGPT (voz avançada), Gemini Live, Siri (iOS 18+) e Sesame tratam
   convite, estado e legenda ao vivo. Anote no relato o que adotou e por quê, em 5–8 linhas.
2. Direção de partida (pode melhorar, justificando):
   - Convite parado: sem título grande. Um sinal que chama o toque ligado ao aro/esfera (pulso lento, brilho) + no
     máximo uma linha pequena e discreta.
   - Estado: uma palavra curta junto da animação (acima ou dentro), na cor do estado; some a frase explicativa.
   - Ao vivo: legenda menor, meio-tom, últimas 2–3 linhas com as mais velhas esmaecendo — não parede de texto.
   - "Você disse" / resposta do agente: mesma família discreta; nada de 36 px.
3. Vale para B e C. "Mostrar texto" desligado continua limpo. Erro e aviso que pedem ação seguem legíveis (contraste
   AA, `--ck-text-secondary` no mínimo) e o `aria-live` continua anunciando o estado.

## Regras
- Não quebrar o item 6 (palavras ao vivo, "Você disse", "Não entendi" sem texto velho). Rodar de novo
  `e2e/fase4-ao-vivo-2.cjs` no fim.
- Esfera, moldura, foto e gestos (segurar, desligar, direita → chat) seguem funcionando. `prefers-reduced-motion`
  respeitado.
- Proibido: VPS (ssh/docker/túnel), commit, falar com agente real além do Canário.
- O dev 3009 é do Rica: não reinicie e não deixe arquivo meio escrito — ele trava no Windows.
- Teto 30% de contexto: chegou perto, escreva o relato e pare.

## Fecha quando
- Teste vermelho antes para regra pura nova (ex.: texto do convite/estado por cena).
- `npm test` e `type-check` verdes, com números.
- Capturas 390×844 no dev 3009, B e C: parado, ouvindo com palavras, entendendo, pensando, falando, erro. Em
  `docs/modo-conversa/e2e/fase4-texto/`.
- Relato em `relatos/fase4-ui.md` (seção nova). Última linha sozinha: `FIM-DO-TEXTO`.
