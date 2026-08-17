# Arrasto no iPhone — sidebar do cockpit (pragmatic-drag-and-drop 3.0.0)

Data: 17/08/2026 · Toda afirmação tem link. Licença/data de pacote vêm de `registry.npmjs.org`, nunca de blog.

## 1. Impedir o `<a>` de roubar o gesto: `draggable="false"` ou `-webkit-user-drag: none`?

- **O atributo é o padrão e é o que funciona.** MDN: *"If this attribute is not set, its default value is `auto` (…) only text selections, images, and links can be dragged"*; *"`false`: the element cannot be dragged"*. É *enumerated/enumerado* — `<a draggable>` é proibido, tem que ser `draggable="false"` por extenso — https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/draggable
- **`-webkit-user-drag` é não-padrão E não tem efeito no iOS.** caniuse marca status `unoff` e iOS Safari `n` em **todas** as versões até 26.5; nota literal: *"Webkit and blink-based mobile browsers recognize the property but it does not appear to have any effect"* e *"See the standardized draggable attribute/property for the recommended alternative"* — https://caniuse.com/webkit-user-drag · dado bruto https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/webkit-user-drag.json
- MDN **não tem página** pra `-webkit-user-drag` (`/Web/CSS/-webkit-user-drag` devolve 404); só aparece listado em https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Webkit_extensions
- **Relato vivido que diz o contrário** (iPadOS/WKWebView, 2020): *"this can be solved with CSS by styling anchors with both of the following properties: `-webkit-touch-callout: none;` `-webkit-user-drag: none;`"* — https://developer.apple.com/forums/thread/665824 . Conflita com o caniuse; trate o CSS como cinto extra, não como a solução.
- **Relato específico desta lib:** *"If you are facing some issues with dragging and you are using an `<img/>` element, you also need to set `draggable={false}`"* (maiconcarraro, 05/12/2025) — https://github.com/atlassian/pragmatic-drag-and-drop/issues/204
- **Receita:** `draggable="false"` no `<a>` (obrigatório) + `-webkit-user-drag:none` (inócuo no iOS, útil no macOS). Os dois, sim.

## 2. `-webkit-touch-callout: none` basta pra matar o menu de toque-e-segure?

- MDN: *"controls the display of the default callout shown when you touch and hold a touch target"* — e o aviso: *"We do not recommend using non-standard features in production"* — https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-touch-callout
- **Não basta.** Desde o iOS 15 quebrou; workaround da thread: *"I was able to resolve it by adding `-webkit-user-select: none` to target element's parent. Now it's not selectable and callout won't show up"* — https://developer.apple.com/forums/thread/691021
- **E volta em versão nova:** thread de nov/2025 reporta iOS 26.1 com *"the context menu persists"* mesmo aplicando a propriedade com `!important`, sem workaround conhecido — https://developer.apple.com/forums/thread/808606
- **Resposta:** precisa dos dois (`-webkit-touch-callout:none` + `-webkit-user-select:none`), e nem assim há garantia no iOS 26.x.

## 3. Tamanho mínimo de alvo de toque

- **Apple HIG (Buttons):** *"As a general rule, a button needs a hit region of at least 44x44 pt — in visionOS, 60x60 pt — to ensure that people can select it easily, whether they use a fingertip, a pointer, their eyes, or a remote."* — https://developer.apple.com/design/human-interface-guidelines/buttons
- **Apple HIG (Accessibility), tabela:** *"iOS, iPadOS | Default control size 44x44 pt | Minimum control size 28x28 pt"* — https://developer.apple.com/design/human-interface-guidelines/accessibility
- **WCAG 2.5.5 Target Size (Enhanced), Nível AAA:** *"The target size is at least 44 by 44 CSS pixels except where a smaller size is essential."* — https://www.w3.org/TR/WCAG22/#target-size-enhanced
- **Régua da própria Atlassian pra alça exclusiva:** *"When the drag handle is the only part of an entity that is draggable, it's touch target size should be at least `24px x 24px`"* — https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/documentation/constellation/08-design-guidelines/index.mdx
- A alça de 24px de hoje cumpre a régua da Atlassian e **falha** na da Apple e na AAA da WCAG.

