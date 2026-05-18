# Chat UI patterns — pesquisa pro cockpit

> Stack: Next 16 + React 19 + Tailwind 4 + SSE. Produto interno (1 usuário, mobile Safari/iOS).

## Resumo executivo

- TOP 1: otimistic update com `useOptimistic` + estado `pending/error` na mensagem enviada. Baixa complexidade, alto ganho percebido no celular.
- TOP 2: scroll inteligente antes de virtualizar: sentinel no fim, `ResizeObserver`, preservação de posição em prepend e batching de scroll. Baixa/média complexidade, alto ROI.
- TOP 3: streaming fluido com buffer por `requestAnimationFrame` ou throttle curto. Médio esforço, alto ROI se o gargalo atual for render por token/chunk.

## 1. Virtualização da lista

- Estado da arte 2026: virtualização é padrão quando há centenas/milhares de mensagens, markdown pesado ou anexos. Para chat, o problema não é só "renderizar menos"; é manter bottom-stick, prepend de histórico e altura variável sem jump.
- Recomendação pro nosso caso: começar sem virtualização. O `ChatMessages` atual ainda é simples, mas renderiza todos os itens e markdown; medir primeiro com histórico real. Se passar de ~300-500 itens ou houver jank claro no iPhone, adotar `react-virtuoso` antes de `@tanstack/react-virtual`.
- Biblioteca recomendada: `react-virtuoso` para chat. Ela já tem `followOutput`, medição de altura variável, prepend e exemplos de message list. `@tanstack/react-virtual` é excelente e menor/mais baixo nível, mas exige mais código caseiro para bottom-stick, medição e ajuste de scroll.
- Tailwind 4/React 19: sem conflito relevante. O cuidado é manter altura do scroller estável (`min-height: 0`, container flex correto) e evitar margins colapsadas dentro dos itens virtualizados.
- Complexidade: média com `react-virtuoso`; alta com `@tanstack/react-virtual` para chat invertido/prepend.
- ROI estimado: médio agora; alto se histórico por agente ficar grande ou markdown/tool chips crescerem.
- Refs: Context7 `react-virtuoso` message list/prepend (`https://github.com/petyosi/react-virtuoso/blob/master/packages/message-list/docs/3.examples/01.messaging.md`), Virtuoso `followOutput` (`https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/`), TanStack Virtual dynamic measurement/overscan (`https://tanstack.com/virtual/latest/docs/api/virtualizer`), Vercel Chat SDK template usa Next/App Router + AI SDK + shadcn mas não evidencia virtualização por padrão (`https://github.com/vercel/chatbot`).

## 2. Atualização otimista

- Estado da arte 2026: React 19 tornou optimistic UI uma primitiva nativa via `useOptimistic`. Para chat, o padrão é inserir a mensagem localmente no submit, limpar o input imediatamente, marcar como `sending`, reconciliar com o evento confirmado do backend e exibir retry em erro.
- Recomendação pro nosso caso: usar `useOptimistic` nativo, não adicionar TanStack Query/SWR só para envio de chat. O backend já tem SSE; a reconciliação deve acontecer por `uuid/client_id` quando o evento real chegar.
- TanStack Query/SWR: fazem sentido se houver cache complexo, invalidação multi-tela, retry padronizado ou mutações compartilhadas. Para produto interno, 1 usuário e SSE já existente, é mais peso que benefício.
- Complexidade: baixa, desde que o envio passe a carregar um `clientMessageId` local para reconciliar e evitar duplicata.
- ROI estimado: alto. É a melhoria que mais aproxima a sensação de WhatsApp/Telegram: input limpa na hora, bubble aparece na hora, erro fica explícito.
- Refs: Context7 React 19 `useOptimistic` (`https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useOptimistic.md`), React 19 blog (`https://github.com/reactjs/react.dev/blob/main/src/content/blog/2024/12/05/react-19.md`), AI SDK `useChat.setMessages` para atualização local (`https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat`).

## 3. Scroll inteligente

- Estado da arte 2026: chats bons tratam scroll como estado de UX, não efeito colateral. O usuário "grudado no fim" recebe auto-scroll; usuário lendo histórico não é arrancado do ponto atual; prepend de mensagens antigas preserva a posição visual; mudanças de altura por markdown/imagem não causam jump.
- Recomendação pro nosso caso: padrão caseiro incremental antes de biblioteca: sentinel no fim com `IntersectionObserver`, `ResizeObserver` no conteúdo, threshold de bottom maior que 24px no mobile, botão "nova mensagem" só quando o sentinel não está visível, e preservação por delta de `scrollHeight` quando carregar histórico no topo.
- WhatsApp/Telegram: não há implementação pública oficial para web; o comportamento observável é bottom-stick condicional + preservação de leitura + indicador de novas mensagens. Qualquer detalhe interno deve ser tratado como inferência.
- Bibliotecas: `react-virtuoso` resolve boa parte disso se a virtualização entrar. Sem virtualização, `scrollIntoView({ block: "end" })` no sentinel é mais previsível que setar `scrollTop` em vários pontos, mas ainda precisa de guarda para não roubar scroll.
- Complexidade: baixa/média.
- ROI estimado: alto no iPhone, principalmente com teclado virtual, markdown que expande e SSE chegando enquanto Rica lê mensagens anteriores.
- Refs: Context7/Virtuoso prepend mantém posição (`https://github.com/petyosi/react-virtuoso/blob/master/packages/message-list/docs/20.scroll-modifier.md`), MDN `IntersectionObserver`/`ResizeObserver` verificar conforme implementação, TanStack `shouldAdjustScrollPositionOnItemSizeChange` (`https://tanstack.com/virtual/latest/docs/api/virtualizer`).

