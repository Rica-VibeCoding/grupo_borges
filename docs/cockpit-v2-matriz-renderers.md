# MATRIZ RENDERERS — payload do Claude Code → componente, Cockpit v2

> Levantamento do que o classificador atual **já faz**, família por família, com
> proposta de componente destino em `apps/cockpit/components/render/**`.
> Fontes: `fixtures/cockpit-v2/familias/*.json` (52 famílias, contagens em
> `_indice.json`), `packages/cockpit-core/src/render-items.ts` e
> `packages/cockpit-core/src/chat-payload-classifier.ts`.
> Escrito em 2026-07-30. Nenhuma família fora das fixtures entrou aqui.

**Abreviações de referência** (tudo em `packages/cockpit-core/src/`):

- `cc:NN` = `chat-payload-classifier.ts`, linha NN
- `ri:NN` = `render-items.ts`, linha NN

**O mecanismo em um parágrafo** (para ler a matriz): o classificador **não
olha o nome da tool** (única exceção: `Skill`, cc:198). Um `tool_use` vira
`RenderItem` `chip` com `classifierKind: 'tool'` **somente se a mensagem
seguinte tiver o `tool_result` correspondente com corpo > 300 caracteres**
(cc:215-230, gate em cc:217); caso contrário cai em `plain` (cc:233) e o
evento assistant é emitido como `kind: 'assistant'` com as parts cruas
(ri:456-465). A mensagem user que carrega só `tool_result` **nunca vira item
próprio** — é suprimida (ri:421-425) e seu texto entra no chip da tool
anterior (cc:216, cc:283-299) ou no `ToolResultLookup` (ri:152-165). O campo
rico `tool_use_result` (as 24 formas `result__*`) **não é lido para
renderização** — só `deriveSubagentStatusesFromMessages` lê `agentId`,
`agentType`, `status`, `prompt`, totais de token/duração (ri:319-332,
ri:252-281).

**Arquitetura proposta** (consequência do parágrafo acima): 1 invólucro de
chip (`tool-chip.tsx`, linha única expansível — o "cavalo de batalha" do
contrato) + N **corpos de resultado** que o chip hospeda quando expandido
(seção 2) + renderers de bloco (prosa, thinking, balões). Tool chips
especializados (`bash-chip` etc.) são variações de **summary** do invólucro,
não componentes novos — salvo quando a seção 1 disser o contrário.

**Prioridade** derivada só da frequência: **P0 ≥ 100 ocorrências ·
P1 = 10–99 · P2 < 10**. † = obrigatória por contrato independente da
frequência (seção 4).

---

## Seção 1 — a matriz (52 famílias)

### 1a. Blocos (`bloco__*`, 3)

| Família | Ocorr | Kind hoje (ref) | Componente proposto | P |
|---|---|---|---|---|
| `bloco__text` | 330 | `assistant` (cc:233 → ri:456-465) | `assistant-text.tsx` | P0 |
| `bloco__thinking` | 804 | `assistant` (cc:233 → ri:456-465)¹ | `thinking-block.tsx` | P0 |
| `bloco__tool_result` | 1499 | nenhum — suprimido (ri:421-425) | — (alimenta `tool-chip.tsx`) | P0 |

¹ Thinking chega como part dentro de `parts` do item `assistant`. O chip kind
`'thinking'` existe no tipo (`one-line-chip-types.ts:8`) mas **nenhum caminho
do `buildRenderItems` o emite** — ver seção 3.

Forma visual e campos:

- `bloco__text` — prosa markdown do agente. Lê `message.content[].text`
  (filtra `type==='text'`).
- `bloco__thinking` — bloco colapsado "pensou…", corpo monoespaçado. Lê
  `message.content[].thinking` (no fixture o campo veio vazio e só
  `signature` tinha conteúdo — renderer tem de tolerar thinking vazio).
- `bloco__tool_result` — sem forma própria: o evento some e seu
  `content[].content` (string ou parts) vira `expandBody`/summary do chip da
  tool que o originou; `is_error` vira `tone: 'error'` (cc:227).

### 1b. Bordas (`borda__*`, 2) — detalhe na seção 4

