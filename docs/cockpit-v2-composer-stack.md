# Padrões de stack para o composer — levantamento de documentação oficial

> Levantamento de padrão, sem propor refatoração do código do composer.
> Stack: **React 19 · Next 16 · Tailwind 4** (Next 16 não aparece diretamente — as quatro perguntas são de React, CSS e ARIA).
> Fontes: react.dev (oficial), tailwindcss.com (oficial), WAI-ARIA APG em w3.org (oficial), MDN (referência de plataforma).
> Contexto: o mapa (`cockpit-v2-composer-mapa.md`) mostrou o modo do composer derivado de ~10 booleanos, uma faixa irmã que entra/sai da coluna (16–20px) e um botão que troca de função no mesmo slot.
> Régua: cada afirmação tem fonte. Onde a doc não responde, está escrito **"doc não cobre"**.
> Gerado em 20/08 a pedido do Daniel, via Context7 (`/reactjs/react.dev`, `/websites/react_dev_reference`, `/tailwindlabs/tailwindcss.com`) + WebFetch nas URLs citadas.

---

## 1) Máquina de estado de UI no React 19

### O que a doc RECOMENDA

**Os 5 princípios de "Choosing the State Structure"** (confirmados e citados) — react.dev/learn/choosing-the-state-structure:

1. **Agrupe estado relacionado.** *"If you always update two or more state variables at the same time, consider merging them into a single state variable."*
2. **Evite contradições.** *"several pieces of state may contradict and 'disagree' with each other, you leave room for mistakes."*
3. **Evite estado redundante.** *"If you can calculate some information from the component's props or its existing state variables during rendering, you should not put that information into that component's state."*
4. **Evite duplicação.** *"the same data is duplicated between multiple state variables… it is difficult to keep them in sync."*
5. **Evite estado profundamente aninhado.** *"prefer to structure state in a flat way."*

**Ampliação que interessa ao composer (o caso dos booleanos):** a própria doc dá a receita para o que o mapa da seção 3 chamou de "modo derivado de combinação implícita de booleanos". O exemplo é literal:

```js
const isSending = status === 'sending';
const isSent = status === 'sent';
```

— *"Derive boolean flags like `isSending` and `isSent` from a single `status` state variable for readability, without introducing new state variables that could get out of sync."* (mesma página). É a recomendação explícita para substituir booleanos sobrepostos por um `status` único + flags derivadas no render.

**Estado derivado se calcula DURANTE O RENDER, não em efeito** — react.dev/learn/you-might-not-need-an-effect:
- Anti-pattern nomeado pela doc: *"🔴 Avoid: Adjusting state on prop change in an Effect"*.
- Prescrição: *"✅ Best: Calculate everything during rendering"*.
- Padrão intermediário (quando precisa ajustar estado ao render): *"Better: Adjust the state while rendering"* — guarda de render com `setState` condicional (`if (items !== prevItems) { setPrevItems(items); setSelection(null); }`).

**`useReducer`** — a doc distingue o papel: *"Use `useReducer` for managing UI state where the reducer must remain pure."* (react.dev/reference/react/useActionState). O guia canônico de extrair lógica de estado para reducer é react.dev/learn/extracting-state-logic-into-a-reducer.

### O que a doc DESACONSELHA explicitamente

- Estado **redundante** (calculável de props/estado existente), **duplicado**, **contraditório** e **profundamente aninhado** — princípios 3, 4, 2 e 5.
- **Ajustar estado em efeito** quando se pode derivar no render ("You Might Not Need an Effect").

### Ponte para o mapa (observação, não proposta)

- O modo do composer é o produto de ~10 fontes (mapa §3). A doc recomenda exatamente o oposto: um `status` + flags derivadas.
- O efeito que limpa `avisoDaPorta` (`composer.tsx:334`) escreve estado derivado de combinação — é o padrão "adjusting state in an Effect" que a doc desaconselha.
- `texto`/`fila`/`anexo` etc. já são máquinas externas puras (mapa §1.3) — fora da alçada dos princípios locais.

---

## 2) O que o React 19 traz de novo que se aplica a um composer

### Actions (base dos três hooks abaixo)

Action = função (usualmente assíncrona) disparada por `form action` ou `startTransition`; o React a trata como transição e expõe `isPending`. — react.dev/reference/react/useTransition; react.dev/reference/react-dom/components/form.

### `useOptimistic` — serve para mostrar a mensagem antes da confirmação da porta?

**O que é:** *"A React Hook that creates optimistic state for a value, allowing the UI to reflect pending updates before they are finalized."* Retorna `optimisticState` + `setOptimistic`; o estado otimista vale **enquanto há Actions pendentes** e volta ao valor real quando a Action termina. — react.dev/reference/react/useOptimistic.

**Onde CABE:** o balão otimista do gesto — pintar a mensagem no instante do toque, antes de o servidor responder. É a função literal do hook (exemplo da doc: contador de carrinho aparece otimista antes do `addToCart` voltar — react.dev/reference/react/useActionState, exemplo "Combining useActionState and useOptimistic").