## 4. Streaming fluido

- Estado da arte 2026: render por token puro pode parecer "real-time", mas custa caro quando cada chunk re-renderiza markdown, syntax highlight, chips e layout. O padrão moderno é acumular chunks e publicar no React em lote curto: `requestAnimationFrame`, throttle de 16-50ms, ou buffer por frase/bloco quando markdown está incompleto.
- Recomendação pro nosso caso: manter SSE atual. No hook de stream, agregar chunks em ref e fazer `setState` no máximo 1x por frame. Enquanto a resposta está streamando, renderizar texto simples ou markdown parcial leve; aplicar markdown/highlight completo no final ou com throttle maior.
- AI SDK como referência, não adoção obrigatória: `useChat` tem `experimental_throttle` para updates de mensagens/dados; o protocolo suporta text/data streams e até FastAPI como backend custom. Como nosso backend SSE já existe, copiar o pattern de throttle é melhor que trocar stack.
- Complexidade: média.
- ROI estimado: alto se hoje cada SSE/evento reconstrói `items`, `toolResults` e markdown. Médio se os eventos já chegam coalescidos.
- Refs: Next 16 Route Handlers/streaming via Context7 (`https://github.com/vercel/next.js/blob/v16.1.6/docs/01-app/01-getting-started/15-route-handlers.mdx`), AI SDK `experimental_throttle` (`https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat`), AI SDK stream protocols/FastAPI custom backend (`https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol`), Vercel Chat SDK (`https://github.com/vercel/chatbot`).

## 5. CSS containment + content-visibility

- Estado da arte 2026: `contain` é seguro para isolar custo de layout/paint em bolhas independentes. `content-visibility: auto` pode reduzir render offscreen em páginas longas, mas em chat com scroll bottom, altura dinâmica, markdown e iOS WebKit, precisa teste real.
- Recomendação pro nosso caso: usar `contain: layout paint style` ou `contain: content` em bubbles/chips estáveis e medir. Evitar `content-visibility: auto` como primeira ação no scroller principal; testar em branch no iPhone antes, com `contain-intrinsic-size` aproximado por tipo de mensagem.
- iOS Safari/Chrome iPhone: Chrome iPhone usa WebKit. MDN marca `content-visibility` como recurso com tabela de compatibilidade e alerta que nem toda parte do spec pode estar implementada; logo, tratar como otimização progressiva, não base de UX.
- Tailwind 4: usar utilitários existentes (`will-change-transform`, `transform-gpu` quando houver animação curta) ou classes CSS locais para `contain`/`content-visibility`. Não deixar `will-change` permanente em centenas de mensagens.
- Complexidade: baixa para `contain`; média para `content-visibility`.
- ROI estimado: médio para `contain`; baixo/médio para `content-visibility` até medir no aparelho do Rica.
- Refs: MDN `content-visibility` (`https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility`), MDN `contain` (`https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain`), Tailwind `will-change` (`https://tailwindcss.com/docs/will-change`), Tailwind v4 transforms (`https://tailwindcss.com/blog/tailwindcss-v4`).

## Extras avaliados

- React Compiler: verificar depois. React 19 tem runtime nativo para o compiler, mas ligar compiler em app existente pode expor assumptions de componentes. ROI baixo antes de resolver scroll/stream/render markdown.
- Tailwind GPU transforms: útil para microanimações de entrada, botão "nova mensagem" e spinner. Não resolve jank de render; usar com parcimônia.
- IntersectionObserver para lazy mount: bom para sentinel de bottom/top. Para desmontar mensagens manualmente, vira virtualização caseira; melhor usar Virtuoso se chegar nesse ponto.
- Web Worker para markdown pesado: considerar se profiling mostrar `react-markdown`/`rehype-highlight` dominando CPU. Complexidade média/alta porque React render ainda fica na main thread; ROI depende do volume de blocos de código.
- Suspense boundaries no streaming: baixo ROI aqui. SSE client-side e produto interno; Suspense ajuda mais em data fetching/server boundaries que em token streaming já conectado.
- shadcn/chat ecosystem: há componentes públicos de chat e AI, mas muitos são templates/UI kits, não provas de performance. Usar como referência visual/comportamental, não como dependência automática.
- Cases públicos: Vercel Chat SDK é o case mais aplicável. Resend publica integração com Vercel Chat SDK como canal de agentes. Linear, Cal.com: não encontrei case público específico de chat UI performance para citar com segurança; verificar se Daniel tiver links internos.

## Não recomendado pro nosso caso (por quê)

- Big-bang para AI SDK `useChat`: nosso backend FastAPI + SSE já está vivo; trocar protocolo agora custa mais que copiar os patterns de throttle/reconnect.
- Edge runtime/SSR avançado/service worker: fora do problema. Rica usa interno via Tailscale; o gargalo percebido é interação/render/scroll.
- Virtualização imediata sem profiling: pode introduzir bugs de scroll em iOS e complicar chips/markdown antes de sabermos se a lista é o gargalo.
- `content-visibility: auto` em todas as mensagens: risco de jump/bugs em WebKit e altura variável; aplicar só depois de teste real.

## Próximo passo

Cruzar com diagnóstico do Daniel (lista de hotspots em `docs/refactor-playbook.md`) pra tirar 3-5 itens de ataque.
