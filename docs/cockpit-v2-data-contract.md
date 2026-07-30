# DATA-CONTRACT.md — payload → tela, do Cockpit v2

> Passo 2 da ordem em `cockpit-v2-fusao.md`. Contrato de **dados**, não de estilo
> (estilo em `cockpit-v2-estetica.md`). Quem escreve renderer lê isto primeiro.
>
> Tudo aqui foi lido do código que está no ar em 2026-07-30, não da memória.
> `apps/web/lib/render-items.ts` é a fonte; as fixtures em
> `fixtures/cockpit-v2/familias/` são a prova.

---

## 1. O ativo real chama `buildRenderItems`

A fusão fala em documentar "a assinatura do `convertMessage`". **Essa função não
existe no nosso código** — é nome de slot do `assistant-ui`, e só passará a existir
se o spike do passo 5 aprovar a biblioteca. O que existe hoje, e sobrevive nos dois
caminhos possíveis, é um pipeline de **funções puras sem React** em
`lib/render-items.ts` (19 KB, coberto por `tests/render-items.test.ts`):

```ts
buildRenderItems(messages: MessagePayload[]): RenderItem[]
buildToolResultLookup(messages: MessagePayload[]): ToolResultLookup   // Map<tool_use_id, {content, isError}>
buildSidechainRoots(messages: MessagePayload[]): Map<string, string>
coalesceSidechainGroups(items: RenderItem[]): RenderItem[]
mergeAskUserItems(items: RenderItem[], askUserByRequestId: Map<string, AskUserEntry> | undefined): RenderItem[]
deriveSubagentStatusesFromMessages(messages: MessagePayload[]): Map<string, SubagentStatusEntry>
```

### A ordem de composição é parte do contrato

Copiada do consumidor real (`components/chat-messages.tsx:792-816`). Trocar a
ordem muda o resultado e **quebra a paridade sem dar erro**:

```ts
const toolResults = buildToolResultLookup(messages);           // lookup, passado aos renderers

const items = mergeAskUserItems(
  coalesceSidechainGroups(buildRenderItems(messages)),         // ← coalesce ANTES do merge
  askUserByRequestId,
);

const subagentStatuses = deriveSubagentStatusesFromMessages(messages);   // trilha separada
```

`coalesceSidechainGroups` colapsa **runs consecutivos**: um grupo isolado fica como
está, dois ou mais viram um `sidechain-cluster` com contagem agregada. Rodar o
merge antes do coalesce insere itens no meio da corrida e impede o colapso.

### ⚠️ Discrepância entre comentário e código, já verificada

O comentário no tipo `RenderItem` diz que o `ask-user` é *"ordenado por
`created_at_ms` **entre os items do feed**"*. **A implementação não faz isso** —
ela faz `[...items, ...askItems]`: os `ask-user` pendentes são ordenados só **entre
si** e anexados **no fim** da lista.

Quem reimplementar seguindo o comentário vai intercalar por timestamp, produzir uma
ordem diferente da atual e falhar o checklist de equivalência achando que o
checklist está errado. **O código vale, o comentário não.**

---

## 2. `RenderItem` — os dez tipos, e não há décimo primeiro

União fechada. Renderer novo entra como caso de um destes, nunca como tipo novo
sem passar pelo contrato:

| kind | o que é | campos que o renderer usa |
|---|---|---|
| `user` | mensagem do Rica | `text` |
| `user-internal` | entrada que não é do Rica (hook, sistema) | `text` |
| `synthetic` | mensagem fabricada pelo CC | `syntheticKind`, `rawText` |
| `channel` | veio de Telegram/WhatsApp | `raw` (envelope ainda cru) |
| `assistant` | resposta do agente | `parts: ContentPart[]` |
| `meta-decision` | decisão de roteamento/modelo | `text` |
| `chip` | **linha única colapsada** — o cavalo de batalha | `chip{icon,label,summary,accent}`, `expandBody`, `classifierKind`, `tone` |
| `sidechain-group` | um subagente | `rootUuid`, `count`, `durMs`, `parentUuids` |
| `sidechain-cluster` | 2+ subagentes consecutivos | `groups[]`, `subagentCount`, `totalDurMs` |
| `ask-user` | pergunta do MCP `ask-user` | `entry` — **não vem do JSONL**, vem do evento SSE `ask_user` |