**Onde NÃO cabe:** o ciclo de vida "reverte ao fim da Action" não casa com a nossa confirmação. O "confirmado" do composer chega pelo **eco do stream**, 12 s a minutos depois (`lib/envio.ts`, seis fases; mapa §1.3) — não quando o POST (a Action) termina. O `useOptimistic` reverte ao settle da Action e não tem como segurar o otimismo até um sinal externo posterior. A nossa bolha otimista atual (`registraEcoPendente`, `composer.tsx:600`) não é uma Action e sobrevive ao fim do POST, esperando o eco — modelo que o hook não prevê. **A doc não cobre o caso de confirmação que chega depois do término da Action.**

### `useActionState` — cabe no nosso envio?

**O que é:** `useActionState(action, initialState)` → `[state, dispatch, isPending]`. Estado derivado de uma Action que **pode ter efeitos colaterais** — é a distinção que a doc faz contra o `useReducer` puro (ver Q1). — react.dev/reference/react/useActionState.

**Restrição crítica da doc:** *"The dispatch function must be called within an Action, such as by wrapping it in `startTransition` or passing it to an Action prop. Calls made outside of this scope will not be treated as part of a transition and will trigger a development error."*

**Onde CABE:** o trecho "POST até o 200" — é uma Action com efeito colateral, e `isPending` cobriria a fase `enviando`→`aceito`. A doc também nota que *"it processes calls sequentially"* — parente da nossa serialização da fila (`drenarFila`, `composer.tsx:635`).

**Onde NÃO cabe:** a máquina inteira. O estado do `useActionState` é **o retorno da action**; as nossas fases `confirmado`/`nao-confirmado`/`falhou` transicionam por **eventos externos** (eco do stream, POST rejeitado), não por `return` da action. E `envio.enviar` é chamado fora de escopo de Action (fila e retomada, `composer.tsx:647`, `:716`) — o que a própria doc aponta como erro em dev.

### `useTransition` — cabe?

`startTransition(action)` marca atualizações como não-bloqueantes e interrompíveis. — react.dev/reference/react/useTransition. **Cabe** para não travar o input durante o gesto de envio; **não resolve** a confirmação por eco (é o mesmo limite do `useOptimistic`).

### Conclusão direta às duas perguntas

- `useOptimistic` **serve conceitualmente** para o balão otimista, mas o ciclo "reverte ao fim da Action" **não casa** com a confirmação por eco de stream — caso que a doc não cobre.
- `useActionState` **cabe no POST** (Action com efeito colateral + `isPending`), **não cabe na máquina inteira** cuja confirmação é externa; e **exige chamada dentro de Action**, que a fila/retomada não usam.

---

## 3) Estabilidade de layout (Tailwind 4 + CSS)

### `visibility` vs desmontar — o caso da faixa que entra/sai (16–20px, mapa §6 causa B)

- **`visibility: hidden` mantém o espaço.** *"The element box is invisible (not drawn), but still affects layout as normal."* Para esconder E tirar do layout: *"set the `display` property to `none`"* — developer.mozilla.org/en-US/docs/Web/CSS/visibility.
- **Caveat (a doc cobre):** `visibility: hidden` *"removes the element from the accessibility tree"* e *"cannot receive focus"*.
- **Tailwind 4 expõe a propriedade:** utilitário `invisible` = `visibility: hidden` (mantém o espaço); `hidden` = `display: none` (tira do fluxo); `visible` = `visibility: visible`. — tailwindcss.com/docs/visibility, /docs/display.
- Hoje a faixa de instrução é **desmontada** por condicional (`composer.tsx:1246`) — o que a doc diz que é o jeito de mexer no layout. Para esconder sem mover, a doc aponta `visibility`/`invisible`.

### `content-visibility` — a técnica que a MDN nomeia para "esconder sem solavanco"

- `content-visibility: auto` ativa containments e pula render de conteúdo fora da tela; para reservar o tamanho e **não deslocar o layout**, usa-se `contain-intrinsic-size`: *"provides a placeholder size so layout doesn't shift"* — developer.mozilla.org/en-US/docs/Web/CSS/content-visibility.
- **O exemplo da doc é literalmente a nossa faixa:** *"It's also used with `hidden` to preserve space, e.g. `contain-intrinsic-size: 0 1.1em` to represent a line of text and avoid layout shift when hiding."*
- Caveats: `hidden` *"effectively removes content from user-agent features (find-in-page, tab order, selection, focus)"*; suporte Baseline 2024 (navegadores mais novos).
- **Não confirmei nesta consulta** se o Tailwind 4 tem utilitário para `content-visibility` — a doc do Tailwind que consultei (visibility, display, min-height, grid) não o trouxe. Fica como lacuna da consulta, não como afirmação de ausência.

### `min-height` reservado

- O composer já reserva altura com um placeholder de 17px quando não há estado (`composer.tsx:1312`). A doc cobre o conceito por dois lados: `contain-intrinsic-size` como reserva de espaço (MDN content-visibility, acima) e `min-height` como utilitário do Tailwind — confirmado `min-h-dvh` (`min-height: 100dvh`), que também serve contra o chrome móvel — tailwindcss.com/docs/min-height.

