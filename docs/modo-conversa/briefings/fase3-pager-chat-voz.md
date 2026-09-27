# Fase 3 — chat e voz na mesma tela (cadeira `ui`, substitui o deslize entre rotas)

## Por que refazer
Teste do Rica no iPhone, 27/09 às 13:31: arrastou 296 px para a esquerda, a mola rodou (11 quadros) e a rota não
trocou. Ficou o rosto provisório da voz, **preto**, cobrindo tudo. No WebKit a rota troca 1,2 s depois de soltar.
O defeito é do desenho: chat e voz são **duas rotas**, a mola anima um rosto provisório e só no fim pede a outra
página. Doc do Next 16 ([view transitions](https://nextjs.org/docs/app/guides/view-transitions)): não há transição
de rota dirigida pelo dedo; `startGestureTransition` do React é experimental e o router não expõe. Decisão da
coordenação: **nenhuma troca de rota no gesto**.

## Desenho
1. **Um pager, dois painéis montados:** chat à esquerda, voz à direita, no mesmo componente. `/agente/[slug]` e
   `/conversa/[slug]` renderizam o mesmo pager, só muda o painel inicial (entrar direto na voz continua funcionando).
2. **Arrasto nativo:** contêiner com `overflow-x: auto`, `scroll-snap-type: x mandatory`, painéis com
   `scroll-snap-align: start` e `scroll-snap-stop: always`, barra de rolagem escondida. Quem segue o dedo e assenta é o
   próprio iOS — sem listener de toque, sem `transitionend`. A rolagem vertical do chat continua dentro do painel dele.
3. **URL sem navegar:** quando o snap assenta (`scrollend`, com `IntersectionObserver` de reserva, confira o
   suporte no Safari), `window.history.pushState` para `/conversa/[slug]` ou de volta para `/agente/[slug]`
   ([integração com o router](https://nextjs.org/docs/app/getting-started/linking-and-navigating)). Ouvir
   `popstate`: voltar do navegador leva o pager ao painel certo.
4. **A voz só liga quando está na tela.** Montada fora da tela, ela não pede microfone, não liga wake lock e não
   gasta WebGL; o painel ativo é quem liga. Sair dela para o chat encerra a conversa como o parar (freio incluso).
   Carregue o componente da voz sem pesar a primeira pintura do chat (import dinâmico, pré-carga em ocioso).
5. **Tropa (direita no chat):** o arrasto para a direita no painel do chat, estando ele no começo do pager, abre a
   gaveta da tropa, que é o mesmo estado otimista do `≡`. Use a mola da folha (vaul, a mesma curva) seguindo o dedo.
   Como o dedo ali já é do pager, resolva a disputa com o scroll-snap e justifique no relato.
6. Some: `rostos-do-deslize.tsx`, `use-ida.ts`, o arrasto manual chat→voz e voz→chat, o `router.push` no fim da
   mola, e o que ficar órfão. `prefers-reduced-motion`: snap sem animação suave.

## Adendo do Rica (27/09, 13:41) — a sequência exata e o histórico
A sequência que ele quer, cada passo um dedo só:
1. Chat, tropa fechada → **direita** abre a tropa.
2. Tropa aberta → **esquerda** fecha a tropa (hoje não fecha pelo gesto). Fechar deixa no chat, não vai para a voz.
3. Chat, tropa fechada → **esquerda** vai para a voz.
4. Voz → **direita** volta para o chat. (Voz → cima continua abrindo as configurações.)

"Parece que está acumulando um monte de tela, para voltar eu tenho que desvoltar um monte." Então:
- Gesto **não empilha histórico**: chat ⇄ voz troca a URL com `replaceState`, não `pushState`, e abrir/fechar a
  tropa pelo gesto também não cria entrada nova (confira o `?nav=aberto` do caminho otimista). O item 3 do desenho
  acima fica com `replaceState`; `popstate` continua ouvido para o voltar do navegador.
- "Enxuto, sem sobrepor tela": uma instância de cada painel, nada montado duas vezes, nenhuma camada órfã por cima
  depois do gesto. A cadeira `teste` confere `history.length` e a contagem de camadas depois da sequência inteira.

## Limites e fecho
Context7 (ou a doc oficial por WebFetch) antes de codar: scroll-snap e `scrollend` no Safari iOS, `pushState` no
Next 16. Menor diff que entregue o desenho. `npm test`, `type-check` e E2E verdes. **Quem aprova é a cadeira
`teste`** (`fase3-cadeira-de-teste.md`): ao terminar, diga `PRONTO-PARA-TESTE` e espere o veredito. Sem commit, sem
build da 3008, nada em sessão viva. Relato em `relatos/fase3-ui.md`. Última linha: `FIM-DO-PAGER`.