| Família | Ocorr | Kind hoje (ref) | Componente proposto | P |
|---|---|---|---|---|
| `borda__content_none` | 199 | `suppress` (cc:93-95) | nenhum (feed pula o evento) | P0 † |
| `borda__content_string` | 87 | `user` (cc:233 → ri:448-452)² | `user-bubble.tsx` | P1 † |

² Normalização em `extractContentParts`/`textOf` (ri:53-66, cc:245-256) faz a
string virar part `text`; se o texto casar envelope `<channel>` vira
`channel` (ri:444-447) e se houver `meta.kind` vira `synthetic` (ri:430-438).

### 1c. Tools (`tool__*`, 23)

Kind hoje para **todas** exceto `Skill`: `chip` com `classifierKind 'tool'`
**se o result tiver > 300 chars** (cc:215-230), senão `assistant` com part
`tool_use` crua (cc:233 → ri:464). Não há branch por nome de tool — ver
seção 3.

| Família | Ocorr | Componente proposto | P |
|---|---|---|---|
| `tool__Bash` | 738 | `tool-chip.tsx` + corpo `shell-output.tsx` | P0 |
| `tool__WebFetch` | 255 | `tool-chip.tsx` + corpo `fetch-result.tsx` | P0 |
| `tool__WebSearch` | 171 | `tool-chip.tsx` + corpo `result-list.tsx` | P0 |
| `tool__Read` | 83 | `tool-chip.tsx` + corpo `file-content.tsx` | P1 |
| `tool__Write` | 40 | `tool-chip.tsx` + corpo `diff-patch.tsx` | P1 |
| `tool__Edit` | 37 | `tool-chip.tsx` + corpo `diff-patch.tsx` | P1 |
| `tool__ToolSearch` | 31 | `tool-chip.tsx` + corpo `result-list.tsx` | P1 |
| `tool__mcp__plugin_telegram_telegram__download_attachment` | 27 | `attachment-chip.tsx` | P1 |
| `tool__mcp__supabase_geral__execute_sql` | 50 | `tool-chip.tsx` (summary SQL; corpo genérico)³ | P1 |
| `tool__Agent` | 19 | `tool-chip.tsx` + corpo `agent-result.tsx`⁴ | P1 |
| `tool__mcp__plugin_telegram_telegram__reply` | 15 | `tool-chip.tsx` (summary = destinatário+texto) | P1 |
| `tool__SendMessage` | 8 | `tool-chip.tsx` (summary = `to`+`summary`) | P2 |
| `tool__Skill` | 6 | `skill-chip.tsx` (kind próprio, cc:198-212) | P2 |
| `tool__DesignSync` | 6 | `tool-chip.tsx` (summary = `method`) | P2 |
| `tool__Artifact` | 3 | `tool-chip.tsx` + corpo `published-page.tsx` | P2 |
| `tool__mcp__shadcn__search_items_in_registries` | 4 | `tool-chip.tsx` genérico | P2 |
| `tool__TaskList` | 1 | `tool-chip.tsx` genérico | P2 |
| `tool__TaskStop` | 1 | `tool-chip.tsx` genérico | P2 |
| `tool__mcp__shadcn__get_project_registries` | 1 | `tool-chip.tsx` genérico | P2 |
| `tool__mcp__shadcn__list_items_in_registries` | 1 | `tool-chip.tsx` genérico | P2 |
| `tool__mcp__shadcn__view_items_in_registries` | 1 | `tool-chip.tsx` genérico | P2 |
| `tool__mcp__supabase_geral__list_migrations` | 1 | `tool-chip.tsx` genérico | P2 |
| `tool__mcp__supabase_geral__list_tables` | 1 | `tool-chip.tsx` genérico | P2 |

³ Result MCP chega como texto no `content` do part (não há família `result__*`
específica para MCP nas fixtures) — sem renderer rico nesta rodada.
⁴ O `tool_use` do Agent vira chip; as mensagens do subagente viram
`sidechain-group` (ri:362-381) e runs consecutivos viram `sidechain-cluster`
(ri:495-528) — componentes `sidechain-group.tsx`/`sidechain-cluster.tsx` são
do feed, não desta família.

