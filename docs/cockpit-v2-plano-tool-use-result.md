# PLANO — `tool_use_result` chega aos itens do feed (pré-requisito das ondas 2–4)

> Escrito pelo Hiro em 30/07, a pedido do Daniel. **Plano executável, não
> implementação** — o pipeline (`packages/cockpit-core/src/render-items.ts` e
> afins) está CONGELADO enquanto o Daniel roda a bancada dos três braços.
> Executar só quando ele liberar. Quem executa: Hiro.
>
> Origem do achado: `docs/cockpit-v2-medicao/auditoria-tema-30-07.md`, ressalva
> estrutural — o `tool_use_result` rico é descartado antes de chegar à tela e
> nenhum corpo G1–G8 da matriz pode ser construído como especificado sem ele.

## O problema em um parágrafo

O evento user que carrega só `tool_result` é suprimido (`render-items.ts:421-425`)
e seu texto entra no chip via `ToolResultLookup` — um `Map<string, { content:
string; isError: boolean }>` (`render-items.ts:9`) que guarda **apenas a string
do `content`**. O campo rico `message.tool_use_result` (`messages-types.ts:109`,
tipo `ToolUseResult`) — com `stdout/stderr`, `structuredPatch`, `results`,
`file.content`, `code/bytes/durationMs` — só é lido por
`deriveSubagentStatusesFromMessages` (`render-items.ts:319-332`), e só as chaves
de subagente. Resultado: o cabeçalho HTTP do fetch-result, os badges de
background/persistência do shell-output e o patch pronto do diff-patch
**literalmente não chegam ao componente**.

## O que muda, arquivo por arquivo

### 1. `packages/cockpit-core/src/render-items.ts` — o lookup carrega o rico

**Tipo** (`render-items.ts:9`):

```ts
// ANTES
export type ToolResultLookup = Map<string, { content: string; isError: boolean }>;

// DEPOIS
export type ToolResultLookup = Map<string, {
  content: string;
  isError: boolean;
  /** O tool_use_result rico do evento que carregou este result, quando
   *  existir. Chaves variam por família — consumidor estreita com guarda. */
  rich?: ToolUseResult;
}>;
```

**Builder** (`buildToolResultLookup`, `render-items.ts:152-165`): no ramo
`p.type === 'tool_result'`, anexar `rich: m.tool_use_result ?? undefined` ao
`map.set(p.tool_use_id, …)`. Uma linha de mudança efetiva.

⚠️ Mesma chave, dois eventos: se dois eventos distintos carregarem o mesmo
`tool_use_id` (não visto nas fixtures, mas o tipo permite), o último ganha —
mesmo comportamento atual do `content`, então nenhuma semântica muda.

### 2. Consumidores do lookup — nenhum quebra, dois ganham opção

O tipo cresce por campo OPCIONAL, então todo consumidor atual compila sem
mudança. Os pontos que passam a poder ler `rich`:

- `apps/cockpit/components/feed/execucao-do-item.ts` — `execucaoDoChip` /
  `execucaoDaParte` passam a propagar `rich` na `EntradaDaExecucao`
  (campo opcional novo, mesma técnica).
- `apps/cockpit/components/feed/corpo-do-item.tsx` — a ponte escolhe o corpo:
  `rich` presente + guarda da família passa → renderer específico; ausente ou
  não reconhecido → `Saida` genérica (comportamento atual). **A guarda mora no
  renderer** (`normalizarFetchResult`, `normalizarListaResultado` devolvem
  `null` quando não é da família) — a ponte não precisa conhecer chaves.

### 3. O que NÃO muda

- O classificador (`chat-payload-classifier.ts`) — o gate de 300 chars e a
  supressão continuam iguais; o rico viaja PARALELO ao texto, não no lugar.
- `deriveSubagentStatusesFromMessages` — já lê o que precisa direto da mensagem.
- Nenhum RenderItem muda de forma — a mudança é só no lookup auxiliar.

## Campos por família (o que cada corpo consome do `rich`)

Fonte: fixtures `fixtures/cockpit-v2/familias/result__*.json`.

- **G1 shell-output**: `stdout`, `stderr`, `interrupted`, `isImage`,
  `noOutputExpected` + aditivos `backgroundTaskId`, `gitOperation`,
  `persistedOutputPath`, `persistedOutputSize`, `returnCodeInterpretation`.
- **G2 diff-patch**: `filePath`, `structuredPatch[]` (`oldStart/oldLines/
  newStart/newLines/lines`), `originalFile`, `userModified`, `type` ('create'),
  `oldString/newString/replaceAll`, `memdirStamped`.
- **G3 result-list**: `results[]` + `searchCount` + `query` (WebSearch);
  `matches[]` + `total_deferred_tools` + `query` (ToolSearch); `paths[]`,
  `projects[]`, `tasks[]` + `method`. ✅ **Renderers prontos** (30/07, Hiro).
- **G4 status-line**: `success`, `message`, `commandName` + `pin`,
  `resumedAgentId`.
- **G5 file-content**: `file.filePath`, `file.content`, `numLines/totalLines`;
  ou `path`, `content`, `contentType` (DesignSync).
- **G6 fetch-result**: `url`, `code`, `codeText`, `bytes`, `durationMs`,
  `result`. ✅ **Renderer pronto** (30/07, Hiro).
- **G7 agent-result**: `agentId`, `status`, `resolvedModel` + (`content`,
  `totalTokens`, `totalDurationMs`, `toolStats`) ou (`isAsync`, `outputFile`,
  `canReadOutputFile`, `description`).
- **G8 published-page**: `url`, `path`, `title`, `updated`, `version`,
  `liveSubscription`.

## Testes que provam a passagem

1. **Unitário do builder** (estender `lib/spike/to-thread-messages.test.ts` ou
   onde `buildToolResultLookup` for testado): fixture real
   `result__bytes_code_codeText_durationMs_result.json` → o lookup do
   `tool_use_id` correspondente tem `rich.code === 200` e `rich.bytes ===
   2954287`. Prova que o rico atravessou.
2. **Regressão**: evento user com `tool_result` e **sem** `tool_use_result`
   (a maioria das 52 famílias) → `rich === undefined`, `content` e `isError`
   idênticos a antes. Prova que nada mudou pra quem não tem rico.
3. **Ponte** (`components/feed/execucao-do-item.test.ts`): chip cujo lookup tem
   `rich` de fetch → `EntradaDaExecucao` carrega o `rich`; chip sem `rich` →
   campo ausente e o corpo genérico continua sendo escolhido.
4. **Paridade das bordas**: rodar a suíte inteira das 52 famílias
   (`to-thread-messages.test.ts` já itera fixtures) — nenhum item muda de
   `kind`, contagem de itens idêntica. A mudança é aditiva no lookup, então
   qualquer diferença aqui é bug.

## Ordem de execução (quando o pipeline liberar)

1. Tipo + builder (item 1) + testes 1 e 2. Commit isolado, bancada NÃO rodando.
2. `execucao-do-item.ts` propaga `rich` + teste 3.
3. `corpo-do-item.tsx` ramifica: fetch → `FetchResult`, lista → `ResultList`
   (os dois já existem, testados contra fixture real, tsc limpo).
4. Suíte inteira + teste 4. Só então destravar os corpos G1/G2/G5/G7/G8/G4
   (cada um é um renderer novo seguindo o mesmo padrão: lógica `.ts` + `.tsx`
   + teste contra fixture real).
