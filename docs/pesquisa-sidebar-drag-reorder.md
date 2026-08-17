# Pesquisa: lista vertical reordenável (drag & drop) em React 19 — sidebar do cockpit

- Data: 17/08/2026 · Escopo FECHADO: comunidade (blog, GitHub, SO, fóruns) · sem Context7, sem doc oficial
- Contexto: cockpit Next.js 16.2.6 + React 19.2.6 + Tailwind 4.3 + radix-ui/vaul, App Router. Sidebar ~10 agentes, ordem fixa → arrastar linhas. PWA tela cheia no iPhone. Itens se atualizam sozinhos (polling/SSE). Exige teclado.

## Resumo executivo

- dnd-kit é o consenso da comunidade e a escolha segura; o core v2 experimental (`@dnd-kit/react`) declarou React 19 como peer dep, mas ainda tem issue aberta com StrictMode no Next.js.
- Pragmatic (Atlassian) é ativa e com teclado embutido, mas a comunidade a considera baixo-nível e GPLv3 — canhão pra sidebar de 10 itens.
- react-movable está com manutenção INATIVA (Snyk) — não usar.
- Framer Motion Reorder é ótimo pra ~10 itens e animação, mas não tem reorder por teclado e custa o bundle do motion.
- iPhone: o fix da comunidade é MouseSensor+TouchSensor com delay ~200ms, ou `touch-action:none` só no handle. Persistência: fractional-indexing é o mais robusto com o server respondendo depois.

## 1. Estado real das libs (2025-2026)

| Lib | Status | React 19 | Nota da comunidade |
|---|---|---|---|
| dnd-kit | ✅ ativa, ~17k★ / 2,8M dl-semana, "consensus pick" | ✅ peer dep React 19 no 0.0.6; ⚠️ StrictMode no Next.js em aberto | mais docs/exemplos da categoria |
| Pragmatic DnD | ✅ ativa (Atlassian: Jira/Confluence/Trello) | ✅ | comunidade menor, docs menos maduros, GPLv3, API baixo-nível |
| react-movable | ⚠️ manutenção INATIVA (1 maintainer, 0 contribuidores) | ⚠️ sem sinal de cuidado | não usar em projeto novo |
| Framer Motion Reorder | ✅ ativa (pacote `motion`) | ✅ | ótimo p/ lista simples de eixo único; sem teclado |
| HTML5 nativo | ⚠️ | — | não é touch-friendly; Pragmatic é quem faz o "wrap" do HTML5 DnD |

- dnd-kit: pkgpulse (2026) chama de "the community consensus pick for React drag-and-drop since 2022" — https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026
- React 19: release `@dnd-kit/react@0.0.6` corrigiu lockup de StrictMode e adicionou React 19 aos peer deps — https://newreleases.io/project/github/clauderic/dnd-kit/release/@dnd-kit%2Freact@0.0.6
- Porém issue #1436: `componentWillUnmount` chamado 2x no Next.js+StrictMode; mantenedor sugere `reactStrictMode:false` temporário — https://github.com/clauderic/dnd-kit/issues/1436
- Comunidade reclama: dnd-kit "re-renders all components when moving/dragging an item" — https://nextjs-forum.com/post/1332474241676738622
- Pragmatic: "better for thousands-of-items scenarios", mas "requires you to build animation and collision logic yourself", licença GPLv3 — https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026 ; também citado em https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react
- react-movable: Snyk marca "Maintenance: INACTIVE", 1 maintainer, 0 contributors; releases ainda saem (3.4.1 fev/2025) mas sem atividade real — https://security.snyk.io/package/npm/react-movable
- Framer Reorder: single-axis, sem multi-coluna e sem arrasto em container scrollável avançado; docs da própria Motion recomendam DnD Kit para casos avançados; não há reorder por teclado embutido — https://deepwiki.com/motiondivision/motion/5.4-reorder-component

