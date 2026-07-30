# Auditoria de tema + cauda longa da matriz — 30/07 (Hiro)

> Auditoria pedida pelo Daniel. **RELATO, não correção** — não editei nada em
> `apps/cockpit/`. Achado sem certeza está marcado como SUSPEITA.
>
> Estado do trabalho: **EM ANDAMENTO** (regravação incremental — turno anterior
> morreu em 429 segurando relato em memória; agora cada achado entra no disco na
> hora).

## Fila de verificação — o que falta olhar

Parte 1 (cor fora do tema):
- [x] varredura mecânica: hex, rgb(), rgba(), oklch(), hsl(), oklab(), lab(), lch() fora do `globals.css`
- [x] classes utilitárias de cor fixa do Tailwind (bg-red-500, text-white, ...) — varredura mecânica
- [x] valores arbitrários de cor (`bg-[#...]`, `text-[oklch(...)]`)
- [x] fill/stroke de SVG ≠ currentColor
- [x] `components/ui/badge.tsx` — `text-white` histórico já podado em 30/07 (limpo)
- [x] `linha-execucao.tsx:64` — record `COR` inteiro: os 4 valores são `var(--ck-*)`. LIMPO.
- [x] `marca.cor` do `retrato.tsx` — vem de `components/shell/estado.ts:27-30`, os 4 estados usam `var(--ck-*)`. LIMPO.
- [x] `code-block.tsx`, `thinking.tsx` — só `var(--ck-*)` em arbitrary values e classes `ck-*`. LIMPO.
- [x] `components/shell/` restantes — varredura de style multilinha: só `var(--ck-*)`, `currentColor` (tropa.tsx:55, herda do pai — correto), `transparent`. LIMPO.
- [x] `app/` restantes (gramatica, voz, not-found, agente/[slug]) — style multilinha conferido: LIMPO.
- [x] `components/feed/` (dir novo do Daniel, em construção) — zero cor declarada fora de token. LIMPO.
- [x] nomes de cor CSS em strings ('white', 'black', 'red', ...) — zero.
- [x] `app/spike/sem-lib/` — varredura mecânica limpa (auto-auditoria, ceticismo aplicado: conferi os style multilinha um a um).

Parte 2 (cauda longa da matriz):
- [ ] ler `docs/cockpit-v2-matriz-renderers.md` inteiro
- [ ] cruzar famílias previstas × renderers/testes existentes

## Parte 1 — cor fora do tema

### Achados confirmados

**A1. `app/layout.tsx:13` — `themeColor: '#191919'` (hex cru)**

Único hex literal fora do `globals.css` em toda a árvore (varredura de
`#[0-9a-fA-F]{3,8}` em .tsx/.ts/.css). O valor bate byte a byte com o
`--ck-surface-canvas` (`oklch(0.215 0 0)` = `#191919`).

Nuance: `themeColor` é o meta `theme-color` do navegador (barra de status do
Android/Safari) — é export de metadata do Next, **não aceita `var(--ck-*)`**, o
navegador lê antes do CSS. Não existe token para apontar; o problema é a
DUPLICAÇÃO silenciosa: se a §A mexer no canvas, esta linha fica velha sem
ninguém notar. Classifico como **achado estrutural, não violação de estilo** —
a correção possível é um comentário apontando pro token, não uma troca de valor.

**A2. `components/ui/badge.tsx` — LIMPO (registrando porque era o suspeito nº 1)**

O comentário do próprio arquivo (linhas 7–14) documenta a poda de 30/07: os
variants do template shadcn que carregavam `text-white` literal e tokens
inexistentes (primary, destructive, accent, ring) foram removidos. Resta só o
`ghost` sem cor. Confirmado: nenhuma cor no arquivo.

### Varreduras que voltaram LIMPAS (registrado pra ninguém refazer)