### Grid com áreas sobrepostas

- **MDN grid-template-areas cobre as áreas nomeadas:** *"`grid-template-areas` … assigning them names"*; itens colocam-se via `grid-area`; **tokens nulos `.` criam espaço vazio REAL** — o exemplo `"." foot` ocupa uma célula de 150px×30px, ou seja, área vazia **reserva o track**. — developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas.
- **Doc não cobre:** a sobreposição literal de dois itens no mesmo slot ("multiple items can occupy the same area and overlap") e a afirmação "o track mantém o tamanho mesmo com área vazia" **não estão verbatim** na página consultada — o mecanismo deixa implícito (qualquer item pode referenciar a área pelo nome), mas a doc não o afirma.
- **Tailwind 4:** subgrid (`grid-cols-subgrid`/`grid-rows-subgrid` adotam as trilhas do pai) e valores arbitrários para grades complexas (ex.: `grid-cols-[24rem_2.5rem_minmax(0,1fr)]`). — tailwindcss.com/docs/grid-template-columns, /docs/grid-template-rows, /docs/styling-with-utility-classes.

### Conclusão Q3

Para a faixa irmã que entra e sai: a doc cobre duas vias — `visibility: hidden` / `invisible` (mantém o espaço, mas some da árvore de acessibilidade) e `content-visibility` + `contain-intrinsic-size` (reserva o espaço e é a técnica que a MDN cita para "evitar layout shift ao esconder uma linha de texto"). Desmontar com condicional (o que o composer faz hoje) é, na letra da doc, o que move o layout.

---

## 4) Acessibilidade de botão que troca de função

### Nome acessível (`aria-label` que muda)

- **APG Button:** o botão tem nome acessível; ele vem do conteúdo ou de `aria-labelledby`/`aria-label` — *"The button has an accessible label… it can also be provided with `aria-labelledby` or `aria-label`"* — w3.org/WAI/ARIA/apg/patterns/button/.
- O composer já troca o `aria-label` por fase (`composer.tsx:1015`, `:1048`, `:1071`).
- **Doc não cobre:** a APG Button **não tem regra** para nome acessível que muda ao trocar de função. A única regra de nome estável é de **toggle button**: *"it is critical the label on a toggle does not change when its state changes"* (ex.: "Mute" continua "Mute", o estado é que vira `pressed`). O nosso slot mic→parar→enviar não é toggle — é função nova, caso sem recomendação explícita.

### Anúncio a leitor de tela (troca de função precisa ser dita)

- **`aria-live`:** `polite` anuncia *"at the next graceful opportunity"*; `assertive` interrompe (usar só quando é imperativo). — developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-live.
- **`role="status"` (a doc cobre, e o composer já usa):** *"defines a live region containing advisory information… not important enough to be an alert"*; tem `aria-live` implícito `polite` e `aria-atomic` implícito `true`; *"Do not give focus to the status when its content updates."* — developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/status_role. O composer usa `role="status"` na linha de instrução da voz (`composer.tsx:1252`) e nos avisos (`:1177`, `:1273`).
- **Conexão que é inferência, não citação:** que trocar o `aria-label` de um botão **não** anuncia automaticamente e por isso precisa de uma região viva — isso combina duas páginas (nome via `aria-label` + anúncio via live region), não é frase de uma única doc. O canal correto para o anúncio da troca de função é a região `status` que o composer já mantém.

### Foco preservado

- **APG Button:** *"Following button activation, focus is set depending on the type of action the button performs."* Para ação que não dispensa o contexto: *"focus typically remains on the button after activation."* — w3.org/WAI/ARIA/apg/patterns/button/.
- **Consequência no nosso código (observação de mapa):** o slot troca de função por `key` distinta em cada ramo (`composer.tsx:1012`, `:1040`, `:1067`) — o React **desmonta e remonta** o nó, e o foco cai no `body`. A APG quer o foco "permanece no botão"; para isso o nó precisaria continuar o mesmo. **Doc não cobre** o par "slot polimórfico + remount por key" — a perda de foco ao remover o elemento é comportamento de plataforma, não recomendação da APG.

### Conclusão Q4

- Nome acessível deve descrever a função (APG Button). A mudança de função precisa ser **anunciada** — o composer já tem a região `role="status"` polite (`composer.tsx:1252`) que faz esse papel.
- Foco: a APG quer o botão preservado quando a ação não muda contexto; o remount por `key` não preserva. Caso polimórfico sem recomendação explícita na doc.

---

**Lacunas anotadas (doc não cobre / não confirmado nesta consulta):**
1. `useOptimistic` para confirmação que chega **depois** do término da Action — fora do modelo do hook.
2. Nome acessível de botão que troca de função (não-toggle) — a APG só trata toggle.
3. Sobreposição literal em grid / track que mantém tamanho com área vazia — implícito na MDN, não verbatim.
4. Utilitário de `content-visibility` no Tailwind 4 — não apareceu na consulta.