Campos do input que cada summary lê (todos vistos nas fixtures):
`Bash: command, description` · `WebFetch: url, prompt` · `WebSearch: query` ·
`Read: file_path` · `Write: file_path, content` ·
`Edit: file_path, old_string, new_string, replace_all` ·
`ToolSearch: query, max_results` · `download_attachment: file_id` ·
`execute_sql: query` · `Agent: description, subagent_type, prompt` ·
`reply: chat_id, format, text` · `SendMessage: to, summary, message` ·
`Skill: skill` · `DesignSync: method` · `Artifact: file_path, title` ·
`TaskStop: task_id` · shadcn: `query/registries/items/limit` ·
`list_tables: schemas`. Nome MCP no chip passa por `prettifyToolName`
(`tool-name.ts:13-26`): `mcp__plugin_telegram_telegram__reply` →
`telegram.reply`.

### 1d. Results (`result__*`, 24)

Kind hoje para **todas as 24**: nenhum item próprio. O evento user que
carrega só `tool_result` é suprimido (ri:421-425); o texto do part alimenta
o chip da tool anterior se > 300 chars (cc:215-230). O `tool_use_result`
rico só é lido por `deriveSubagentStatusesFromMessages` (ri:319-332) — e só
as chaves de subagente. Ou seja: **o kind de RenderItem produzido hoje é
"parte do chip anterior", e o payload rico é descartado**. A consolidação
visual destas 24 formas é a seção 2.

| Família | Ocorr | Corpo proposto | P |
|---|---|---|---|
| `result__interrupted_isImage_noOutputExpected_stderr_stdout` | 679 | `shell-output.tsx` | P0 |
| `result__bytes_code_codeText_durationMs_result` | 245 | `fetch-result.tsx` | P0 |
| `result__durationSeconds_query_results_searchCount` | 165 | `result-list.tsx` | P0 |
| `result__file_type` | 82 | `file-content.tsx` | P1 |
| `result__filePath_newString_oldString_originalFile_replaceAll` | 35 | `diff-patch.tsx` | P1 |
| `result__content_filePath_originalFile_structuredPatch_type` | 33 | `diff-patch.tsx` | P1 |
| `result__matches_query_total_deferred_tools` | 31 | `result-list.tsx` | P1 |
| `result__agentId_canReadOutputFile_description_isAsync_outputFile` | 17 | `agent-result.tsx` | P1 |
| `result__backgroundTaskId_interrupted_isImage_noOutputExpected_stderr` | 12 | `shell-output.tsx` | P1 |
| `result__content_filePath_memdirStamped_originalFile_structuredPatch` | 7 | `diff-patch.tsx` | P2 |
| `result__commandName_success` | 6 | `status-line.tsx` | P2 |
| `result__interrupted_isImage_noOutputExpected_persistedOutputPath_persistedOutputSize` | 5 | `shell-output.tsx` | P2 |
| `result__message_pin_success` | 4 | `status-line.tsx` | P2 |
| `result__content_contentType_isBase64_method_path` | 3 | `file-content.tsx` | P2 |
| `result__gitOperation_interrupted_isImage_noOutputExpected_stderr` | 3 | `shell-output.tsx` | P2 |
| `result__liveSubscription_path_title_updated_url` | 3 | `published-page.tsx` | P2 |
| `result__message_pin_resumedAgentId_success` | 3 | `status-line.tsx` | P2 |
| `result__agentId_agentType_content_prompt_resolvedModel` | 2 | `agent-result.tsx` | P2 |
| `result__filePath_memdirStamped_newString_oldString_originalFile` | 2 | `diff-patch.tsx` | P2 |
| `result__interrupted_isImage_noOutputExpected_returnCodeInterpretation_stderr` | 1 | `shell-output.tsx` | P2 |
| `result__message_success` | 1 | `status-line.tsx` | P2 |
| `result__method_paths` | 1 | `result-list.tsx` | P2 |
| `result__method_projects` | 1 | `result-list.tsx` | P2 |
| `result__tasks` | 1 | `result-list.tsx` | P2 |

Campos que cada corpo lê: ver seção 2 (justificativa por chaves).