- rgb(), rgba(), oklch(), hsl(), oklab(), lab(), lch() fora do `globals.css`: **zero ocorrências**.
- Classes de cor fixa do Tailwind (`bg|text|border|ring|outline|fill|stroke|from|to|via|shadow|decoration|caret|accent|divide|placeholder` + cor nomeada): **zero ocorrências em código** (único hit foi o comentário histórico do badge.tsx).
- Valores arbitrários de cor (`bg-[#...]`, `text-[oklch...]`): **zero**. Os únicos `-[` encontrados são tamanho (`text-[13px]`, `leading-[1.55]`, `ring-[3px]`), não cor.
- fill/stroke de SVG: só `fill="none"` (linha-execucao.tsx:100, icones.tsx:26) e `currentColor`. Limpo.
- `color-mix` fora do globals.css: **zero**.
- boxShadow/drop-shadow/textShadow sem token: **zero**.
- `style` inline: TODOS usam `var(--ck-*)` — conferidos app/page.tsx, app/spike/page.tsx, app/envio/page.tsx, app/agente/[slug]/page.tsx, linha-execucao.tsx. Limpo.

### Suspeitas em aberto (a verificar)

- `linha-execucao.tsx:64` — `const COR: Record<Desfecho, string>` — grep não mostrou os valores. Se forem `var(--ck-*)`, limpo.
- `retrato.tsx:82` — `background: marca.cor` — a cor chega de fora (quem monta `marca`). Verificar o emissor em `tropa.tsx`.

## Parte 2 — cauda longa da matriz de renderers

Fonte: `docs/cockpit-v2-matriz-renderers.md` (52 famílias → 16 componentes
propostos). Cruzado contra `apps/cockpit/components/renderers/` +
`components/feed/` em 30/07.

### O que JÁ existe (não é cauda)

- `assistant-text` → `markdown.tsx` cobre (nome diverge, função é a mesma) + `lib/markdown.test.ts`
- `thinking-block` → `thinking.tsx` + `lib/thinking.test.ts`
- `user-bubble` → `Fala` em `feed/corpo-do-item.tsx:127-132` (texto literal, nunca markdown — casa com a proposta)
- `tool-chip` (invólucro) → `linha-execucao.tsx` + `gramatica.test.ts`
- G2 "edit" → `diff-viewer.tsx` + `diff-lines.test.ts` (ver ressalva do sub-formato "create" abaixo)

### Famílias SEM renderer e SEM teste hoje

Ordenadas por prioridade da própria matriz (P0 ≥ 100 · P1 10–99 · P2 < 10).

**1. G6 `fetch-result.tsx` — P0, 255 tool + 245 result.** Família
`result__bytes_code_codeText_durationMs_result` (245). A matriz pede cabeçalho
com status HTTP + bytes + duração e corpo markdown. Hoje um WebFetch expandido
cai no `Saida` genérico do `linha-execucao.tsx` — texto plano, sem o cabeçalho.
É a segunda lacuna mais quente da matriz (500 eventos) e está na onda 2.

**2. G3 `result-list.tsx` — P0 na variante WebSearch.** Famílias:
`…_durationSeconds_query_results_searchCount` (165), `…_matches_query_total_deferred_tools` (31),
`…_method_paths` (1), `…_method_projects` (1), `…_tasks` (1). Matriz pede um
corpo de lista com 3 variantes de linha (link, caminho, objeto nomeado). Hoje
WebSearch/ToolSearch expandidos caem no `Saida` genérico. 171 tool + 165 result
só na variante links — onda 2.

**3. G5 `file-content.tsx` — P1, 83 tool + 85 result.** Famílias
`result__file_type` (82) e `…_content_contentType_isBase64_method_path` (3).
Existe `code-block.tsx`, mas ele é genérico do markdown: sem o cabeçalho com
caminho + número de linhas que a matriz pede. Um `Read` expandido hoje é `Saida`
genérica. Onda 3. Classifico como lacuna de FORMA, não de existência — o
substrato (`code-block`) já está lá.

**4. G2 sub-formato "create" — P1, 33 result + 40 tool Write.** O
`linha-execucao.tsx:377-382` só monta `DiffViewer` quando `args.old_string` e
`args.new_string` existem (caminho Edit). Um `Write` (arquivo novo inteiro,
`type: 'create'`, patch vazio) **não tem `old_string`** — cai no `Saida`
genérico com o conteúdo inteiro do arquivo como texto plano. A família
`result__content_filePath_originalFile_structuredPatch_type` (33) não tem
renderização de diff hoje. Onda 3.

