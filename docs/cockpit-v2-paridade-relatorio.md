<!-- Arquivado por mim (Pavan) em 30/07/2026. Produzido pela Tara (gpt-5.6-sol) em
     quatro rodadas, sob contrato meu: auditoria, controle negativo, corpus composto
     e identidade do item. Nenhuma rodada alterou arquivo do repositório. -->

# Paridade v1 × v2 — evidência do item 5 do gate

> **Por que este arquivo existe aqui.** O relatório nasceu em `/tmp/paridade-v1-v2/`,
> que some. O item 5 do comportamento observável (`cockpit-v2-fusao.md`) exige
> paridade semântica total, e esta é a prova. Perder evidência por não escrever já
> aconteceu neste projeto — ver `cockpit-v2-ESTADO.md` §7.

## Veredito

**O item 5 passa nas fixtures e nos transcripts congelados.** `apps/web/lib/render-items.ts`
e `packages/cockpit-core/src/render-items.ts` são cópias independentes — o `apps/web`
não importa o core — e ainda assim produzem saída idêntica:

- **52 famílias**: 52 batem, 0 divergem. As duas bordas obrigatórias batem
  (`borda__content_none` → 0 itens nas duas; `borda__content_string` → 1 item `user`).
- **4 transcripts SSE reais**: `daniel` 330×330, `pavan` 463×463, `hiro` 3×3,
  `tara` 0×0. **796 itens** comparados por kind, posição, identidade e agrupamento.
- Divergência de código entre as duas cópias: só caminho de `import type`. Sem efeito
  em runtime.

## Por que eu acredito neste número

Porque o instrumento foi provado antes, e não pelo próprio resultado. Um comparador
cego também devolveria "52/52 igual" — este projeto já subiu bancada verde sem medir
nada duas vezes. Quatro mutantes do v2, um por dimensão:

| Mutante | Dimensão | Acusado? |
|---|---|---|
| Suprimir o kind `assistant` | quantidade e kinds | sim, 14 famílias |
| Inverter a ordem | ordem | **não** nas famílias — elas produzem 0 ou 1 item; **sim** nos transcripts |
| Alterar o `count` do agrupamento | agrupamento | sim, 16 famílias |
| Trocar dois adjacentes de mesmo kind | identidade | sim, em 3 dos 4 transcripts |

O segundo mutante é o achado que salva o resultado: nas famílias isoladas a paridade
de ordem **não estava provada**, e só o corpus composto a provou. Zero item sem
identificador e zero identidade duplicada nos 796.

## Lacunas conhecidas — o que este relatório NÃO prova

1. **Reconexão real.** Nenhum transcript contém queda e segundo ciclo de replay, e o
   item 5 fala explicitamente em "nenhum evento perdido, duplicado ou reordenado após
   reconexão".
2. **`sidechain-cluster`.** Nenhum foi produzido pelo corpus; `coalesceSidechainGroups`
   segue sem controle composto.

As duas exigem gravar fixture nova rodando carga contra o canário. **Não fiz de
propósito:** o canário está parado no estado canônico do gate, esperando a medição no
iPhone do Rica, e rodar carga agora destruiria essa preparação. Fica como pendência
depois da medição, não como buraco esquecido.

---

# Auditoria de paridade v1 × v2 — classificador de payload

Data: 2026-07-30  
Repositório auditado (somente leitura): `/home/clawd/repos/grupo_borges`

## Conclusão

- **52 de 52 famílias presentes batem; 0 divergem.**
- O número “53 famílias” informado no pedido não corresponde ao conteúdo do diretório: existem 53 arquivos JSON **incluindo** `_indice.json`, ou seja, 52 fixtures de família. O próprio `_indice.json` declara `"total_familias": 52` e lista 52 famílias.
- As bordas obrigatórias **não divergem**:
  - `borda__content_none`: v1 e v2 produzem 0 itens, sequência `[]`, agrupamento `[]`.
  - `borda__content_string`: v1 e v2 produzem 1 item, sequência `["user"]`, agrupamento `[{"kind":"user"}]`.