**Cobertura: 52/52 famílias** na matriz (3 bloco + 2 borda + 23 tool + 24
result). Nenhuma ficou "não determinado".

---

## Seção 2 — as 24 formas de `result__*` viram 8 corpos

Critério: agrupo pelas **chaves presentes no `tool_use_result`** (não pela
intuição). Famílias no mesmo grupo têm o mesmo conjunto de chaves centrais;
as chaves que diferem dentro do grupo são flags/aditivos que cabem no mesmo
visual.

**G1 — Saída de shell → `shell-output.tsx`** (5 famílias, 700 ocorr.)
Núcleo comum: `stdout`, `stderr`, `interrupted`, `isImage`,
`noOutputExpected`. Aditivos que não mudam a forma:
`backgroundTaskId` (badge "rodando em background"), `gitOperation`
(badge do branch/push), `persistedOutputPath`+`persistedOutputSize`
(rodapé "saída completa em arquivo", stdout truncado),
`returnCodeInterpretation` (linha de status quando stdout/stderr vazios).
Famílias: `…_stderr_stdout` (679), `…_backgroundTaskId_…` (12),
`…_persistedOutputPath_…` (5), `…_gitOperation_…` (3),
`…_returnCodeInterpretation_…` (1).
⚠️ `isImage: true` não aparece em nenhuma fixture (todas `false`) — o corpo
deve ter o ramo imagem, mas **não há família gravada com `true`**; quando
aparecer em produção, gravar a fixture antes de escrever o ramo (regra do
contrato, `docs/cockpit-v2-data-contract.md` seção 5).
Silêncio (`noOutputExpected: true` ou stdout+stderr vazios) = chip sem
expansão.

**G2 — Patch/diff → `diff-patch.tsx`** (4 famílias, 77 ocorr.)
Núcleo comum: `filePath` + `structuredPatch` + `originalFile` +
`userModified`. As 4 se dividem em dois sub-formatos pelas chaves:
"create" (`type: 'create'` + `content`, patch vazio = arquivo novo inteiro)
e "edit" (`oldString`/`newString`/`replaceAll`, patch com hunks).
`memdirStamped` é flag de badge, não muda a forma. O `structuredPatch`
traz `oldStart/oldLines/newStart/newLines/lines` — diff pronto, sem
recomputar.
Famílias: `…_originalFile_structuredPatch_type` (33),
`…_newString_oldString_originalFile_replaceAll` (35),
`…_memdirStamped_originalFile_structuredPatch` (7),
`…_memdirStamped_newString_oldString_originalFile` (2).

**G3 — Lista de itens → `result-list.tsx`** (5 famílias, 199 ocorr.)
Núcleo comum: **uma chave-array homogênea + metadados de contagem/query**:
`results`+`searchCount`+`query` (WebSearch, itens com `title`/`url`),
`matches`+`total_deferred_tools`+`query` (ToolSearch, itens string),
`paths`+`method` (strings), `projects`+`method` (objetos nome/id),
`tasks` (array, vazio no fixture). Um corpo de lista com 3 variantes de
linha (link, caminho, objeto nomeado) cobre as 5.
Famílias: `…_durationSeconds_query_results_searchCount` (165),
`…_matches_query_total_deferred_tools` (31), `…_method_paths` (1),
`…_method_projects` (1), `…_tasks` (1).

**G4 — Linha de status → `status-line.tsx`** (4 famílias, 14 ocorr.)
Núcleo comum: `success` + texto curto (`message` ou `commandName`).
Aditivos `pin` e `resumedAgentId` são badge de destino. `success: false`
(existe na fixture `message_success`) → tone error.
Famílias: `…_commandName_success` (6), `…_message_pin_success` (4),
`…_message_pin_resumedAgentId_success` (3), `…_message_success` (1).

**G5 — Conteúdo de arquivo → `file-content.tsx`** (2 famílias, 85 ocorr.)
Núcleo comum: caminho + **conteúdo textual integral**: `file.filePath` +
`file.content` + `numLines`/`totalLines` (Read) e `path` + `content` +
`contentType` (DesignSync `get_file`). Forma: code block com cabeçalho
(caminho, nº de linhas). `isBase64: true` não aparece nas fixtures
(ambas `false`) — mesmo caso do `isImage`: ramo previsto, fixture pendente.
Famílias: `…_file_type` (82), `…_content_contentType_isBase64_method_path` (3).