## 4. Toque-e-segure: tempo e relato de que funciona

- **Funciona, sim** (confirmado na prática pelo dono e por terceiros): *"the touch doesn't work if you try the Chrome devtools to simulate touch, but it **does** work in native devices, both Android and iOS (…) Also recommend to use the second parameter `dragHandle`"* (05/12/2025, React 19) e *"iOS works absolutely fine here"* (17/01/2026) — https://github.com/atlassian/pragmatic-drag-and-drop/issues/204
- **A lib não define tempo nenhum:** busca por `long press` / `press and hold` no repo inteiro (core + documentation) dá **zero** ocorrências. Quem define é o iOS: *"The time interval is in seconds. The default duration is `0.5` seconds."* — https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/minimumpressduration
- Reclamação recorrente e **sem API pra encurtar**: *"the default touch and hold behavior on iOS is unintuitive and clunky when using a drag handle"* — https://github.com/atlassian/pragmatic-drag-and-drop/issues/124 · e o toque-e-segure em `<img>` dispara a ação de imagem do sistema — https://github.com/atlassian/pragmatic-drag-and-drop/issues/13

## 5. Alternativas — datas conferidas no registry (não trocar, mas fica o mapa)

- `@dnd-kit/core` **6.3.1 · MIT · 2024-12-05** — congelado, confirmado — https://registry.npmjs.org/@dnd-kit/core
- `@dnd-kit/react` **0.5.0 · MIT · 2026-06-11** — a linha nova, viva · `@dnd-kit/abstract` mesma data
- `@atlaskit/pragmatic-drag-and-drop` **3.0.0 · Apache-2.0 · 2026-08-14** — ⚠️ corrige o "GPLv3" que consta em `pesquisa-sidebar-drag-reorder.md`; a fonte é o registry
- `motion` **13.1.0 · MIT · 2026-08-10** · `@formkit/drag-and-drop` **0.6.1 · MIT · 2026-06-15** · `sortablejs` **1.15.7 · MIT · 2026-02-11**
- dnd-kit é pointer-based por decisão explícita: *"Unlike most drag and drop libraries, **dnd kit** intentionally is **not** built on top of the HTML5 Drag and drop API"* e *"It does not support touch devices or using the keyboard to drag items"* — https://github.com/clauderic/dnd-kit/blob/master/README.md
- Pointer Events na mão: `setPointerCapture` — *"used to designate a specific element as the capture target of future pointer events"* — https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture

## 6. Card inteiro sem alça (a pergunta que decide)

### a) É boa prática arrastar o item inteiro quando ele também é link?

- A doc de design da **própria lib** responde o caso exato: *"An example of drag and drop as a secondary section is a menu items in a side navigation. The primary action for a menu item would be navigation, and a secondary action would be moving the menu item through drag and drop."* — e a regra pra ação secundária é *"use a drag handle icon that is visible on `:hover` or `:focus-within`"* — https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/documentation/constellation/08-design-guidelines/index.mdx
- A mesma página abre com o oposto como ponto de partida: *"As a starting position, if an entity is draggable (eg a card), then make the whole entity draggable. If the entity has other interactive parts (eg buttons, dropdowns), then just make the drag handle icon the draggable part of the entity."* — e avisa: *"making an entire entity `draggable` will prevent text selection inside that entity (platform limitation)"*
- **Separação dos três gestos é do sistema, não da lib.** Apple HIG (Gestures): *"Touch and hold — Open a contextual menu."* · *"Touch and drag — Move an object to a new location."* · *"Swipe — Reveal actions and controls; dismiss views; scroll."* · *"Avoid using a familiar gesture like tap or swipe to perform an action that's unique to your app"* — https://developer.apple.com/design/human-interface-guidelines/gestures
- Ou seja: toque curto = abre · deslize = rola · **toque-e-segure está DISPUTADO** entre "menu de contexto do link" e "arrastar". É essa colisão que produz o sintoma filmado, e ela existe com ou sem alça.

