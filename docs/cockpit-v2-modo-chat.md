# Cockpit v2 — modo chat (esconder raciocínio e ferramentas)

Data: 2026-08-17 · Levantamento feito, **implementação NÃO começou**.
Este documento existe para que quem retomar não precise refazer a pesquisa.

## O pedido

O Rica quer um botão de configuração que desligue a parte "de codar" da tela: sem
"agente pensando", sem execução de ferramenta, sem resultado de comando. Sobra o que
um chat comum mostra — a mensagem dele e o texto do agente, igual ChatGPT/claude.ai.

**Custo orçado: 2 de 5.** Duas medições independentes (subagente de leitura de código +
Canário com três frentes) chegaram no mesmo número por caminhos diferentes.

## Por que é barato: o funil já existe

A lista de itens do feed é montada em dois memos, e é ali que um filtro entra:

- `apps/cockpit/app/agente/[slug]/feed-da-conversa.tsx` ~209 — ramo Claude Code
- `apps/cockpit/app/agente/[slug]/feed-da-conversa.tsx` ~366 — ramo Codex/Tara

Os dois já fazem exatamente esse tipo de trabalho hoje (injetam `linha-viva` e
`delegacao` na lista). Filtrar é a operação inversa, no mesmo lugar.

A régua de "isto é trabalho, não conversa" **já está escrita duas vezes no repo** — é só
inverter, não inventar:

- `apps/cockpit/lib/spike/conteudo-visivel.ts:18` — `temConteudoVisivel(item)`, usada em
  `lib/spike/render-items-incremental.ts:325` pra dropar item que não desenha nada
- `apps/cockpit/components/feed/grupo-ferramentas.ts:69` — `ehLinhaDeTrabalho`, com teste
  `node --test` ao lado

## ⚠️ O filtro vai na LISTA, nunca no render

Tentar filtrar dentro de `components/feed/corpo-do-item.tsx` (onde está o `switch`, e por
isso parece o lugar óbvio) quebra de duas formas:

1. O wrapper do virtualizador em `components/feed/feed.tsx:244-260` fica de pé com
   `padding: var(--ck-space-2) var(--ck-space-4)` mesmo quando o filho devolve `null` —
   sobra ~16 px de linha fantasma por item escondido.
2. `ALTURA_ITEM = 44` (`feed.tsx:69`) é a estimativa do virtualizador; centenas de itens
   de altura zero erram a conta da rolagem.

E há um detalhe que descarta filtrar por `item.kind`: o item `assistant` é **misto** —
texto, `thinking` e `tool_use` na mesma mensagem (`corpo-do-item.tsx:251-258`). O filtro é
por `parts`; o item só sai da lista quando sobra zero parte visível.

## O que cai no modo chat

`grupo-ferramentas`, chip com `classifierKind === 'tool'`, `linha-viva`, `delegacao`,
`sidechain-group`, `sidechain-cluster`, `synthetic` não-`stt`, `user-internal`,
`meta-decision`; e dentro de `assistant`, as `parts` `thinking` / `tool_use` /
`tool_result`.

Matar `Execucao` (`components/feed/execucao.tsx`) já apaga junto os 7 renderers ricos
(`status-line`, `agent-result`, `shell-output`, `file-content`, `result-list`,
`fetch-result`, `published-page`) — eles não têm call-site independente.

**Fora do feed, não some sozinho:** a barra de contexto do shell
(`components/shell/barra-de-contexto.tsx`) e a pílula de tokens vivem no chrome, não na
lista. Se o modo chat tiver que escondê-las, cada uma é um ponto de filtro a mais — é o
que empurra o custo de 2 para 3.

## Persistência — decisão tomada

Não existe tabela de preferência de usuário. O padrão da casa é coluna dedicada em
`agent_state` + endpoint por campo (foi assim com `ordem` da sidebar: `db/schema.sql:57`,
`db/store.py:714-732`, `routers/fleet.py:366-399`, `packages/cockpit-core/src/api.ts:211`).

**Recomendação:** não usar esse trilho aqui. Modo chat é preferência de LEITURA do Rica,
não estado do agente — vai em `localStorage`, global, no molde de `lib/usa-rascunho.ts:47-71`
(~30 linhas, zero backend). Ir pro banco por agente custa 5 pontos e entrega a coisa errada.

Cuidado do Next: preferência lida em `useEffect` pinta a tela uma vez antes de aplicar. O
padrão anti-flash é script inline pré-hidratação + `suppressHydrationWarning`. Aqui o risco
é pequeno (o feed já nasce vazio e preenche por SSE), mas é o ponto a observar no teste.

## Não dá pra desligar na origem

Conferido na doc oficial: o stream do Claude Code sempre carrega `thinking` e `tool_use`.
`--include-partial-messages` / `includePartialMessages` **adiciona** evento, não suprime
(code.claude.com/docs/en/cli-reference · /agent-sdk/streaming). O `thinking.display: "omitted"`
existe só na API Messages, não no CLI. Ou seja: o filtro é necessariamente no front — e é
bom que seja, porque o histórico continua inteiro no JSONL e o botão vira reversível.

## Plano de execução

1. `apps/cockpit/lib/usa-modo-chat.ts` — flag em localStorage, molde do `usa-rascunho.ts`
2. função pura `filtraModoChat(itens)` junto de `components/feed/grupo-ferramentas.ts`,
   com teste `node --test` (é o módulo que o runner alcança)
3. aplicar nos dois memos de `feed-da-conversa.tsx` (~2 linhas cada)
4. botão no painel — `components/shell/bloco-de-acoes.tsx`
5. teste no iPhone: alternar com o agente TRABALHANDO, não só parado

Zero mudança em `feed.tsx`, `corpo-do-item.tsx`, `execucao.tsx`, `linha-execucao.tsx`,
`thinking.tsx`, `linha-viva.tsx`, `delegacoes.tsx`, `cartao-compact.tsx` e nos renderers.

## Ressalva de produto

82% dos itens do feed são `tool_use` — número do próprio repo (`feed.tsx:62-68`). Escondendo
tudo, a tela fica muda por minutos enquanto o agente trabalha, e "parado" é indistinguível
de "travado". Claude.ai e ChatGPT escondem o raciocínio mas mantêm sinal de atividade e
deixam expandir. Recomendação: preservar um indicador mínimo de trabalho no modo chat.

É exatamente o buraco que a animação entre feed e composer pode preencher — ver
`docs/cockpit-v2-bonequinho.md`.