**5. G1 aditivos do shell — P1/P2, 21 result.** O `Saida` cobre o núcleo
(stdout/stderr/truncagem), mas os quatro aditivos da matriz não têm render:
`backgroundTaskId` badge (12), `persistedOutputPath`+`persistedOutputSize`
rodapé (5), `gitOperation` badge (3), `returnCodeInterpretation` linha de
status (1). Onda 2 junto com o shell-output.

**6. G7 `agent-result.tsx` — P1, 19 tool + 19 result.** Famílias
`…_canReadOutputFile_description_isAsync_outputFile` (17) e
`…_agentType_content_prompt_resolvedModel` (2). Hoje `tool__Agent` vira chip
genérico e o sidechain vira `LinhaSeca "& subagente · N passos"`
(`corpo-do-item.tsx:155-168`) — placeholder que descarta todo o conteúdo do
subagente. A matriz pede os dois estados (síncrono concluído / assíncrono
lançado). Onda 4.

**7. G4 `status-line.tsx` — P2, 14 result.** Famílias `…_commandName_success` (6),
`…_message_pin_success` (4), `…_message_pin_resumedAgentId_success` (3),
`…_message_success` (1). ⚠️ Nome colide: existe `components/shell/statusline.tsx`,
mas é a barra de contexto do agente — NÃO é este componente. Corpo de result
`success`+texto curto não existe. Onda 4 (absorvido pelo `skill-chip` na
proposta da matriz).

**8. `skill-chip.tsx` — P2, 6 tool + 6 result.** Hoje um chip com
`classifierKind: 'skill'` cai no ramo genérico de `corpo-do-item.tsx:146-148`
(`LinhaSeca` com label+summary). Funciona, mas sem a forma própria que a matriz
pede (kind próprio cc:198-212, consome a mensagem seguinte). Onda 4.

**9. `attachment-chip.tsx` — P1, 27 tool.** A própria matriz (seção 5)
absorve na onda 1 como chip genérico com `file_id` no summary e adia a
promoção a componente. Registro como cauda consciente, não como lacuna
acidental.

**10. `sidechain-group.tsx` / `sidechain-cluster.tsx` — componentes de feed.**
Hoje são `LinhaSeca` de uma linha (item 6 acima). A matriz os lista na onda 1
como componentes do feed. O placeholder existe e não quebra; a forma rica
(expandir os passos do subagente) não.

### Ressalva estrutural (a mais importante do relato)

A seção 3.3 da própria matriz já aponta, e eu confirmei no código: **o
`tool_use_result` rico é descartado antes de chegar à tela**
(`render-items.ts:319-332` só lê chaves de subagente pro painel de status).
O feed consome `ToolResultLookup` (a string do `content` do `tool_result`),
não o payload rico. Consequência: **nenhum dos corpos G1–G8 pode ser
construído como especificado sem antes o pipeline passar a carregar o
`tool_use_result` nos itens**. Os aditivos do item 5 (`backgroundTaskId`,
`persistedOutputPath`...) e o cabeçalho HTTP do item 1 (`code`, `bytes`,
`durationMs`) literalmente não chegam ao componente hoje. Isso é pré-requisito
de onda, não detalhe de renderer.

### Resumo da cauda

- Lacunas P0 (quentes, onda 2): **fetch-result (500 eventos)** e **result-list/WebSearch (336)**.
- Lacunas P1: file-content (forma), G2-create, G1-aditivos, agent-result, attachment (consciente).
- Lacunas P2: status-line, skill-chip, published-page (3+3, onda 4 — nem listei em detalhe: família `result__liveSubscription_path_title_updated_url`, card título+link+versão, sem renderer nem teste hoje).
- Pré-requisito transversal: pipeline precisa entregar `tool_use_result` aos itens antes das ondas 2–4.

## Veredito final

- **Parte 1 (tema): LIMPA.** Um único hex fora do `globals.css`
  (`layout.tsx:13` themeColor, sem como tokenizar — duplicação a documentar,
  não violação). Todo o resto da árvore, incluindo o `components/feed/` novo,
  fala `var(--ck-*)` ou `currentColor`.
- **Parte 2 (matriz):** 10 lacunas mapeadas, 2 delas P0. A mais profunda não é
  um componente faltando — é o payload rico não chegar à tela.