O `chip` é onde mora a maior parte da tela: ele carrega o resultado de
`chat-payload-classifier.ts` (13 KB) e é o item que o `tool_use`/`tool_result`
vira. **É nele que o "amei" do Rica se decide** — 82% dos blocos gravados são
`tool_use`/`tool_result`, contra 18% de prosa.

---

## 3. Envio: a função única já existe, e o nome dela é `useAgentSend`

A fusão pede "a função única `sendText(slug, texto)` que composer e voz
compartilham". **Ela já está escrita** em `lib/use-agent-send.ts` (120 linhas) — não
é para inventar, é para portar:

```ts
useAgentSend(slug: string, agentName: string): {
  sending: boolean;
  sendText:  (text: string, options?: { fresh?: boolean }) => Promise<void>;
  sendImage: (file: File, caption?: string) => Promise<void>;
  sendVoice: (blob: Blob) => Promise<void>;
}
```

Os três caminhos já convergem: cada um bate no seu endpoint, todos checam
`res.tmux_delivered` e caem no mesmo tratamento de erro. O que o v2 herda de graça:

- **`tmux_delivered: false` não é erro** — é "não confirmado", e o aviso é *"pane
  fora do CLI esperado"*. Tela que trata isso como falha mente para o Rica.
- **HTTP 409 com `detail: 'agent_pane_unavailable'`** tem mensagem própria: o
  agente está num shell auxiliar em vez do Claude/Codex.
- `sendText` **repropaga** a exceção depois de mostrar o toast, de propósito: quem
  chama precisa marcar a mensagem otimista como `error`.

⚠️ **`postAgentImage` é stub e lança `NotImplementedError`** — o endpoint
`POST /api/agents/{slug}/image` não existe no back. O botão de imagem no v2 nasce
desligado, ou nasce junto com o endpoint. Não é bug do front.

---

## 4. Protocolo SSE — o que o front recebe

Eventos nomeados em `lib/use-messages-stream.ts`:

```
replay-start  →  N × message  →  replay-end  →  live: message | heartbeat | ask_user | error
```

- Cursor de reconexão é o `id` do evento (`task_events.id`); o servidor honra
  `Last-Event-ID`.
- Estados do hook: `idle | connecting | replaying | live | error | closed`.
- **`heartbeat` é sinal de vida, não dado.** Sumiço de heartbeat é o gatilho de
  "reconectando", que o gate exige aparecer em poucos segundos.

Números do baseline (sessão `pavan`, medidos, ver `fixtures/cockpit-v2/README.md`):
replay de **15,9 MB em 3.080 eventos**, com o servidor gastando **202 ms**. O custo
não está no back — está no cliente. Qualquer arquitetura de front que refaça
trabalho por chunk perde.

---

## 5. A matriz payload → renderer: 52 famílias gravadas

Em `fixtures/cockpit-v2/familias/`, uma por arquivo, redigidas (sem dado privado) e
versionadas. Nomes são o contrato:

| prefixo | quantas | o que é |
|---|---|---|
| `bloco__*` | 3 | `text` (330 ocorrências), `thinking` (804), `tool_result` (1.499) |
| `borda__*` | 2 | os dois casos que quebram implementação ingênua |
| `tool__*` | 23 | uma por tool vista, de `Bash` a `mcp__supabase_geral__execute_sql` |
| `result__*` | 24 | as formas distintas de `tool_use_result`, nomeadas pelas chaves |

**As duas bordas são obrigatórias em qualquer renderer novo**, e apareceram sem
ninguém procurar:

- `borda__content_none` — **199 mensagens com `content: null`**
- `borda__content_string` — **87 com `content` como string** em vez de array

Ler `familias/_indice.json` para a contagem de ocorrências de cada família: ela diz
o que é comum e o que é cauda longa, e portanto em que ordem construir.

Regra de manutenção: **renderer novo entra com a família correspondente citada**.
Se a família não existe nas fixtures, ela é gravada antes — nunca se escreve
renderer contra payload imaginado. Fluxo na skill `novo-renderer`.

---

## 6. O que este contrato deliberadamente não fixa

- **Como** o estado é guardado (store, context, biblioteca) — é o objeto do spike
  do passo 5.
- Qual componente desenha cada `kind` — é ownership, ver `cockpit-v2-ownership.md`.
- Cor, espaçamento, tipografia — é a pele, ver `cockpit-v2-estetica.md`.

O que ele fixa é o que **não pode divergir entre as frentes**: nomes, assinaturas,
ordem de composição, semântica dos campos e as bordas.