- Não há divergência funcional entre as implementações auditadas. As únicas diferenças de código são caminhos de imports exclusivamente de tipos.

## Escopo e método

Implementações executadas:

- v1: `apps/web/lib/render-items.ts`
- v2: `packages/cockpit-core/src/render-items.ts`

Dependências locais comparadas para excluir divergência indireta:

- `chat-payload-classifier.ts`
- `slash-command-wrapper.ts`
- `task-notification-wrapper.ts`
- `tool-name.ts`
- `messages-types.ts`

Cada fixture de `fixtures/cockpit-v2/familias/*.json`, exceto `_indice.json`, foi lida sem alteração. O campo `evento` foi passado como lista unitária a `buildRenderItems`. Para cada versão foram comparados:

1. quantidade de itens;
2. sequência de `kind`;
3. agrupamento observável:
   - para `sidechain-group`: `rootUuid`, `count` e `parentUuids`;
   - para `sidechain-cluster`: `subagentCount` e a sequência de grupos com `rootUuid` e `parentUuids`;
   - para os demais itens: o `kind`.

O comparador foi executado com Node 22 e `--experimental-strip-types`. Artefatos descartáveis:

- `/tmp/paridade-v1-v2/audit.mjs`
- `/tmp/paridade-v1-v2/resultados.json`

## Resultado por família

Em todas as linhas, v1 = v2. “Grupo 1” significa um `sidechain-group` unitário; os identificadores e `parentUuids` também foram comparados e foram iguais.

| Família | Itens | Sequência de kind / agrupamento |
|---|---:|---|
| bloco__text | 1 | `assistant` |
| bloco__thinking | 1 | `assistant` |
| bloco__tool_result | 0 | `[]` |
| borda__content_none | 0 | `[]` |
| borda__content_string | 1 | `user` |
| result__agentId_agentType_content_prompt_resolvedModel | 1 | `sidechain-group` (Grupo 1) |
| result__agentId_canReadOutputFile_description_isAsync_outputFile | 0 | `[]` |
| result__backgroundTaskId_interrupted_isImage_noOutputExpected_stderr | 0 | `[]` |
| result__bytes_code_codeText_durationMs_result | 1 | `sidechain-group` (Grupo 1) |
| result__commandName_success | 0 | `[]` |
| result__content_contentType_isBase64_method_path | 0 | `[]` |
| result__content_filePath_memdirStamped_originalFile_structuredPatch | 0 | `[]` |
| result__content_filePath_originalFile_structuredPatch_type | 0 | `[]` |
| result__durationSeconds_query_results_searchCount | 1 | `sidechain-group` (Grupo 1) |
| result__filePath_memdirStamped_newString_oldString_originalFile | 0 | `[]` |
| result__filePath_newString_oldString_originalFile_replaceAll | 0 | `[]` |
| result__file_type | 0 | `[]` |
| result__gitOperation_interrupted_isImage_noOutputExpected_stderr | 0 | `[]` |
| result__interrupted_isImage_noOutputExpected_persistedOutputPath_persistedOutputSize | 1 | `sidechain-group` (Grupo 1) |
| result__interrupted_isImage_noOutputExpected_returnCodeInterpretation_stderr | 1 | `sidechain-group` (Grupo 1) |
| result__interrupted_isImage_noOutputExpected_stderr_stdout | 0 | `[]` |
| result__liveSubscription_path_title_updated_url | 0 | `[]` |
| result__matches_query_total_deferred_tools | 0 | `[]` |
| result__message_pin_resumedAgentId_success | 0 | `[]` |
| result__message_pin_success | 0 | `[]` |
| result__message_success | 1 | `sidechain-group` (Grupo 1) |
| result__method_paths | 0 | `[]` |
| result__method_projects | 0 | `[]` |
| result__tasks | 0 | `[]` |
| tool__Agent | 1 | `assistant` |
| tool__Artifact | 1 | `assistant` |
| tool__Bash | 1 | `assistant` |
| tool__DesignSync | 1 | `assistant` |
| tool__Edit | 1 | `assistant` |
| tool__Read | 1 | `assistant` |
| tool__SendMessage | 1 | `assistant` |
| tool__Skill | 1 | `chip` |
| tool__TaskList | 1 | `assistant` |
| tool__TaskStop | 1 | `sidechain-group` (Grupo 1) |
| tool__ToolSearch | 1 | `assistant` |
| tool__WebFetch | 1 | `sidechain-group` (Grupo 1) |
| tool__WebSearch | 1 | `sidechain-group` (Grupo 1) |
| tool__Write | 1 | `assistant` |
| tool__mcp__plugin_telegram_telegram__download_attachment | 1 | `assistant` |
| tool__mcp__plugin_telegram_telegram__reply | 1 | `assistant` |
| tool__mcp__shadcn__get_project_registries | 1 | `sidechain-group` (Grupo 1) |
| tool__mcp__shadcn__list_items_in_registries | 1 | `sidechain-group` (Grupo 1) |
| tool__mcp__shadcn__search_items_in_registries | 1 | `sidechain-group` (Grupo 1) |
| tool__mcp__shadcn__view_items_in_registries | 1 | `sidechain-group` (Grupo 1) |
| tool__mcp__supabase_geral__execute_sql | 1 | `sidechain-group` (Grupo 1) |
| tool__mcp__supabase_geral__list_migrations | 1 | `sidechain-group` (Grupo 1) |
| tool__mcp__supabase_geral__list_tables | 1 | `sidechain-group` (Grupo 1) |