**G6 — Resultado de fetch → `fetch-result.tsx`** (1 família, 245 ocorr.)
Chaves: `url`, `code`, `codeText`, `bytes`, `durationMs`, `result`.
Forma: cabeçalho com status HTTP + tamanho + tempo, corpo markdown.
Família: `…_bytes_code_codeText_durationMs_result` (245).

**G7 — Resultado de subagente → `agent-result.tsx`** (2 famílias, 19 ocorr.)
Núcleo comum: `agentId` + `status` + modelo (`resolvedModel`). Dois
estados pelas chaves: síncrono concluído (`content` grande + `totalTokens`
+ `totalDurationMs` + `toolStats`) e assíncrono lançado (`isAsync: true` +
`outputFile` + `canReadOutputFile` + `description`). É o único grupo cujo
`tool_use_result` **já é lido hoje** — por `deriveSubagentStatusesFromMessages`
(ri:319-332), para o painel de status, não para o feed.
Famílias: `…_canReadOutputFile_description_isAsync_outputFile` (17),
`…_agentType_content_prompt_resolvedModel` (2).

**G8 — Página publicada → `published-page.tsx`** (1 família, 3 ocorr.)
Chaves: `url`, `path`, `title`, `updated`, `version`, `liveSubscription`.
Forma: card com título + link externo + versão. (Par visual da tool
`Artifact`; as chaves não se parecem com nenhum outro grupo.)
Família: `…_liveSubscription_path_title_updated_url` (3).

**Conta final: 24 famílias → 8 corpos de resultado.** Somando o invólucro,
os blocos e os especiais, a matriz inteira exige **16 componentes**:
3 blocos (`assistant-text`, `thinking-block`, `user-bubble`) +
1 invólucro (`tool-chip`) + 8 corpos (G1–G8) + 2 sidechain
(`sidechain-group`, `sidechain-cluster`) + 1 `skill-chip` +
1 `attachment-chip`.

---

## Seção 3 — o que hoje cai no fallback genérico

Achados de leitura de código, todos confirmam o mesmo fato: **o classificador
não tem nenhum tratamento específico por família além de `Skill`**.

1. **22 das 23 tools vão pelo mesmo branch genérico.** `classifyMessage` só
   nomeia uma tool: `Skill` (cc:198-212, kind próprio `skill`, consome a
   mensagem seguinte — ri:404). As outras 22 (`Bash` a
   `mcp__supabase_geral__list_tables`) passam pelo branch `tool` genérico
   (cc:215-230), que usa `prettifyToolName(toolUse.name)` no label e a
   primeira linha do result no summary — nada mais.
2. **O gate de 300 caracteres (cc:217).** Tool cujo result tem ≤ 300 chars
   **não vira chip** — cai em `plain` (cc:233) e o evento assistant é
   emitido como `kind: 'assistant'` com a part `tool_use` crua (ri:464).
   Ou seja: o caminho "genérico" de fato para result curto é *JSON do input
   renderizado como prosa*. É o fallback mais frequente do sistema (a maioria
   dos `Bash` "ok" vive aí).
3. **As 24 formas de `tool_use_result` são ignoradas na renderização.**
   `tool_use_result` aparece uma única vez no pipeline de itens — em
   `deriveSubagentStatusesFromMessages` (ri:319-332), e só as chaves
   `agentId/agentType/status/prompt/total*` são lidas (ri:272-279).
   `structuredPatch`, `stdout/stderr`, `results`, `file.content`, `bytes` —
   tudo descartado. O que chega à tela é o `content` do part `tool_result`
   (string solta), via cc:216-229 e ri:152-165.
4. **`classifierKind: 'thinking'` é tipo morto no core.** Declarado em
   `one-line-chip-types.ts:8`, nunca emitido por `buildRenderItems`
   (o switch de kinds sai de `classifyMessage`, ri:386-419, e `thinking`
   não está entre os kinds de `ChatPayload`, cc:15-21). Thinking hoje só
   aparece como part dentro do item `assistant`.

---