## 2. Armadilhas relatadas

**(a) Touch no iPhone — scroll brigando com o arrasto.** PointerSensor exige `touch-action:none`, mas aplicar no item todo quebra o scroll da página; sem isso, rolar dispara drag acidental. O fix votado no SO é tirar o PointerSensor e usar MouseSensor+TouchSensor: o TouchSensor usa `preventDefault()` no touchmove só durante o arrasto, preservando o scroll — com delay de ~200ms (press-and-hold) — https://stackoverflow.com/posts/75831359/revisions . No `@dnd-kit/react` v2 não existe TouchSensor separado: users reportam "cards sometimes get stuck… move even though the finger hasn't been released yet" com o PointerSensor default — https://github.com/clauderic/dnd-kit/issues/1723

**(b) Virtualização.** Irrelevante para ~10 itens. As libs suportam (dnd-kit e Reorder), mas é peso que não se paga nesse caso.

**(c) Item que se atualiza por polling/SSE no meio do arrasto.** Se a lista re-renderiza e o item arrastado muda de identidade/props, o drag morre ou salta — e a comunidade já acusa o dnd-kit de "re-render all components" ao arrastar — https://nextjs-forum.com/post/1332474241676738622 . Mitigação: `React.memo` nos itens, estabilizar o item ativo e atualizar o estado em `onDragOver` (via `move()`) para o React controlar a ordem em vez de deixar o plugin otimista mexer no DOM — https://github.com/clauderic/dnd-kit/issues/1434

**(d) Acessibilidade por teclado.** dnd-kit tem KeyboardSensor + `sortableKeyboardCoordinates` + live region (tecla Space/Enter para pegar, setas para mover) — https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react ; Pragmatic tem ARIA/teclado embutidos — https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026 ; Framer Reorder **não** tem reorder por teclado — https://deepwiki.com/motiondivision/motion/5.4-reorder-component

## ❌ Anti-padrões

- ❌ `touch-action:none` no item/card inteiro — mata o scroll da página no iPhone; restringir ao handle — https://stackoverflow.com/posts/75831359/revisions
- ❌ Confiar no rollback automático do plugin otimista do dnd-kit: reverter depois do `dragend` é buggy e causa o "jump back" — https://github.com/clauderic/dnd-kit/issues/1769
- ❌ Adotar react-movable em projeto novo com React 19 (manutenção inativa) — https://security.snyk.io/package/npm/react-movable
- ❌ Usar PointerSensor puro no mobile sem delay nem handle — https://github.com/clauderic/dnd-kit/issues/1723

## 3. Persistência da ordem

- **Inteiro sequencial**: mover 1 item reescreve vários índices (O(N) por reordenação). Suficiente para ~10 itens single-user, mas em gravação concorrente "tend to create collisions" — https://dev.to/sonim1/fractional-indexing-implementing-drag-and-drop-ordering-and-avoiding-index-collisions-g3
- **Fractional indexing** (`generateKeyBetween(a,b)`): insere entre "a1" e "a2" gerando "a1V" **sem tocar nas outras linhas** (O(1)), `ORDER BY` lexicográfico funciona, ideal quando o server responde depois e há concorrência (vários clientes reordenando). Custo: chave cresce e precisa rebalanceamento periódico — https://dev.to/sonim1/fractional-indexing-implementing-drag-and-drop-ordering-and-avoiding-index-collisions-g3
- Veredito da fonte: "frequent reordering or multiple users → fractional-indexing é o default prático; single-user simples → gap strategy com inteiros basta" — https://dev.to/sonim1/fractional-indexing-implementing-drag-and-drop-ordering-and-avoiding-index-collisions-g3

## 4. Optimistic update (evitar o "pular de volta")