## Divergências funcionais de código

Nenhuma.

O diff de `render-items.ts` contém somente:

- v1 importa `OneLineChipKind` e `OneLineChipTone` de `../components/one-line-chip-types.ts`;
- v2 importa os mesmos tipos de `./one-line-chip-types.ts`.

O diff de `chat-payload-classifier.ts` contém a mesma adaptação de caminho para `OneLineChipTone`.

Esses imports usam `import type`, são apagados na execução e não alteram saída. Os arquivos auxiliares comparados são byte a byte equivalentes. Logo, não existe diferença de código executável que explique casos divergentes — e nenhum caso divergiu.

## Julgamento

- Para todas as 52 famílias presentes, as saídas observadas coincidem em quantidade, sequência de `kind` e agrupamento; o controle negativo abaixo limita essa conclusão às estruturas unitárias que o corpus efetivamente exercita.
- Os caminhos de import de tipos são corretos para a estrutura própria de cada cópia; não há uma versão “mais certa” por comportamento.
- A única correção necessária é no enunciado/inventário: o corpus atual possui 52 famílias, não 53. Não há base para declarar uma 53ª família aprovada ou divergente porque ela não existe no diretório nem no índice.

## Controle negativo

### Preparação

O lado v2 foi copiado, com suas dependências locais, para três diretórios sob `/tmp/paridade-v1-v2/mutantes/`. O `audit.mjs` recebeu apenas uma opção `V2_MODULE` para carregar cada cópia mutante; seu cálculo de igualdade não foi alterado.

Cada mutante contém exatamente uma alteração comportamental em `render-items.ts`:

1. `m1-supressao-assistant`: deixa de emitir itens `assistant`;
2. `m2-inversao-ordem`: retorna `items.reverse()` em vez de `items`;
3. `m3-count-agrupamento`: emite `count = group.length + 1` nos itens `sidechain-group`.

### Mutante 1 — supressão de `assistant`

**Resultado: 14 famílias divergentes. Mutante detectado.**

- `bloco__text`
- `bloco__thinking`
- `tool__Agent`
- `tool__Artifact`
- `tool__Bash`
- `tool__DesignSync`
- `tool__Edit`
- `tool__Read`
- `tool__SendMessage`
- `tool__TaskList`
- `tool__ToolSearch`
- `tool__Write`
- `tool__mcp__plugin_telegram_telegram__download_attachment`
- `tool__mcp__plugin_telegram_telegram__reply`