## Seção 4 — as duas bordas

**`borda__content_none` (199) — `message: null`.**
O que o pipeline faz hoje: `textOf(null)` → `''` e `hasStructuredContent` →
`false`, então `suppress` (cc:91-95); o evento (kind `attachment` no
fixture) nunca chega a item. O tipo já admite null (`messages-types.ts`,
comentário em `MessagePayload.message`: "pode vir null em kinds como
`attachment`/`summary`/`system`").
O que o renderer novo **tem de fazer**: tratar `message == null` como
*não-evento visual* — pular sem erro, sem placeholder, sem item fantasma no
feed; e nunca assumir `message` presente antes de ramificar por `kind`.
199 ocorrências = 3,5% dos eventos gravados; não é exótico.

**`borda__content_string` (87) — `content` string em vez de array.**
O que o pipeline faz hoje: `extractContentParts` converte string em
`[{type:'text', text}]` (ri:53-57) e `textOf` devolve a string (ri:59-66,
cc:251-256). Depois do normalize o evento segue os caminhos normais:
envelope `<channel>` → `channel` (ri:444-447), `meta.kind` → `synthetic`
(ri:430-438), `user_type internal` → `user-internal` (ri:448-449), senão
`user` (ri:450-451); e os padrões de supressão (reminder, caveat, marker de
imagem, preâmbulo de skill) casam em cima da string (cc:97-111).
O que o renderer novo **tem de fazer**: **normalizar antes de ramificar** —
`content` entra numa função única equivalente a `extractContentParts` e
nenhum código downstream indexa `content[0]` ou itera parts sem passar por
ela. Sem o normalize, 87 eventos (1,5%) quebram ou somem.

---

## Seção 5 — ordem de construção sugerida

Total de eventos nas fixtures: **5.761** (2.919 bloco/borda + 1.500 tool +
1.342 result). "%" abaixo = eventos cujo **renderer final** da matriz está
construído ao fim da onda (chip genérico conta como final só para as
famílias que a matriz deixa no genérico). Pré-requisito da onda 1: parser
com normalize das duas bordas (seção 4) — sem ele nada renderiza.

**Onda 1 — feed funcional (6 componentes, 3.047 eventos → 52,9%)**
`tool-chip.tsx` (invólucro: icon/label/summary/tone/expandBody texto puro),
`assistant-text.tsx`, `thinking-block.tsx`, `user-bubble.tsx`,
`sidechain-group.tsx` + `sidechain-cluster.tsx`.
Fecha como final: blocos (2.633), bordas (286), tools que ficam no
genérico por natureza (TaskList, TaskStop, shadcn ×4, supabase ×3,
DesignSync, SendMessage, telegram reply/download = 117) e results genéricos
(`tasks`, `method_*`, `message_*` = 11). Todo o resto **já renderiza** no
chip genérico — a partir daqui é upgrade de fidelidade, não funcionalidade.

**Onda 2 — os três corpos quentes (3 componentes, +2.274 → 92,4%)**
`shell-output.tsx` (G1: 738 tool + 700 result), `fetch-result.tsx`
(G6: 255 + 245), `result-list.tsx` na variante links (G3-WebSearch:
171 + 165).

**Onda 3 — arquivo e diff (3 componentes, +384 → 99,0%)**
`file-content.tsx` (G5: 83 + 82 + 3), `diff-patch.tsx` (G2: 37 + 40 + 77),
`result-list.tsx` variante ToolSearch (G3: 31 + 31).

**Onda 4 — cauda nomeada (3 componentes, +56 → 100%)**
`agent-result.tsx` (G7: 19 + 19), `skill-chip.tsx` (Skill + `commandName`:
6 + 6), `published-page.tsx` (G8: 3 + 3).

Resumo: onda 1 = 6 componentes / 52,9% · onda 2 = 3 / 92,4% acumulado ·
onda 3 = 3 / 99,0% · onda 4 = 3 / 100%. Total **15 componentes** nas ondas
(os 16 da seção 2 menos `attachment-chip`, que a onda 1 absorve como chip
genérico com `file_id` no summary — promovê-lo a componente próprio fica
como melhoria posterior, sem bloquear nada).