- Padrão recomendado na comunidade dnd-kit: **snapshot da lista em `onDragStart`** (ref), atualizar a ordem em `onDragOver` com `move()`, persistir em `onDragEnd`; se o server falhar, **restaurar o snapshot** — https://github.com/clauderic/dnd-kit/issues/1769
- A API experimental `event.suspend()`/`resume()`/`abort()` existe para segurar o drag até o server responder, mas "abort did not behave as expected" — https://github.com/clauderic/dnd-kit/issues/1769
- Reverter o plugin otimista default (que mexe no DOM) teve bugs e PRs de correção; o caminho suportado é atualizar estado em `onDragOver` e não depender do plugin pra rollback — https://github.com/clauderic/dnd-kit/issues/1434

## 5. Recomendação (veredito)

- **Lib: dnd-kit** (core v1 estável — `@dnd-kit/core` + `@dnd-kit/sortable`), não o `@dnd-kit/react` v2 experimental (issue de StrictMode no Next.js em aberto). Consenso da comunidade, teclado de graça, docs/exemplos abundantes — https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026 . Pragmatic é canhão (GPLv3, baixo-nível) e Framer Reorder falha no requisito de teclado — https://deepwiki.com/motiondivision/motion/5.4-reorder-component
- **Sensor pro iPhone: MouseSensor + TouchSensor** com delay ~200ms + **handle de arrasto** (grip) com `touch-action:none` só no handle; preserva scroll da página e distingue rolar de arrastar — https://stackoverflow.com/posts/75831359/revisions
- **Persistência: fractional-indexing** (`fractional-indexing` npm, `generateKeyBetween`). O(1), sem cascata de UPDATE e reconcilia bem quando o server responde depois — o requisito "server responde depois + optimistic" é exatamente o caso em que inteiro sequencial dói (collisions em gravação concorrente). Para 10 itens o rebalanceamento é evento raro — https://dev.to/sonim1/fractional-indexing-implementing-drag-and-drop-ordering-and-avoiding-index-collisions-g3
- **Optimistic update**: snapshot em `onDragStart`, reordenar em `onDragOver` (React controla a ordem), persistir em `onDragEnd`; em erro, restaurar snapshot. Não usar o rollback do plugin otimista default — https://github.com/clauderic/dnd-kit/issues/1769

## Aplicação (cockpit)

Sidebar de ~10 agentes, arrasto vertical no iPhone PWA com itens que mudam sozinhos (polling/SSE). A combinação dnd-kit + TouchSensor/MouseSensor com handle + fractional-indexing + snapshot/rollback cobre os quatro riscos mapeados: scroll no iPhone (handle com `touch-action:none`), re-render no meio do arrasto (`React.memo` + estado controlado em `onDragOver`), concorrência de gravação (fractional) e "jump back" (snapshot). Item com atualização própria deve ficar `memo`izado e o item arrastado não pode mudar de `key` durante o drag.

**Fontes (12):** [pkgpulse 2026](https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026) · [Puck top-5](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) · [nextjs-forum](https://nextjs-forum.com/post/1332474241676738622) · [Snyk react-movable](https://security.snyk.io/package/npm/react-movable) · [dnd-kit #1436](https://github.com/clauderic/dnd-kit/issues/1436) · [@dnd-kit/react 0.0.6](https://newreleases.io/project/github/clauderic/dnd-kit/release/@dnd-kit%2Freact@0.0.6) · [dnd-kit #1723](https://github.com/clauderic/dnd-kit/issues/1723) · [SO mobile scroll](https://stackoverflow.com/posts/75831359/revisions) · [dnd-kit #1434](https://github.com/clauderic/dnd-kit/issues/1434) · [dnd-kit #1769](https://github.com/clauderic/dnd-kit/issues/1769) · [dev.to fractional-indexing](https://dev.to/sonim1/fractional-indexing-implementing-drag-and-drop-ordering-and-avoiding-index-collisions-g3) · [DeepWiki Motion Reorder](https://deepwiki.com/motiondivision/motion/5.4-reorder-component)