Diferença concreta: nessas famílias, v1 produz um item `assistant` e o mutante produz zero itens. Isso demonstra sensibilidade a quantidade e ao conjunto/sequência de `kind` quando a mutação é exercitada.

### Mutante 2 — inversão da ordem

**Resultado: 0 famílias divergentes. Mutante não detectado.**

O comparador preserva e compara arrays ordenados de `kind` e de agrupamento; portanto, a falha não é uma normalização indevida do instrumento. A falha está na massa de teste: cada fixture contém um único `evento`, e cada chamada a `buildRenderItems([evento])` produziu no máximo um item. Reverter uma lista de tamanho zero ou um não muda a saída.

Consequência: o resultado original **não prova paridade de ordem** para feeds com dois ou mais itens. Faltou executar ao menos uma entrada composta que gerasse dois itens distinguíveis e verificar sua sequência. Também não há cobertura para ordem entre múltiplos grupos ou para ordem de múltiplos `parentUuids`, pois todas as estruturas exercitadas são unitárias.

### Mutante 3 — `count` incorreto no agrupamento

**Resultado: 16 famílias divergentes. Mutante detectado.**

- `result__agentId_agentType_content_prompt_resolvedModel`
- `result__bytes_code_codeText_durationMs_result`
- `result__durationSeconds_query_results_searchCount`
- `result__interrupted_isImage_noOutputExpected_persistedOutputPath_persistedOutputSize`
- `result__interrupted_isImage_noOutputExpected_returnCodeInterpretation_stderr`
- `result__message_success`
- `tool__TaskStop`
- `tool__WebFetch`
- `tool__WebSearch`
- `tool__mcp__shadcn__get_project_registries`
- `tool__mcp__shadcn__list_items_in_registries`
- `tool__mcp__shadcn__search_items_in_registries`
- `tool__mcp__shadcn__view_items_in_registries`
- `tool__mcp__supabase_geral__execute_sql`
- `tool__mcp__supabase_geral__list_migrations`
- `tool__mcp__supabase_geral__list_tables`

Diferença concreta: v1 informa `count: 1` e o mutante informa `count: 2` no mesmo `sidechain-group`. Isso demonstra que o comparador enxerga os metadados de agrupamento exercitados (`rootUuid`, `count` e `parentUuids`), embora o corpus não teste agrupamentos com múltiplos membros.

### Validade após o controle

- **Quantidade:** validada pelo controle negativo.
- **Conjunto/sequência de `kind` para saídas unitárias:** validado pelo controle negativo.
- **Agrupamento unitário e seus metadados:** validado pelo controle negativo.
- **Ordem relativa de dois ou mais itens/grupos/membros:** **não validada**; o mutante passou batido porque nenhuma fixture exercita essa dimensão.

Assim, “52/52 batem” permanece correto para as saídas efetivamente observadas, mas a afirmação mais ampla de paridade de ordem exigida pelo aceite não está provada por este corpus.

## Corpus composto

### Replay aplicado

Foram processados integralmente, na ordem física das linhas, os quatro arquivos pedidos:

- `daniel.sse.jsonl`: 1.335 linhas, 1.331 eventos `message`;
- `hiro.sse.jsonl`: 11 linhas, 7 eventos `message`;
- `pavan.sse.jsonl`: 3.084 linhas, 3.080 eventos `message`;
- `tara.sse.jsonl`: 4 linhas, 0 eventos `message`.

Cada linha é um objeto JSON já normalizado pelo gravador, com `{event, data}`. O replay:

1. fez parse de todas as linhas não vazias;
2. preservou a ordem do arquivo;
3. passou somente `data` dos eventos `message` para `buildRenderItems`;
4. ignorou `replay-start`, `replay-end` e `heartbeat`, pois são controle de transporte e não `MessagePayload`, igual ao contrato do consumidor;
5. chamou `buildRenderItems` uma vez com a sequência completa de cada sessão.

