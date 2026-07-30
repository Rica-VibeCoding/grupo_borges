# PLANO — `tool_use_result` chega aos itens do feed (pré-requisito das ondas 2–4)

> Escrito pelo Hiro em 30/07, a pedido do Daniel. **v2 — revisão cruzada da
> Tara incorporada** (5 pontos + 1 correção factual, todos verificados no
> código antes de entrar). Plano executável; quem executa o passo 1: Hiro.
> Os passos 2–3 são do Daniel (fronteira `components/feed/**`).
>
> Origem do achado: `docs/cockpit-v2-medicao/auditoria-tema-30-07.md`, ressalva
> estrutural — o `tool_use_result` rico é descartado antes de chegar à tela e
> nenhum corpo G1–G8 da matriz pode ser construído como especificado sem ele.

## O problema em um parágrafo

O evento user que carrega só `tool_result` é suprimido (`render-items.ts:421-425`)
e seu texto entra no chip via `ToolResultLookup` — um `Map<string, { content:
string; isError: boolean }>` (`render-items.ts:9`) que guarda **apenas a string
do `content`**. O campo rico `message.tool_use_result` (`messages-types.ts:109`)
só é lido por `deriveSubagentStatusesFromMessages` (`render-items.ts:319-332`),
e só as chaves de subagente. Resultado: o cabeçalho HTTP do fetch-result, os
badges do shell-output e o patch pronto do diff-patch **literalmente não chegam
ao componente**.

## Decisões de design (v2 — respostas à revisão da Tara)

**D1. `rich` é `unknown` de propósito, não `ToolUseResult`.**
O tipo `ToolUseResult` (`messages-types.ts:44-53`) só declara campos de
subagente (`status`, `prompt`, `agentId`, `agentType`, `total*`, `toolStats`) —
não tem `code/bytes/stdout/results/structuredPatch`. Tipar `rich:
ToolUseResult` não tiparia nada útil e exigiria cast em todo consumidor.
Ampliar o contrato de `ToolUseResult` para as 24 famílias é trabalho de outra
ordem (24 uniões discriminadas) e mexeria num tipo que
`deriveSubagentStatusesFromMessages` já consome. Decisão: `rich?: unknown`,
e **a guarda mora no renderer** (`normalizarFetchResult` /
`normalizarListaResultado` devolvem `null` quando o payload não é da família) —
estreitamento por validação, não por declaração.

**D2. Inclusão CONDICIONAL da propriedade — a forma exata de antes é preservada.**
`map.set(id, { content, isError, rich: undefined })` mudaria a FORMA de toda
entrada (a propriedade passaria a existir com valor `undefined`), e "zero
quebra estrutural" deixaria de ser estritamente verdade. Então: `rich` só é
adicionada ao objeto quando há valor. O teste de regressão checa
**`Object.hasOwn`/`'rich' in entry`**, não só o valor.

**D3. Mensagem com >1 `tool_result`: rico NÃO é anexado a nenhum.**
O `tool_use_result` é um campo único da mensagem; com vários parts
`tool_result` não há como saber a qual deles o rico pertence — anexar a todos
seria afirmar uma associação falsa. Regra: só anexa quando a mensagem tem
**exatamente um** part `tool_result`. Conservador de propósito: ausente vale
mais que errado. Custo medido: **zero hoje** — varri as 52 fixtures e nenhuma
mensagem tem mais de um `tool_result`; o caso é coberto por teste sintético
para o dia em que aparecer.

**D4. `tool_use_id` duplicado: o rico sobrevive ao evento posterior sem rico.**
"Último ganha" continua valendo para `content`/`isError` (regra antiga). Mas
um evento posterior com o mesmo `tool_use_id` e sem `tool_use_result` **não
apaga** o rico já registrado — mesmo `tool_use_id` é a mesma execução, então o
rico do primeiro continua válido. Se o posterior TAMBÉM tiver rico, o do
posterior ganha (é informação mais nova da mesma execução). Coberto por teste.

**D5. Os testes provam comportamento, não ausência de exceção.**
Bateria na seção "Testes" abaixo: forma inesperada de `tool_use_result`,
múltiplos `tool_result` na mesma mensagem, duplicata de `tool_use_id`, forma
exata do objeto sem rico, e o fallback dos normalizadores (já coberto nos
testes dos renderers: fetch rejeita lista, lista rejeita fetch).

**Correção factual (Tara): `borda__content_none`.**
Não são "199 mensagens com `content` null" — são `message === null` **E**
`tool_use_result === null` juntos. E já é tratado com segurança hoje:
`buildToolResultLookup` pula na guarda `!m.message` (`render-items.ts:155`).
**Nenhuma mudança necessária nesse caminho** — e o teste 6 trava isso.

## O que muda, arquivo por arquivo

### 1. `packages/cockpit-core/src/render-items.ts` — o lookup carrega o rico

**Tipo** (`render-items.ts:9`):

```ts
// ANTES
export type ToolResultLookup = Map<string, { content: string; isError: boolean }>;

// DEPOIS — campo opcional, incluído CONDICIONALMENTE (D2)
export type ToolResultLookup = Map<string, {
  content: string;
  isError: boolean;
  /** tool_use_result cru, só quando a associação é inequívoca (D3) e o
   *  evento o tem. unknown de propósito (D1): a guarda é do renderer. */
  rich?: unknown;
}>;
```

**Builder** (`buildToolResultLookup`, `render-items.ts:152-165`):