### b) Sem `dragHandle`, o que a Pragmatic faz?

- Doc do element adapter: *"A drag handle is the part of your `draggable` element that can be dragged in order to drag the whole `draggable`. **By default, the entire `draggable` acts as a drag handle.**"* — https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/documentation/constellation/05-core-package/00-adapters/00-element/about.mdx
- **Os exemplos oficiais fazem os dois:** o card do board registra `draggable({ element })` **sem** `dragHandle` (`packages/documentation/examples/pieces/board/card.tsx:254`), enquanto a coluna usa `dragHandle: headerRef.current` (`column.tsx:169`) — https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/documentation/examples/pieces/board/card.tsx
- Categoria "implied draggable" cobre cards: *"these entities do not require a drag handle icon (…) there should be a strong preference to make as much of the entity draggable as possible"* — mesma página das guidelines.
- ⚠️ **Não achei** fonte oficial afirmando que o toque curto continua navegando com o `<li>` inteiro `draggable` no iOS. A lib não intercepta `click`/`touchstart` (é HTML5 nativo puro), mas isso é inferência minha — precisa de teste no aparelho pra virar fato.

### c) `touch-action: none` é necessário com a Pragmatic?

- **Não.** Busca por `touch-action` / `touchAction` no repo inteiro (`packages/core` + `packages/documentation`, main): **zero** ocorrências. A lib nunca recomenda em lugar nenhum.
- Motivo: *"Pragmatic drag and drop is powered by the web platforms built in drag and drop functionality"* — HTML5 nativo, não Pointer Events — https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/documentation/constellation/07-web-platform-design-constraints/index.mdx
- `touch-action:none` é requisito de lib **pointer-based** (dnd-kit). MDN: *"none: Disable browser handling of all panning and zooming gestures."* — https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- Tradução prática: o `touch-action:none` de hoje é receita herdada do dnd-kit. Numa alça de 24px é inofensivo; **no `<li>` inteiro mataria a rolagem vertical da coluna à toa**.

### d) Meio-termo da comunidade

- Alça que só aparece no ponteiro (`:hover`/`:focus-within`), com o aviso literal da Atlassian: *"Keep in mind that using this approach will make it harder for users to discover that an entity is draggable"* — e ícone com espaçamento `"compact"` (`16px x 16px`) pra não deixar buraco no layout.
- Área de pegada maior que o desenho: a alça pode ficar **fora** dos limites do elemento, desde que *"Make sure your drag handle is a part of the hitbox of the containing element"* e *"Make sure your drag handle allows `pointer-events: auto`"* — mesma página das guidelines.
- ⚠️ Furo do padrão no iPhone: `:hover` não existe no toque. "Aparece no hover" = **invisível pra sempre** no celular. Pra touch, o caminho é card inteiro arrastável (implied draggable) + alça visível só quando há ponteiro.

## Veredito

1. **Vá de card inteiro** (`draggable({element: li})` sem `dragHandle`) — é o padrão dos exemplos oficiais pra card e resolve a descoberta no iPhone, onde `:hover` não existe.
2. **Tire o `touch-action:none`** — a lib é HTML5 nativo e nunca pede isso; no `<li>` inteiro ele só quebraria a rolagem da coluna.
3. **Obrigatório no `<a>`:** `draggable="false"` + `-webkit-touch-callout:none` + `-webkit-user-select:none` (o `-webkit-user-drag:none` entra só como cinto pro macOS).
4. **Alça some do visual, mas não do teclado** — mantenha o alvo acessível via `:focus-within` (a AAA da WCAG e a Apple pedem 44px; 24px não cumpre).
5. **Teste no aparelho** o único ponto sem fonte: se o toque curto no `<li>` draggable continua navegando.