Não foi necessário reparar evento parcial: houve **zero erros de JSON**. Também não foi necessário deduplicar: houve **zero IDs duplicados e zero UUIDs duplicados** nos quatro arquivos. Cada arquivo contém um único `replay-start` e um único `replay-end`; portanto, este corpus não registra uma queda seguida de reconexão.

### Comparação v1 × v2

Foram comparados integralmente:

- quantidade total de itens;
- array ordenado de todos os `kind`;
- posição e composição de cada `sidechain-group`: `rootUuid`, `count` e array ordenado de `parentUuids`;
- posição e composição de cada `sidechain-cluster`: `subagentCount` e array ordenado dos grupos e membros.

| Transcript | Mensagens de entrada | Itens v1 | Itens v2 | Resultado |
|---|---:|---:|---:|---|
| daniel | 1.331 | 330 | 330 | igual |
| hiro | 7 | 3 | 3 | igual |
| pavan | 3.080 | 463 | 463 | igual |
| tara | 0 | 0 | 0 | igual (vazio) |

**Resultado: v1 e v2 batem nos quatro transcripts; nenhuma divergência de quantidade, sequência de `kind` ou composição de agrupamento.**

O corpus agora exercita agrupamentos realmente compostos:

- `daniel`: 8 `sidechain-group`, todos multievento; maior grupo com 132 membros;
- `pavan`: 11 `sidechain-group`, todos multievento; maior grupo com 328 membros;
- `hiro` e `tara`: nenhum agrupamento.

Nenhum transcript produziu `sidechain-cluster` nessa chamada, porque `buildRenderItems` não chama `coalesceSidechainGroups`; essa transformação permanece fora da cobertura deste replay.

### Controle negativo no corpus composto

#### Mutante 1 — supressão de `assistant`

**3 transcripts divergentes:** `daniel`, `hiro` e `pavan`. `tara` não acusa porque sua entrada e saída são vazias.

- `daniel`: v1 = 330 itens; mutante = 97;
- `hiro`: v1 = 3 itens; mutante = 1;
- `pavan`: v1 = 463 itens; mutante = 120.

#### Mutante 2 — inversão da ordem

**3 transcripts divergentes:** `daniel`, `hiro` e `pavan`. O mutante de ordem foi acusado.

- `daniel`: 330 itens em ordem invertida;
- `hiro`: 3 itens em ordem invertida;
- `pavan`: 463 itens em ordem invertida;
- `tara`: 0 itens; inverter a lista vazia é observacionalmente neutro.

Isso fecha o furo encontrado no corpus por família: o instrumento detecta reordenação quando recebe uma saída composta cujo array de `kind` não é simétrico.

#### Mutante 3 — `count` incorreto no agrupamento

**2 transcripts divergentes:** `daniel` e `pavan`, precisamente os dois que contêm `sidechain-group`. `hiro` e `tara` não têm agrupamentos para exercitar a mutação.

### O que ainda fica sem controle

- **Reconexão real:** nenhum arquivo contém mais de um ciclo replay/live, repetição causada por cursor ou evento posterior a uma queda. Logo, “nenhum evento perdido, duplicado ou reordenado após reconexão” ainda não foi exercitado. Lacuna conhecida preservada por decisão do responsável pelo gate.
- **Identidade/ordem entre itens comuns do mesmo `kind`:** lacuna desta etapa, posteriormente **fechada** na seção “Identidade do item”.
- **`sidechain-cluster`:** não apareceu na saída de `buildRenderItems`; a ordem e composição produzidas por `coalesceSidechainGroups` não receberam controle composto nesta rodada. Lacuna conhecida preservada por decisão do responsável pelo gate.
- **Transcript vazio:** `tara` só prova que ambas retornam vazio para uma sessão sem mensagens; não dá sensibilidade a nenhum mutante que dependa de item.

Artefatos:

- `/tmp/paridade-v1-v2/audit-transcripts.mjs`;
- `/tmp/paridade-v1-v2/resultado-transcripts-baseline.json`;
- `/tmp/paridade-v1-v2/resultado-transcripts-m1-supressao-assistant.json`;
- `/tmp/paridade-v1-v2/resultado-transcripts-m2-inversao-ordem.json`;
- `/tmp/paridade-v1-v2/resultado-transcripts-m3-count-agrupamento.json`.

## Identidade do item

Esta seção fecha a lacuna de identidade apontada em “Corpus composto” e substitui a limitação anterior sobre itens comuns do mesmo `kind`.

### Chave ampliada

O comparador passou a registrar, na posição de cada item, seu `kind` e uma identidade estável:

- itens com `payload`: `payload.uuid`, com fallback para `payload.id`;
- `sidechain-group`: `rootUuid`;
- `sidechain-cluster`: sequência dos `rootUuid` de seus grupos;
- `ask-user`: `entry.request_id`.

A igualdade continua comparando quantidade, sequência ordenada de `kind` e composição dos agrupamentos, mas agora compara também o array ordenado de identidades. Portanto, dois itens do mesmo `kind` trocados de posição deixam de ser indistinguíveis.

### Paridade ampliada v1 × v2

| Transcript | Itens | Sem identificador | Identidades duplicadas | Resultado |
|---|---:|---:|---:|---|
| daniel | 330 | 0 | 0 | igual |
| hiro | 3 | 0 | 0 | igual |
| pavan | 463 | 0 | 0 | igual |
| tara | 0 | 0 | 0 | igual (vazio) |
| **Total** | **796** | **0** | **0** | **4/4 iguais** |

V1 e v2 continuam em paridade nos quatro transcripts com a chave ampliada. Nenhum item produzido pelo corpus chega sem identificador e nenhuma identidade se repete dentro do mesmo transcript. Assim, para este corpus não é necessário depender apenas da posição ou do `kind` para reconhecer o item.

### Quarto mutante — troca adjacente de mesmo `kind`

Foi criada a cópia `mutantes/m4-troca-adjacentes-mesmo-kind`. Sua única alteração procura o primeiro par adjacente com o mesmo `kind`, troca os dois itens e mantém quantidade, multiconjunto de `kind` e composição individual intactos.

**Resultado: mutante acusado em 3 transcripts.**

- `daniel`: troca detectada na posição 4, entre dois itens `chip`;
- `hiro`: troca detectada na posição 1, entre dois itens `assistant`;
- `pavan`: troca detectada na posição 2, entre dois itens `assistant`;
- `tara`: não acusa porque não possui item nem par adjacente.

O comparador antigo veria as mesmas sequências de `kind`; o ampliado acusa porque os `uuid` aparecem em posições opostas. Logo, a dimensão “ordem entre itens do mesmo kind” agora tem controle negativo válido nos três transcripts não vazios.

### Lacunas conhecidas preservadas

Por decisão do responsável pelo gate, reconexão real e `sidechain-cluster` não serão exercitados nesta rodada: ambos exigiriam gerar fixture nova contra o canário, que está parado no estado canônico aguardando medição no iPhone. Permanecem registrados como lacunas conhecidas, não como pendência desta auditoria.

Artefatos adicionais:

- `/tmp/paridade-v1-v2/resultado-transcripts-identidade-baseline.json`;
- `/tmp/paridade-v1-v2/resultado-transcripts-m4-troca-adjacentes-mesmo-kind.json`;
- `/tmp/paridade-v1-v2/mutantes/m4-troca-adjacentes-mesmo-kind/`.

## Integridade do repositório

Nenhum arquivo do repositório foi criado, editado ou removido pela auditoria. Durante a auditoria apareceram mudanças concorrentes em `apps/cockpit/app/globals.css`, `apps/cockpit/app/layout.tsx`, `apps/cockpit/app/fonts.ts` e `apps/cockpit/app/fonts/`, além de `.claude/worktrees/`; elas não foram feitas nem tocadas por esta auditoria. Nenhum `git add`, commit, servidor ou instalação no repositório foi executado.