```ts
const resultCount = parts.reduce((n, q) => n + (q.type === 'tool_result' ? 1 : 0), 0);
for (const p of parts) {
  if (p.type !== 'tool_result') continue;
  const body = typeof p.content === 'string' ? p.content : toolResultBodyToString(p.content);
  const entry: { content: string; isError: boolean; rich?: unknown } = {
    content: body,
    isError: Boolean(p.is_error),
  };
  if (resultCount === 1 && m.tool_use_result != null) {
    entry.rich = m.tool_use_result;          // D3: só associação inequívoca
  } else {
    const anterior = map.get(p.tool_use_id); // D4: duplicata preserva o rico
    if (anterior && 'rich' in anterior) entry.rich = anterior.rich;
  }
  map.set(p.tool_use_id, entry);
}
```

### 2. `components/feed/execucao-do-item.ts` (Daniel) — propagar `rich`

`execucaoDoChip` / `execucaoDaParte` passam a carregar `rich?: unknown` na
`EntradaDaExecucao`. Campo opcional — nada quebra.

### 3. `components/feed/corpo-do-item.tsx` (Daniel) — a ponte escolhe o corpo

`rich` presente + guarda do renderer passa → corpo específico (`FetchResult`,
`ResultList`); ausente ou rejeitado → `Saida` genérica (comportamento atual).
A ponte não conhece chaves — só tenta os normalizadores em ordem.

### 4. O que NÃO muda

- O classificador (`chat-payload-classifier.ts`) — gate de 300 chars e
  supressão continuam iguais; o rico viaja PARALELO ao texto.
- `messages-types.ts` — `ToolUseResult` intocado (D1).
- `deriveSubagentStatusesFromMessages` — já lê o que precisa da mensagem.
- Nenhum `RenderItem` muda de forma; nenhum consumidor do lookup quebra
  (campo opcional + inclusão condicional).

## Campos por família (o que cada corpo consome do `rich`)

Fonte: fixtures `fixtures/cockpit-v2/familias/result__*.json`.

- **G1 shell-output**: `stdout`, `stderr`, `interrupted`, `isImage`,
  `noOutputExpected` + aditivos `backgroundTaskId`, `gitOperation`,
  `persistedOutputPath`, `persistedOutputSize`, `returnCodeInterpretation`.
- **G2 diff-patch**: `filePath`, `structuredPatch[]`, `originalFile`,
  `userModified`, `type` ('create'), `oldString/newString/replaceAll`,
  `memdirStamped`.
- **G3 result-list**: `results[]`+`searchCount`+`query`; `matches[]`+
  `total_deferred_tools`; `paths[]`, `projects[]`, `tasks[]`+`method`.
  ✅ **Renderer pronto** (30/07, Hiro).
- **G4 status-line**: `success`, `message`, `commandName` + `pin`,
  `resumedAgentId`.
- **G5 file-content**: `file.filePath`, `file.content`, `numLines/totalLines`;
  ou `path`, `content`, `contentType`.
- **G6 fetch-result**: `url`, `code`, `codeText`, `bytes`, `durationMs`,
  `result`. ✅ **Renderer pronto** (30/07, Hiro).
- **G7 agent-result**: `agentId`, `status`, `resolvedModel` + (`content`,
  `totalTokens`, `totalDurationMs`, `toolStats`) ou (`isAsync`, `outputFile`,
  `canReadOutputFile`, `description`).
- **G8 published-page**: `url`, `path`, `title`, `updated`, `version`,
  `liveSubscription`.

## Testes que provam a passagem

Em `packages/cockpit-core/src/render-items.test.ts` (idioma da casa:
`node --test`, helpers sintéticos + fixture real):

1. **Atravessou**: fixture real `result__bytes_code_codeText_durationMs_result.json`
   → a entrada do lookup tem `'rich' in entry` e `rich.code === 200`,
   `rich.bytes === 2954287`.
2. **Forma exata sem rico** (D2): mensagem com `tool_result` e SEM
   `tool_use_result` → `Object.hasOwn(entry, 'rich') === false`. Não basta
   `entry.rich === undefined` — a propriedade não pode EXISTIR.
3. **Múltiplos `tool_result`** (D3): mensagem sintética com 2 parts
   `tool_result` + `tool_use_result` presente → NENHUMA das duas entradas tem
   `rich`. (Fixture real não cobre: 0 ocorrências hoje — medido.)
4. **Duplicata** (D4): evento A com rico, evento B posterior com o mesmo
   `tool_use_id` e sem rico → `content`/`isError` do B, `rich` do A. E o
   inverso: B com rico próprio → `rich` do B.
5. **Forma inesperada**: `tool_use_result` como string solta → atravessa como
   está (é `unknown`); a rejeição é dos normalizadores — coberta nos testes
   dos renderers (fetch × lista cruzados).
6. **`message === null` + `tool_use_result === null`** (correção factual):
   o builder pula sem erro — trava o comportamento de `render-items.ts:155`.

## Ordem de execução

1. ✅ **(Hiro, 30/07)** Plano v2 com a revisão da Tara.
2. ✅ **(Hiro, 30/07)** Passo 1: tipo + builder + testes 1–6 em
   `packages/cockpit-core`. Core 24/24, app 215/215, tsc limpo nos dois.
3. **(Daniel, quando quiser)** Passos 2–3 na fronteira dele: propagar `rich`
   e ramificar na ponte. Os renderers `FetchResult`/`ResultList` já estão
   prontos e testados — é plugar.
4. Suíte inteira dos dois pacotes + paridade das 52 famílias (nenhum item
   muda de `kind`, contagem idêntica — a mudança é aditiva no lookup).
5. Só então destravar os corpos G1/G2/G4/G5/G7/G8, cada um no padrão já
   provado: lógica `.ts` + `.tsx` + teste contra fixture real.
