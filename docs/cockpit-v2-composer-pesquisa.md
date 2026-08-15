# Pesquisa — Composer e Feed de chat com agente de IA (melhores práticas com fonte)

> **Escopo.** Painel web Next.js 16 + React 19 + Tailwind 4 que conversa com agentes de CLI (Claude Code e Codex). Entrada por texto, áudio e foto. Mensagens chegam por *polling* (consulta periódica) de uma API. Alvo: os 4 defeitos reclamados — render divergente entre provedores, truncamento, mensagem externa sem fila, composer travado durante o "pensando".
>
> **Como ler.** Cada recomendação traz **o que fazer · por quê · fonte**. Fonte = URL oficial, ou lib+versão, ou trecho de código-fonte real de implementação de referência (Vercel AI Elements, assistant-ui, LibreChat, Open WebUI). Onde não achei fonte autoritativa, está marcado.
>
> Data da pesquisa: 2026-08-15.

---

## Sumário executivo — os 4 defeitos e a causa provável

| Defeito | Diagnóstico da literatura | Seção |
|---|---|---|
| 1. Codex e Claude Code renderizam diferente | Falta de **normalizador** (*adapter/anti-corruption layer*) — os dois CLIs emitem NDJSON estruturalmente diferentes e a UI está renderizando cada um cru | **D** |
| 2. "Tudo sai truncado" | 6 camadas possíveis; a bissecção por camada resolve em 10 min. Suspeitos nº1 neste stack: `overflow-hidden` no corpo markdown + `min-content` do flex, e cortes duros no backend | **C** |
| 3. Mensagem externa (Telegram) não entra em fila e sai quebrada | Falta de **fila do lado do servidor** com semântica declarada (*enqueue* vs *steer* vs *interrupt*). O padrão da indústria tem nome: **double texting** | **A** |
| 4. Composer não deixa enviar enquanto pensa | **Anti-padrão documentado.** Nenhuma implementação de referência desabilita o `textarea`; elas trocam o botão Enviar por Parar e enfileiram | **A** |

---

# A) Fila de mensagens durante streaming/busy

## A.1 O consenso: o problema tem nome — *double texting*

**O que fazer:** parar de tratar "usuário mandou enquanto o agente responde" como caso de erro. É um caso de uso nomeado e com taxonomia estabelecida.

**Por quê:** a LangChain documenta o cenário exatamente assim — *"a user may send one message and before the graph has finished running send a second message"* — e define **quatro estratégias**, com `enqueue` como **padrão**:

- **Enqueue** (padrão) — *"This option allows the current run to finish before processing any new input."*
- **Reject** — *"rejects any additional incoming runs while a current run is in progress"*
- **Interrupt** — *"halts the current execution and preserves the progress made up to the interruption point"*; a nova entrada retoma daquele estado
- **Rollback** — *"halts the current execution and reverts all progress—including the initial run input—before processing the new user input"*

> Fonte: https://docs.langchain.com/langgraph-platform/double-texting · how-tos por estratégia em https://langchain-ai.github.io/langgraph/cloud/how-tos/enqueue_concurrent/ , `.../reject_concurrent/` , `.../rollback_concurrent/`

**Aplicação direta:** o parâmetro é `multitaskStrategy: "enqueue"` na submissão. O `useSubmissionQueue` expõe `queue.entries`, `queue.size`, `queue.cancel(id)`, `queue.clear()`; cada entrada tem `id`, `values`, `options`, `createdAt`. Restrição citada literalmente: *"Cancelling a queue entry only affects messages that have not yet started processing. If the agent is already working on a message, cancelling it from the queue has no effect."*
> Fonte: https://docs.langchain.com/oss/python/langchain/frontend/message-queues

## A.2 Steer vs Queue — duas coisas diferentes, não uma

**O que fazer:** implementar **dois** caminhos, não um. "Mandar durante o turno" e "mandar para depois do turno" são intenções diferentes do usuário.

**Por quê:** a doc do GitHub Copilot SDK separa formalmente, via campo `mode` em `MessageOptions` (padrão `"enqueue"`):

- **Steering (`"immediate"`)** — *"Injected into the **current** LLM turn"*. Caso de uso citado: *"Actually, don't create that file—use a different approach"*. Mecânica: entra no `ImmediatePromptProcessor`; antes da próxima requisição ao LLM **dentro do turno atual**, a mensagem é injetada como nova mensagem de usuário. Ressalva literal: *"Steering messages are best-effort within the current turn. If the agent has already committed to a tool call, the steering takes effect after that call completes but still within the same turn."*
- **Queueing (`"enqueue"`)** — *"Queued and processed **after** the current turn finishes"*. Caso de uso: *"After this, also fix the tests"*. Mecânica: vira `QueuedItem` no `itemQueue`; quando o turno acaba e a sessão fica ociosa, `processQueuedItems()` roda em ordem FIFO, **cada mensagem gerando um turno agêntico completo**. Steers pendentes no fim do turno vão para a **frente** da fila.

Regra de escolha, literal: use steering quando *"the agent is actively doing the wrong thing and you need to redirect it before it goes further"*; use queueing para cadeias sequenciais em que *"each gets its own full turn with clean context"*.

> Fonte: https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/steering-and-queueing

**Variante com mais modos** (OpenClaw, 4 modos + política de overflow):
- **Steer (padrão)** — injeta no runtime ativo; *"lets an already-running tool finish, skips sequential calls that have not started"*
- **Followup** — enfileira individualmente, preserva ordem
- **Collect** — coalesce várias mensagens num turno só depois de uma janela de silêncio; *"messages targeting different channels/threads drain individually to preserve routing"* ← **isso é exatamente o caso Telegram × web do produto**
- **Interrupt** — aborta o run e executa a mais nova

Overflow: teto padrão 20 mensagens; `drop: "summarize"` (padrão — as mais antigas viram um prompt-resumo sintético), `drop: "old"`, `drop: "new"`. Debounce embutido de 500 ms. E a nota de UX: *"typing indicators still fire immediately on enqueue... so user experience is unchanged while the run waits its turn."*
> Fonte: https://docs.openclaw.ai/concepts/queue

## A.3 Desabilitar o input é anti-padrão — a evidência

**O que fazer:** **nunca** desabilitar o `textarea`. Trocar o botão Enviar por Parar, e enfileirar o envio.

**Por quê — quatro provas independentes:**

**(1) A implementação de referência da própria Vercel não desabilita.** No código real de `ai-elements` (`packages/elements/src/prompt-input.tsx`), o `PromptInputTextarea` **não tem nenhum `disabled` ligado a `status`**. O único componente que reage a `status` é o botão:

```tsx
const isGenerating = status === "submitted" || status === "streaming";
// ...
if (status === "submitted")      Icon = <Spinner />;
else if (status === "streaming") Icon = <SquareIcon />;   // ícone de parar
else if (status === "error")     Icon = <XIcon />;
// ...
<InputGroupButton
  aria-label={isGenerating ? "Stop" : "Submit"}
  type={isGenerating && onStop ? "button" : "submit"}
  onClick={handleClick}   // se isGenerating && onStop => e.preventDefault(); onStop();
/>
```
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx (linhas 1211-1263)

⚠️ **Contradição interna da Vercel, importante saber:** o *snippet* da documentação do AI SDK usa `disabled={status !== 'ready'}` no input. Ou seja, quem copiou o exemplo da doc herdou o defeito nº 4. A **biblioteca de componentes** deles não faz isso.
> Fonte do snippet: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot

**(2) assistant-ui separa explicitamente os dois estados.** A `ExternalStoreAdapter` tem **dois** campos distintos:
- `isDisabled` (padrão `false`) — *"Disables entire composer"*
- `isSendDisabled` (padrão `false`) — *"Blocks sending only; **input stays usable**"*

E na doc do primitivo: *"**Input remains usable during thread execution.**"* Só o `Send` fica desabilitado (*"Disabled When: Thread running, composer empty, or not in editing mode"*).
> Fontes: https://www.assistant-ui.com/docs/runtimes/custom/external-store · https://www.assistant-ui.com/docs/api-reference/primitives/composer.md

**(3) Amarrar `disabled` a `status` é frágil na prática.** Bug real no `vercel/ai`: depois de chamar `stop()`, o `status` não voltava para `ready`. Citação do relator: *"the status remains unchanged thus leading to UI issues where, for example, **a send button might still be disabled** even tho the chat was successfully stopped."* (fechado via PR #4897, mas a classe de bug permanece: um único caminho que esquece de resetar o estado trava o composer para sempre).
> Fonte: https://github.com/vercel/ai/issues/4891

**(4) Em ferramentas agênticas, perder a capacidade de digitar é tratado como REGRESSÃO.** No repositório do Claude Code: *"[BUG] Regression: Can no longer type/queue messages while agent is running (Desktop App)"*.
> Fonte: https://github.com/anthropics/claude-code/issues/57497

## A.4 A fila tem que morar no SERVIDOR quando há mais de um canal

**O que fazer:** a fila canônica fica no serviço que dona a sessão do agente, **não** no estado React do painel. O painel tem uma fila *de apresentação* (o que ele mesmo enfileirou), espelhada da do servidor.

**Por quê:** a mensagem do Telegram nunca passa pelo React. Se a fila mora no cliente, mensagem de canal externo não tem onde entrar — que é literalmente o defeito nº 3. Todas as implementações que suportam múltiplos canais põem a fila no servidor:
- OpenClaw: fila por *session lane*, com roteamento por canal preservado no modo `collect`
- Copilot SDK: `itemQueue` **da sessão**, drenada por `processQueuedItems()` quando a sessão fica ociosa
- LangGraph Platform: `multitask_strategy` é parâmetro da **run** no servidor
- Happier (produto que resolve exatamente "mandar do celular pro agente ocupado"): *"Pending queue means: 'store this message with the session; I'll decide when/how it runs.'"* — e a orientação de UX: *"If you're unsure: queue it. It's easier to edit/reorder a pending message than to undo a rushed interruption."*
> Fonte: https://guides.happier.dev/how-to-queue-messages-from-your-phone-while-an-agent-is-busy

## A.5 A armadilha específica de agente de CLI: "fim do turno" ≠ "próxima pausa do LLM"

**O que fazer:** drenar a fila no **fim de turno real**, não na primeira pausa entre chamadas de ferramenta.

**Por quê:** é a reclamação nº1 sobre o queueing do Claude Code. Issues abertas:
- *"Queue messages to send at true end-of-turn, not next LLM pause"* — mensagens digitadas durante o trabalho *"all flush at the next LLM pause, not at true end-of-turn, including pauses between tool calls or after a subagent returns, meaning queued messages often get injected mid-task and derail whatever Claude was doing."*
> https://github.com/anthropics/claude-code/issues/49373
- *"Queued messages typed during Claude's response are misinterpreted as replies to that response"* — a mensagem foi escrita reagindo a algo **anterior**, mas chega como resposta ao que acabou de sair.
> https://github.com/anthropics/claude-code/issues/57624 · https://github.com/anthropics/claude-code/issues/26388
- *"[FEATURE] Side-channel responses for queued messages during active task execution"*
> https://github.com/anthropics/claude-code/issues/29224

**Consequência de design:** ao enfileirar, **carimbe a âncora** — a que ponto da conversa a mensagem estava respondendo (id da última mensagem visível quando o usuário digitou). Sem isso, o item drenado chega descontextualizado. Nenhuma das docs oficiais prescreve isso; é a inferência direta das issues acima, e o LibreChat implementa algo equivalente (§A.6, `expectedPredecessorCreatedAt`).

## A.6 Implementação de referência mais completa: LibreChat

O `useSteering` do LibreChat é o estado da arte aberto para este problema. Fatos do código-fonte:

```ts
/** During-run submit routes: inject into the live run, or queue for after it. */
export type DuringRunAction = 'steer' | 'queue';

export interface QueuedMessageContext {
  quotes?: string[];
  manualSkills?: string[];
  clientRequestId?: string;
  recoverySteerId?: string;
  expectedPredecessorCreatedAt?: number;   // <- a âncora do §A.5
  queuedMessageOrigin?: QueuedMessageOrigin;
}

type SteerErrorCode = 'NO_ACTIVE_RUN' | 'RUN_PAUSED' | 'RUN_REPLACED'
                    | 'STEER_QUEUE_FULL' | 'STEER_UNSUPPORTED' | string;
```
> Fonte: https://github.com/danny-avila/LibreChat/blob/main/client/src/hooks/Chat/useSteering.ts

Estado, com os comentários originais:
```ts
/** Per-conversation steers awaiting injection. Reconciled against the server:
 *  `on_steer_applied` removes its chip; `sync`/`resumeState.pendingSteers`
 *  replaces the list on reconnect; run-end reports convert leftovers into
 *  `queuedMessagesByConvoId` entries. */
const pendingSteersByConvoId = atomFamily<PendingSteer[], string>(...)

/** Per-conversation client-side queue of follow-up messages. Drained one per
 *  run completion by `useQueueDrain` (each dequeued message starts a normal
 *  turn whose own final event drains the next). */
const queuedMessagesByConvoId = atomFamily<QueuedMessage[], string>(...)
```
> Fonte: https://github.com/danny-avila/LibreChat/blob/main/client/src/store/families.ts

**Teclado durante o run** (comentário literal do `ChatForm.tsx`):
```
/** ⌘/Ctrl+Enter = the non-default during-run action, ⌥/Alt+Enter =
 *  interrupt & send (discards the answer), ⌘/Ctrl+Shift+Enter = interrupt &
 *  steer (keeps it) — all counterparts of Enter's `submitDuringRun`. */
// "Enter stays live during a run when it can steer/queue instead of send."
```
> Fonte: https://github.com/danny-avila/LibreChat/blob/main/client/src/components/Chat/Input/ChatForm.tsx (linhas 353-393)

Detalhes de robustez que valem copiar:
- `clientSteerId` — *"Stable across transport retries so the server can dedupe a committed POST"* (chave de idempotência)
- `generationCreatedAt` — *"Preserve the generation identity on retries instead of targeting a newer turn that may now occupy the same conversation-scoped stream id"*
- Reconciliação na reconexão via `resumeState.pendingSteers` — a fila sobrevive a um F5

## A.7 assistant-ui — a fila pronta, se o front for React

**O que fazer:** se a arquitetura permitir, não escrever a fila do zero no cliente. O assistant-ui tem `createMessageQueue` de primeira classe.

```ts
const [queue] = useState(() => createMessageQueue({ run: onNew }));
const runtime = useExternalStoreRuntime({ messages, isRunning, onNew, queue: queue.adapter });

const wasRunning = useRef(isRunning);
useEffect(() => {
  if (!wasRunning.current && isRunning) queue.notifyBusy();
  if (wasRunning.current && !isRunning) queue.notifyIdle();
  wasRunning.current = isRunning;
}, [isRunning, queue]);
```

Semântica documentada:
- Duas pistas: `steerItems` (processada primeiro) e `items`
- *"cancelling pauses the queue for you: the runtime tells the queue before your onCancel runs"* — chamar `queue.clear()` em `onCancel`/`onEdit`/`onReload` para descartar itens obsoletos
- *"The pending message is exposed on `composer.queue` and renders through `ComposerPrimitive.Queue`"* — ou seja, **a fila é visível na UI**, com `QueueItemPrimitive` por item
- Por padrão enviar durante o run é bloqueado; **é o adaptador de fila que destrava**

> Fonte: https://www.assistant-ui.com/docs/runtimes/custom/external-store

## A.8 UX da fila — o que mostrar

Recomendações literais da doc da LangChain (única fonte que prescreve UX de fila explicitamente):
- Mostrar **preview** de cada mensagem enfileirada para o usuário *"quickly identify which items to cancel"*
- **Numerar** os itens para indicar ordem de processamento
- **Manter o foco no input** depois de submeter, para digitar em sequência
- **Avisar** quando a fila passa de ~10 itens
- **Animar** a transição de "enfileirado" → "processando"
- Falha de um item **não bloqueia** os seguintes
> Fonte: https://docs.langchain.com/oss/python/langchain/frontend/message-queues

## A.9 Barge-in / interrupção

**O que fazer:** oferecer interrupção como ação **explícita e distinta**, nunca como efeito colateral de enviar.

**Por quê:** os quatro modos (`reject`/`enqueue`/`interrupt`/`rollback`) existem porque descartam trabalho de formas diferentes. `interrupt` *preserva* o progresso; `rollback` *apaga* o run inteiro do banco e ele *"cannot be restarted"*. Fazer o Enter escolher isso sozinho é decidir pelo usuário o que jogar fora.
> Fonte: https://docs.langchain.com/langgraph-platform/double-texting

Atalhos de teclado com precedente:
- **Escape = parar geração** — Open WebUI: `if (e.key === 'Escape') { stopResponse(); }`
  > https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/MessageInput.svelte (linha 1804)
- **Alt+Enter / Cmd+Shift+Enter = interromper e enviar/dirigir** — LibreChat (§A.6)

Ressalva de mecânica em agente com ferramentas (Copilot SDK): *"If the agent has already committed to a tool call, the steering takes effect after that call completes"* — a UI não deve prometer interrupção instantânea.

## A.10 Recomendação para ESTE produto

1. **Servidor:** uma fila por sessão de agente, com `mode ∈ {steer, enqueue, interrupt}` e padrão `enqueue`. Roteamento preservado por canal de origem (`origin: telegram|web|whatsapp`) — o modo `collect` do OpenClaw drena separado por canal justamente para não misturar destino de resposta.
2. **Drenagem:** no **fim de turno real** do CLI (evento terminal do NDJSON — `result` no Claude Code, `turn.completed` no Codex), não em pausa entre ferramentas.
3. **Âncora:** cada item enfileirado carrega o id da última mensagem visível no momento em que foi escrito.
4. **Idempotência:** `clientRequestId` gerado no cliente, dedupe no servidor (evita duplicata em retry de rede).
5. **Painel:** `textarea` **sempre habilitado**. Botão vira Parar durante o run. Itens enfileirados aparecem acima do composer, numerados, com botão de cancelar por item.
6. **API de polling:** expor `queue: [...]` junto com as mensagens, para o painel espelhar a fila do servidor (inclusive itens que vieram do Telegram).

---

# B) Composer — checklist do que NÃO pode faltar

> A referência mais rica é o código real do `PromptInput` da Vercel (AI Elements) e do `MessageInput.svelte` do Open WebUI. Os dois foram lidos direto do fonte; citações abaixo são literais.

## B.1 Auto-resize do textarea

**O que fazer:** `field-sizing: content` + `min-height` + `max-height`, com scroll ao atingir o teto. Fallback em JS só se precisar suportar navegador antigo.

**Por quê:** é o que a Vercel usa hoje, em uma linha de Tailwind 4:
```tsx
<InputGroupTextarea className={cn("field-sizing-content max-h-48 min-h-16", className)} ... />
```
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx (linha 1058)

Tailwind 4 tem as utilidades nativas: `field-sizing-content` → `field-sizing: content`; `field-sizing-fixed` → `field-sizing: fixed`. Suportam prefixo de breakpoint.
> Fonte: https://tailwindcss.com/docs/field-sizing

Mecânica e pegadinhas (MDN):
- `content` permite *"shrinkwrap"*: cresce no eixo inline até bater `min-width`, depois cresce em altura, *"Once max-height is reached, shows a scrollbar"*
- ⚠️ **`rows` e `cols` param de funcionar**: *"`rows`/`cols` have no effect on `<textarea>` elements with `field-sizing: content` set"*
- Status: **Baseline 2026** — *"Newly available since June 2026"*. Ou seja: é novo. Se o público inclui navegador de 2024/2025, mantenha um fallback (`react-textarea-autosize` ou medir `scrollHeight`).
> Fonte: https://developer.mozilla.org/en-US/docs/Web/CSS/field-sizing

## B.2 Enter vs Shift+Enter — e o modo mobile

**O que fazer:** Enter envia, Shift+Enter quebra linha, **em desktop**. Em dispositivo de toque, Enter quebra linha e o **botão Enviar é obrigatório**. Oferecer `Ctrl/Cmd+Enter` como preferência.

**Por quê — três fontes convergentes:**

assistant-ui expõe isso como prop de primeiro nível (`ComposerPrimitive.Input`):
- `submitMode: "enter" | "ctrlEnter" | "none"` (padrão `"enter"`)
  - `"enter"`: *"Plain Enter submits (Shift+Enter for newline)"*
  - `"ctrlEnter"`: *"Ctrl/Cmd+Enter submits (plain Enter for newline)"*
  - `"none"`: *"Keyboard submission disabled"*
- `unstable_insertNewlineOnTouchEnter` (padrão `false`) — *"switches behavior on touch-primary devices so Enter inserts a newline instead of submitting, keeping the Send button as the primary submission method"*
- `cancelOnEscape` (padrão `true`)
> Fonte: https://www.assistant-ui.com/docs/api-reference/primitives/composer.md

Open WebUI **pula o ramo inteiro de Enter-envia em touch**:
```js
if (!$mobile || !('ontouchstart' in window || navigator.maxTouchPoints > 0
                  || navigator.msMaxTouchPoints > 0)) {
   /* só aqui Enter envia */
}
```
E torna `ctrlEnterToSend` uma configuração do usuário.
> Fonte: https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/MessageInput.svelte (linhas 1825-1853)

Vercel AI Elements, do fonte: *"Enter: Submits the form / Shift+Enter: Inserts new line without submitting"*.
> Fonte: https://github.com/vercel/ai-elements/blob/main/skills/ai-elements/references/prompt-input.md

**Extra de mobile:** `enterkeyhint="send"` no textarea — muda o rótulo da tecla no teclado virtual. Valores documentados: `enter`, `done`, `go`, `next`, `previous`, `search`, `send`. Para chat: `send` — *"Typically delivering the text to its target."*
> Fonte: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint

## B.3 IME / composição — obrigatório, e mais difícil do que parece

**O que fazer:** ignorar o Enter enquanto houver composição ativa. **E** tratar o bug do Safari, que a checagem padrão não cobre.

**Nível 1 — a checagem canônica.** `KeyboardEvent.isComposing` *"returns a boolean value indicating if the event is fired within a composition session, i.e., after `compositionstart` and before `compositionend`"*.
> Fonte: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing

Vercel faz **cinto e suspensório** — estado próprio + a propriedade nativa:
```tsx
const [isComposing, setIsComposing] = useState(false);
// ...
if (e.key === "Enter") {
  if (isComposing || e.nativeEvent.isComposing) return;   // <-- os dois
  if (e.shiftKey) return;
  e.preventDefault();
  // ...
  form?.requestSubmit();
}
// ...
onCompositionStart={() => setIsComposing(true)}
onCompositionEnd={() => setIsComposing(false)}
```
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx (linhas 965-1063)

**Nível 2 — o bug do Safari, com correção documentada.** Open WebUI mantém um guarda extra por timestamp, com o comentário original:
```js
let compositionEndedAt = -2e8;
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
function inOrNearComposition(event) {
  if (isComposing) return true;
  // Safari has a bug where compositionend is not triggered correctly #16615
  // when using the virtual keyboard on iOS.
  // On Japanese IMEs, the Enter key is used to confirm character selection.
  // On Safari, when Enter is pressed, compositionend AND keydown are emitted.
  // The keydown event triggers newline insertion, which we don't want.
  // We only ignore it once, as pressing Enter a second time *should* insert a newline.
  if (isSafari && Math.abs(event.timeStamp - compositionEndedAt) < 500) {
    compositionEndedAt = -2e8;
    return true;
  }
  return false;
}
```
Eles também usam `(e.key === 'Enter' || e.keyCode === 13)` com o comentário *"Uses keyCode '13' for Enter key for chinese/japanese keyboards."*
> Fontes: https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/MessageInput.svelte (linhas 562-586, 1838-1845) · issue https://github.com/open-webui/open-webui/issues/16615 · artigo referenciado no próprio código: https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/

**Vale para português também.** Dead keys (´, `, ^, ~) abrem sessão de composição em vários layouts/SO. Sem o guarda, `Enter` logo após um acento pode disparar envio no meio da composição do caractere. Não achei uma issue pública específica de PT-BR — a base é o mesmo mecanismo `compositionstart`/`compositionend` do MDN acima.

## B.4 Colar imagem da área de transferência

**O que fazer:** `onPaste` lendo `clipboardData.items`, `item.kind === 'file'` → `item.getAsFile()`, e `preventDefault()` **só se** houve arquivo.

**Por quê / referência:**
```tsx
const items = event.clipboardData?.items;
const files: File[] = [];
for (const item of items) {
  if (item.kind === "file") { const f = item.getAsFile(); if (f) files.push(f); }
}
if (files.length > 0) { event.preventDefault(); attachments.add(files); }
```
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx (linhas 1014-1039)

assistant-ui tem `addAttachmentOnPaste` (padrão `true`).
> Fonte: https://www.assistant-ui.com/docs/api-reference/primitives/composer.md

**Bônus com precedente:** texto colado muito grande vira anexo `.txt` em vez de entupir o composer. Open WebUI: `largeTextAsFile` + `PASTED_TEXT_CHARACTER_LIMIT` → cria `File` e chama `uploadFileHandler`.
> Fonte: https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/MessageInput.svelte (linhas 1876-1892)

## B.5 Arrastar e soltar (drag & drop)

**O que fazer:** `dragover` com `preventDefault()` **obrigatório** (sem isso o drop não acontece), listener no `<form>` e opcionalmente no `document`. Estado visual de "arrastando".

**Referência:** a Vercel registra nos dois níveis, com opção `globalDrop` — *"Accepts file drops anywhere on document"*:
```tsx
const onDragOver = (e: DragEvent) => { /* se tem arquivo */ e.preventDefault(); };
const onDrop     = (e: DragEvent) => { /* se tem arquivo */ e.preventDefault(); ... };
form.addEventListener("dragover", onDragOver);
form.addEventListener("drop", onDrop);
// e, com globalDrop: document.addEventListener(...)
```
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx (linhas 743-786)

assistant-ui: `ComposerPrimitive.AttachmentDropzone` — *"Sets `data-dragging` when a file is being dragged over"*, ignora drags que não são de arquivo (texto, link), e fica inerte se o runtime não tem capacidade de anexo.
> Fonte: https://www.assistant-ui.com/docs/primitives/composer

## B.6 Preview de anexo com remover — e o vazamento de object URL

**O que fazer:** chip por anexo com botão remover; `URL.createObjectURL` para o preview e **`revokeObjectURL` em toda saída** (remover 1, limpar tudo, desmontar, enviar).

**Por quê:** object URL segura o `File`/`Blob` em memória até ser revogado. O fonte da Vercel revoga em **cinco** pontos distintos (remover item, limpar, desmontar, trocar de anexos, submeter):
```tsx
url: URL.createObjectURL(file)      // linhas 277, 620
URL.revokeObjectURL(found.url)      // linhas 286, 634  (remover 1)
URL.revokeObjectURL(f.url)          // linhas 296, 315, 692, 795 (clear / cleanup)
```
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx

API de anexos (hook `usePromptInputAttachments()`): `files`, `add(files)`, `remove(id)`, `clear()`, `openFileDialog()`. Restrições configuráveis: `accept`, `multiple`, `maxFiles`, `maxFileSize`, `onError`.
> Fonte: https://github.com/vercel/ai-elements/blob/main/skills/ai-elements/references/prompt-input.md

**Atalho que vale copiar:** Backspace com o campo vazio remove o último anexo.
```tsx
if (e.key === "Backspace" && e.currentTarget.value === "" && attachments.files.length > 0) {
  e.preventDefault();
  attachments.remove(attachments.files.at(-1).id);
}
```
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx (linhas 998-1009)

## B.7 Envio otimista

**O que fazer:** a mensagem aparece no feed no instante do Enter, com estado "enviando", **id gerado no cliente** que o servidor devolve.

**Por quê e a armadilha:** o `useOptimistic` do React 19 existe pra isso, mas tem uma restrição dura que morde num feed alimentado por polling:

```js
const [optimisticState, setOptimistic] = useOptimistic(value, reducer?);
```
- *"The `set` function **must be called inside an Action**. If you call the setter outside an Action, React will show a warning and the optimistic state will briefly render."*
- O estado otimista é **temporário**: só vive enquanto a Action está pendente. *"There's no extra render to 'clear' the optimistic state. The optimistic and real state converge in the same render when the Transition completes."*
> Fonte: https://react.dev/reference/react/useOptimistic

⚠️ **Consequência prática:** se a Action termina (POST respondeu 200) mas o **polling** ainda não trouxe a mensagem, o `value` real não tem a mensagem e ela **some da tela** até o próximo poll. Duas saídas: (a) a Action só resolve depois de escrever a mensagem confirmada no estado real; (b) não usar `useOptimistic` — manter uma lista de "pendentes" no estado normal, com merge por id. Bugs relacionados: https://github.com/facebook/react/issues/31967 (*"useOptimistic rolls back the state for no reason"*), https://github.com/facebook/react/issues/31020

**Chave de idempotência:** id gerado no cliente (UUIDv4), enviado no request, ecoado pelo servidor. Isso é o que permite (i) deduplicar retry de rede e (ii) fazer a transição otimista→confirmada ser **mudança de props na mesma `key`**, não unmount/remount. Precedente no LibreChat: `clientRequestId` / `clientSteerId` — *"Stable across transport retries so the server can dedupe a committed POST"*.
> Fonte: https://github.com/danny-avila/LibreChat/blob/main/client/src/hooks/Chat/useSteering.ts

## B.8 Foco preservado depois do envio

**O que fazer:** não perder o foco do textarea ao enviar; e devolver o foco em eventos de contexto.

**Referência:** assistant-ui tem três flags, todas **padrão `true`**: `unstable_focusOnRunStart`, `unstable_focusOnScrollToBottom`, `unstable_focusOnThreadSwitched`.
> Fonte: https://www.assistant-ui.com/docs/api-reference/primitives/composer.md

E a doc de fila da LangChain lista explicitamente *"Keeping input focused after submission for rapid typing"*.
> Fonte: https://docs.langchain.com/oss/python/langchain/frontend/message-queues

## B.9 Acessibilidade

**O que fazer:**

**(a) O feed é uma live region do tipo log.** `role="log"`:
- *"A log is a type of live region where new information is added in meaningful order and old information may disappear. Examples include **chat logs, messaging history**, game log, or an error log."*
- *"Elements with the role `log` have an implicit `aria-live` value of **polite**"* — não precisa (nem deve) somar `aria-live="assertive"`
- *"implicit `aria-atomic` value of `false`"* — só o que mudou é anunciado
- *"The `log` is **required to have an accessible name**. Use `aria-labelledby` if a visible label is present, otherwise use `aria-label`."*
> Fonte: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role

A Vercel faz exatamente isso no `Conversation`:
```tsx
<StickToBottom className="relative flex-1 overflow-y-hidden"
               initial="smooth" resize="smooth" role="log" {...props} />
```
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/conversation.tsx (linha 20)

**(b) `assertive` é para exceção, não para streaming.** *"`aria-live="assertive"` should only be used for time-sensitive/critical notifications... the notification will interrupt the screen reader from its current task."* Streaming token a token em região assertiva = leitor de tela inutilizável.
> Fonte: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions

**(c) Quando o feed carrega histórico dinamicamente**, o padrão do W3C APG é `role="feed"`, não `log`: *"a feed is a structure, not a widget"*, com contrato explícito — `aria-busy` no container durante atualização, `aria-labelledby`/`aria-describedby`/`aria-posinset`/`aria-setsize` em cada `<article>`, e teclado Page Down/Page Up (próximo/anterior artigo), Ctrl+End/Ctrl+Home.
> Fonte: https://www.w3.org/WAI/ARIA/apg/patterns/feed/
>
> **Recomendação:** transcript de chat sequencial → `role="log"` (é o que a indústria usa). Feed com scroll infinito de artigos → `role="feed"`. Não empilhar os dois.

**(d) Botão que muda de função muda de nome acessível.** Vercel: `aria-label={isGenerating ? "Stop" : "Submit"}`; o input de arquivo tem `aria-label="Upload files"`.
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx (linhas 910, 1252)

**(e) Live region tem que existir vazia antes.** *"The live region must be empty on page load or when it's first added to the DOM... if adding the live region to the DOM dynamically, it's best practice to wait at least 2 seconds for the accessibility API to identify it before injecting any text."*
> Fonte: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions

## B.10 Limite de caracteres

**O que fazer:** mostrar contador só quando estiver perto do teto; nunca cortar silenciosamente.

Não encontrei doc oficial de UX prescrevendo o formato exato. O que há de concreto:
- Vercel tem `maxFileSize` / `maxFiles` com `onError` — validação de **anexo** com erro explícito, não corte silencioso
  > https://github.com/vercel/ai-elements/blob/main/skills/ai-elements/references/prompt-input.md
- Open WebUI converte texto grande em arquivo em vez de recusar (`PASTED_TEXT_CHARACTER_LIMIT`) — degradação graciosa
- LangChain: avisar quando a fila passa de ~10 itens (mesma filosofia aplicada à fila)

Regra derivada dos limites reais de transporte (§C): o teto do composer tem que ser **menor** que o menor limite de corpo do caminho (Vercel = 4,5 MB; nginx `client_max_body_size` = 1 MB por padrão), senão o usuário descobre o limite via 413.

## B.11 Rascunho e posição de scroll preservados

**O que fazer:** persistir o texto do composer por conversa; restaurar ao voltar.

**Precedente:** LibreChat tem `clearAllDrafts` como utilitário de primeira classe, e `carriedSteerContext` para carregar contexto do composer entre estados.
> Fonte: https://github.com/danny-avila/LibreChat/blob/main/client/src/hooks/Chat/useSteering.ts (imports)

Para scroll, ver §E.4 — `<Activity>` do React 19.2 restaura scroll ao reexibir, e `use-stick-to-bottom` mantém a âncora.

## B.12 Indicação de "enviando"

Estados mínimos, com o vocabulário do AI SDK (`ChatStatus`): `submitted` (aguardando o stream começar) → `streaming` (recebendo) → `ready` → `error`.
> Fonte: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot

Mapeamento visual do fonte da Vercel: `submitted` → spinner; `streaming` → quadrado (parar); `error` → X.
> Fonte: https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx (linhas 1230-1236)

## B.13 Afordâncias extras com precedente

- **ArrowUp com campo vazio = editar última mensagem do usuário** (convenção de terminal). Open WebUI implementa.
  > https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/MessageInput.svelte (linhas 1808-1823)
- **`compact`** — composer colapsa para uma linha quando não há anexo/citação (assistant-ui `ComposerPrimitive.Root`)
- **Clicar no espaço vazio do composer foca o input** (assistant-ui, comportamento documentado do `Root`)
- **Menu de ações** com "adicionar anexo" e "captura de tela" (Vercel: `PromptInputActionAddAttachments`, `PromptInputActionAddScreenshot`)
- **Ditado** (`ComposerPrimitive.Dictate` / `DictationTranscript` com transcrição parcial visível) — relevante porque o produto aceita áudio
- **Trigger popover** `@` e `/` para menção e comando (`Unstable_TriggerPopover` com prop `char`)
  > https://www.assistant-ui.com/docs/api-reference/primitives/composer.md

---

# C) Truncamento — catálogo de suspeitos e diagnóstico

## C.0 Método: bissecção por camada ANTES de qualquer hipótese

Toda causa mora em exatamente uma de seis fronteiras. Medir o comprimento da string em cada uma localiza a perda numa passada.

| # | Fronteira | Checagem objetiva |
|---|---|---|
| 1 | Origem (CLI) | `jq -r 'select(.type=="assistant") \| .message.content[]?.text' ~/.claude/projects/<enc>/<sess>.jsonl \| wc -c` |
| 2 | Armazenamento | `SELECT length(content), octet_length(content) FROM messages WHERE id=?` (PG) / `SELECT length(content), length(CAST(content AS BLOB))` (SQLite: chars × bytes) |
| 3 | Serializador | logar `len(payload["content"])` imediatamente antes do `return` |
| 4 | Fio (wire) | ver abaixo — a versão corrigida |
| 5 | Estado do cliente | `console.log(msg.id, msg.content.length, msg.content.slice(-120))` logo antes do renderizador |
| 6 | DOM | `el.innerText.length` vs comprimento da string crua; `el.scrollHeight - el.clientHeight` |

**A checagem mais decisiva:** se `raw.length` na fronteira 5 bate com a origem e o DOM mostra menos → o bug é **CSS puro** (§C.1/C.2) ou **markdown** (§C.6). Se já está curto na 5, **CSS é inocente — pare de olhar classe Tailwind**.

**Fronteira 4, versão correta** (⚠️ comparar `Content-Length` com `text().length` é inválido sob compressão — *"When the `Content-Encoding` header is present, other metadata (e.g., `Content-Length`) refer to the **encoded** form of the data"*, MDN):
```js
const res = await fetch(url);
const cl = res.headers.get('content-length'), enc = res.headers.get('content-encoding');
const txt = await res.text();
console.log({ cl, enc, chars: txt.length, bytes: new TextEncoder().encode(txt).length });
// enc == null && cl != null && Number(cl) !== bytes -> truncamento de transporte
// enc != null  -> cl descreve o corpo COMPRIMIDO; refazer com Accept-Encoding: identity
// chars < bytes -> conteúdo multibyte; rever todo limite de banco medido em BYTES
```
Forçar comparabilidade: `curl -s -H 'Accept-Encoding: identity' -D- URL -o /tmp/b; wc -c < /tmp/b`
> Fontes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding · https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Length

**Autoridade formal para "corpo incompleto"** — RFC 9112 §8, literal: *"A client that receives an incomplete response message... MUST record the message as incomplete"*; *"A message that uses a valid Content-Length is incomplete if the size of the message body received (in octets) is less than the value given by Content-Length."*
> https://www.rfc-editor.org/rfc/rfc9112.html#name-handling-incomplete-messages

---

## C.1 Causas de CSS

### C.1.1 `-webkit-line-clamp` / `line-clamp-*`
**Mecânica.** Só funciona como **tríade**: MDN — *"the vendor-prefixed `-webkit-line-clamp` property only works in combination with the `display` property set to `-webkit-box` or `-webkit-inline-box` and the `-webkit-box-orient` property set to `vertical`"*. E: *"In most cases you will also want to set `overflow` to `hidden`, otherwise the contents won't be clipped but an ellipsis will still be shown"*.

**Dano de segunda ordem específico de chat:** `display: -webkit-box` **substitui** o display. Uma bolha que era `flex` deixa de ser flex quando uma classe `line-clamp-*` cai nela, e os filhos reflowam ou somem.

**Diagnóstico.**
```js
const cs = getComputedStyle(el);
({ clamp: cs.webkitLineClamp, display: cs.display, orient: cs.webkitBoxOrient, overflow: cs.overflow });
// clamp !== 'none' && display === '-webkit-box' => clampando ativamente
```
Prova de recuperabilidade: `-webkit-line-clamp: unset` no DevTools → texto volta.
> Fontes: https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-line-clamp · https://developer.mozilla.org/en-US/docs/Web/CSS/line-clamp
> Sub-bugs confirmados por mantenedores: padding na caixa clampada gera **meia linha** visível (Adam Wathan: *"Have to put padding on a separate element I'm afraid, just how this works in CSS/browsers"*) — https://github.com/tailwindlabs/tailwindcss/discussions/13431 ; descendentes (g, y, p, q) cortados quando `line-height` é apertado — https://github.com/tailwindlabs/tailwindcss/discussions/6677

### C.1.2 `overflow: hidden`
*"With `hidden`, overflowing content is clipped at the element's padding box."* Mas continua sendo scroll container: *"If there is overflowing content, the element is a scroll container... the hidden overflow content can be scrolled into view."* — **esse é o teste**: o texto está no DOM, só não é pintado.

**Diagnóstico** (o "clipador" quase nunca é a caixa do próprio texto):
```js
let n = $0; while (n = n.parentElement) {
  const c = getComputedStyle(n);
  if (/hidden|clip|auto|scroll/.test(c.overflow + c.overflowX + c.overflowY)
      && (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth))
    console.log('CLIPPER', n, c.overflow, n.scrollHeight, n.clientHeight);
}
```
Prova: `el.scrollTop = el.scrollHeight` → conteúdo entra em vista ⇒ estava clipado, não ausente.
> https://developer.mozilla.org/en-US/docs/Web/CSS/overflow

### C.1.3 `max-height` / `height` fixos
`max-height` sozinho **nunca** corta — ele **cria** o overflow que o C.1.2 corta. Armadilha de cascata: **`max-height` sobrepõe `height`, mas `min-height` sobrepõe `max-height`** — uma utilidade `min-h-*` derrota silenciosamente uma `max-h-*`.
**Diagnóstico:** `maxHeight !== 'none'` **e** `el.scrollHeight > el.clientHeight`.
> https://developer.mozilla.org/en-US/docs/Web/CSS/max-height

### C.1.4 `text-overflow: ellipsis` + `white-space: nowrap`
MDN: *"The `text-overflow` property doesn't force an overflow to occur"* e *"only affects content that is overflowing a block container element in its **inline** progression direction (not text overflowing at the bottom of a box)"*. O truncador de verdade é o `white-space: nowrap` (força uma linha) + `overflow: hidden`.
**Diagnóstico:** `cs.whiteSpace === 'nowrap' && cs.overflow !== 'visible' && el.scrollWidth > el.clientWidth`
> https://developer.mozilla.org/en-US/docs/Web/CSS/text-overflow

### C.1.5 ⭐ O GRANDE — tamanho mínimo automático de item flex/grid (`min-width:auto` / `min-height:auto`)

**Spec, literal** (CSS Flexible Box Layout L1 §4.5):
> *"To provide a more reasonable default minimum size for flex items, the used value of a main axis automatic minimum size on a flex item **that is not a scroll container** is a **content-based minimum size**; for scroll containers the automatic minimum size is zero, as usual."*

**Mecânica, em português direto.** Um item flex se recusa a encolher abaixo do `min-content`. Ele fica mais largo/alto que o pai, transborda, e o primeiro ancestral com `overflow:hidden` corta. **O texto não é truncado por propriedade de truncamento — ele é EMPURRADO pra fora da caixa.** Num layout coluna (`header / mensagens / composer`), a lista ganha `min-height: auto` = altura do conteúdo, nunca encolhe, o `overflow-y:auto` dela não faz nada, e a cauda da conversa sai da tela.

**Duas propriedades viciosas:**
1. A correção precisa ser aplicada em **todo nível da cadeia flex**. Um wrapper intermediário sem `min-w-0`/`min-h-0` reintroduz o piso pra tudo abaixo.
2. **Escape do scroll container:** pela spec, item que *é* scroll container ganha mínimo automático 0 — é por isso que o bug "se conserta sozinho" quando alguém adiciona `overflow-y:auto`, e **ressuscita** quando alguém remove aquele overflow num commit sem relação.

**Diagnóstico — a checagem de maior rendimento deste documento:**
```js
(function (el) {
  const out = [];
  for (let n = el; n && n.parentElement; n = n.parentElement) {
    const p = n.parentElement, pc = getComputedStyle(p), c = getComputedStyle(n);
    const flexItem = /flex|inline-flex/.test(pc.display);
    const gridItem = /grid|inline-grid/.test(pc.display);
    if (!flexItem && !gridItem) continue;
    const col = flexItem && /column/.test(pc.flexDirection);
    out.push({ el: n, dir: flexItem ? pc.flexDirection : 'grid',
      minWidth: c.minWidth, minHeight: c.minHeight, overflow: c.overflow,
      overflowsParent: col ? n.scrollHeight > p.clientHeight : n.scrollWidth > p.clientWidth,
      verdict: (col ? c.minHeight : c.minWidth) === 'auto' && c.overflow === 'visible'
               ? 'PRECISA min-h-0 / min-w-0' : 'ok' });
  }
  console.table(out);
})($0);
```
Prova de uma linha: `$0.style.minWidth='0'; $0.style.minHeight='0'` → texto reaparece.

**Equivalente em grid:** `1fr` é `minmax(auto, 1fr)`, e `auto` como mínimo de trilha *"represents the largest minimum size... of the grid items occupying the grid track"*. Correção: `minmax(0, 1fr)`.
> Fontes: https://www.w3.org/TR/css-flexbox-1/#min-size-auto · https://developer.mozilla.org/en-US/docs/Web/CSS/min-width · https://developer.mozilla.org/en-US/docs/Web/CSS/min-height · **https://css-tricks.com/flexbox-truncated-text/** · **https://css-tricks.com/preventing-a-grid-blowout/** · https://fantasai.inkedblade.net/style/discuss/flexbox-min-size/ (autora da spec)

### C.1.6 `overflow-wrap` / `word-break` — transbordo em vez de truncamento

**O detalhe que quase todo mundo erra** (MDN `overflow-wrap`):
- `anywhere` — *"Soft wrap opportunities introduced by the word break **are** considered when calculating min-content intrinsic sizes."*
- `break-word` — *"soft wrap opportunities introduced by the word break are **NOT** considered when calculating min-content intrinsic sizes."*

⇒ **`overflow-wrap: break-word` NÃO abaixa o `min-content` e portanto NÃO conserta o estouro de flex do C.1.5. `overflow-wrap: anywhere` conserta.** O Tailwind lançou `wrap-anywhere` na v4.1 exatamente pra isso: *"This is useful for wrapping text inside of `flex` containers, where you would usually need to set `min-width: 0` on the child element."*

`white-space: pre` (padrão de `<pre>`, ou seja, **todo bloco de código markdown**) = sem quebra → transbordo horizontal garantido em linha longa.

**Diagnóstico — medir o piso real de min-content:**
```js
const probe = el.cloneNode(true);
Object.assign(probe.style, { width:'min-content', position:'absolute', visibility:'hidden' });
el.parentElement.appendChild(probe);
console.log('min-content =', probe.getBoundingClientRect().width, 'vs container', el.parentElement.clientWidth);
probe.remove();
```
> Fontes: https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap · https://tailwindcss.com/docs/overflow-wrap · https://tailwindcss.com/blog/tailwindcss-v4-1

### C.1.7 Cadeia de `height: 100%` quebrada
MDN (percentuais de `height`): *"If the height of the containing block is not specified explicitly... and this element is not absolutely positioned, **the value computes to `auto`**."* Um ancestral sem altura explícita converte todo `h-full` abaixo em `height: auto`. Sintoma: a área de scroll dimensiona pelo conteúdo em vez do viewport, o composer é empurrado abaixo da dobra, as últimas mensagens ficam fora da tela. **Lê como truncamento, é cadeia de dimensionamento colapsada.**
**Teste binário:** `html, body { height: 100% }` — se as coisas se encaixam, a cadeia estava quebrada na raiz.
> https://developer.mozilla.org/en-US/docs/Web/CSS/height

### C.1.8 `contain` / `content-visibility` / sticky
- `contain: size` — *"its size is computed as if it had no children"*; sem `contain-intrinsic-size` *"the element risks being zero-sized"*. `contain: strict` = `size layout paint style` → um único `strict` zera a lista de mensagens.
- `contain: paint` — *"clips the box to the padding edge... There can be no visible overflow"*
- `content-visibility: hidden` — *"similar to giving the contents `display: none`"*
- `position: sticky` gruda no *"nearest ancestor that has a 'scrolling mechanism' (created when `overflow` is `hidden`, `scroll`, `auto`, or `overlay`)"* — header sticky dentro de wrapper `overflow:hidden` gruda na caixa errada e é clipado.
> https://developer.mozilla.org/en-US/docs/Web/CSS/contain · https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility

### C.1.9 Sósias (parece truncamento, não é)
- **Máscara/fade** — `mask-image` com gradiente: DOM completo, texto acessível, mas invisível. Delator: `el.scrollHeight === el.clientHeight` **e** texto ausente. Teste: `el.style.maskImage = el.style.webkitMaskImage = 'none'`.
- **`overflow: clip`** — irmão pior do `hidden`: *"The element box is not a scroll container, clipped content is not visible, and programmatic scrolling is not supported."* O teste do `scrollTop` **falha** e `scrollHeight` pode igualar `clientHeight`. Medir com `Range`: `const r=document.createRange(); r.selectNodeContents(el); r.getBoundingClientRect()`.
- **`text-wrap: balance`** — *"only supported for blocks of text spanning a limited number of lines (six or less for Chromium and ten or less for Firefox)"* — para de aplicar silenciosamente.

---

## C.2 Específico de Tailwind 4

| Utilidade | O que emite | Risco |
|---|---|---|
| `truncate` | `overflow:hidden; text-overflow:ellipsis; **white-space:nowrap**` | O `nowrap` é a parte esquecida — colapsa uma bolha multi-linha para **uma linha** |
| `text-clip` | só `text-overflow: clip` | Corta no meio do glifo, **sem "…"** → lê como "o texto simplesmente para" |
| `line-clamp-N` | `overflow:hidden; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:N` | Core desde v3.3 (o plugin morreu) |
| `line-clamp-none` | `overflow:visible; display:block; -webkit-box-orient:horizontal; -webkit-line-clamp:unset` | — |
| `flex-1` | `flex: 1 1 0%` | `flex-basis:0%` **não** deixa encolher a zero — `min-width:auto` ainda pisa em `min-content`. `flex-1 truncate` é o padrão quebrado mais comum |
| `max-h-lh` (v4) | `max-height: 1lh` | Truncador genuíno de uma linha, fácil de não notar numa lista de classes |
| `size-*` (v4) | largura **e** altura | A metade "altura" é invisível no nome da classe |

> Fontes: https://tailwindcss.com/docs/text-overflow · https://tailwindcss.com/docs/line-clamp · https://tailwindcss.com/blog/tailwindcss-v3-3 · https://tailwindcss.com/docs/flex · https://github.com/tailwindlabs/tailwindcss/discussions/12468

**`prose` (`@tailwindcss/typography`) = `max-width: 65ch`.** Verificado no fonte do plugin (`src/styles.js`, `DEFAULT.css`): `maxWidth: '65ch'`. README: *"Each size modifier comes with a baked in `max-width`... add `max-w-none` to your content to override the embedded max-width."* **Não existe classe `prose-none`** — o override é o utilitário `max-w-none`.
E o `prose` mexe no `pre`: `pre { overflowX: 'auto' }` — é *scroll*, não corte, mas com scrollbar overlay invisível no macOS/touch **lê exatamente como "o bloco de código está cortado"**.
> Verificado em: https://github.com/tailwindlabs/tailwindcss-typography/blob/master/src/styles.js (linha 1414)

**Mudança da v4 que faz conteúdo sumir.** Preflight, literal: *"Display classes like `block` or `flex` no longer take priority over the `hidden` attribute on an element."* — gerado como `[hidden]:where(:not([hidden='until-found'])) { display: none !important; }`. **Um nó de mensagem com atributo `hidden` obsoleto, que `block` antes sobrepunha, agora desaparece por completo.** Suspeito nº1 para "o conteúdo sumiu depois do upgrade pra v4".
> https://tailwindcss.com/docs/upgrade-guide · https://tailwindcss.com/docs/preflight

**Preflight NÃO clipa bloco de código.** Lido do `preflight.css` (v4 main): `pre`/`code`/`kbd`/`samp` recebem **só** propriedades de fonte. Se seu bloco de código está cortado, é o `prose` (`overflow-x:auto`) ou um `overflow-hidden` seu. Nota: `svg` está deliberadamente **fora** da regra `img, video { max-width: 100% }` — SVG inline grande transborda e é clipado por qualquer `overflow-hidden` ancestral.
> https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/preflight.css

---

## C.3 Backend / banco

| Causa | Número | Diagnóstico |
|---|---|---|
| MySQL `TEXT` | **65.535 BYTES** (≈64 KB) — não caracteres. Com `utf8mb4` (até 4 bytes/char) e emoji/acento, bate muito antes do que a contagem de caracteres sugere. **`TEXT` é o tipo errado para mensagem de agente com bloco de código.** | `SELECT LENGTH(content) bytes, CHAR_LENGTH(content) chars ...` — `bytes` cravado em 65535 é confissão. `SHOW WARNINGS;` após o INSERT |
| MySQL `VARCHAR(N)` | Com strict mode **off**, trunca e emite só um *warning* ("Data truncated for column") — invisível pra maioria dos ORMs | `SELECT @@sql_mode;` |
| ⚠️ Nuance | MySQL 8.4 já traz `STRICT_TRANS_TABLES` **no `sql_mode` padrão** → instalação moderna **erra** (`1406 ER_DATA_TOO_LONG`). Truncamento silencioso observado ⇒ ou `sql_mode` foi sobrescrito, ou há `INSERT IGNORE`/`UPDATE IGNORE` | `grep -rn "INSERT IGNORE\|UPDATE IGNORE"` antes de culpar a coluna |
| **Prisma `String` → `VARCHAR(191)` no MySQL** | Truncamento causado por ORM mais comum neste stack. Com `sql_mode` não-estrito, toda mensagem corta em 191 chars | Ver o schema; corrigir com `@db.Text`/`@db.LongText` |
| **MySQL `group_concat_max_len` = 1024 BYTES** | *"The maximum permitted result length in bytes for the `GROUP_CONCAT()` function. The default is 1024."* Warning `1301`: *"Result of %s() was larger than max_allowed_packet - truncated"*. Se algum caminho de leitura agrega partes de mensagem, morre em 1024 bytes | `SELECT @@group_concat_max_len, @@max_sort_length;` |
| MySQL `max_allowed_packet` | Server 64 MB / cliente 16 MB (8.0). Estourar → `ER_NET_PACKET_TOO_LARGE` e **fecha a conexão** (aparece como "Lost connection during query") | `SELECT @@max_allowed_packet;` |
| **SQLite** | `SQLITE_MAX_LENGTH` = **1.000.000.000 bytes** (não 1 milhão). E: *"numeric arguments in parentheses that following the type name (ex: 'VARCHAR(255)') are **ignored** by SQLite"* ⇒ **em SQLite, `VARCHAR(255)` NÃO é seu truncador. Descarte cedo.** | `PRAGMA compile_options;` |
| PostgreSQL | *Não* trunca `varchar(n)` silenciosamente — **erra**. **Exceto** em cast explícito: *"if one explicitly casts a value to `character varying(n)`... an over-length value will be truncated to n characters without raising an error"* | `\d+ messages`; grep de `::varchar` em views/triggers |
| **Supabase / PostgREST** | `db-max-rows` padrão do PostgREST é **∞**; a **Supabase** ship com **1.000**. Trunca a *conversa*, não a mensagem | Header `Content-Range: 0-999/*` com exatamente 1000 linhas é a impressão digital |
| node-postgres | **Lança** em vez de truncar: `Cannot create a string longer than 0x1fffffe8 characters` (536.870.888). O mesmo teto do V8 morde `await res.text()` e `JSON.parse` | `node -e 'console.log(require("buffer").constants.MAX_STRING_LENGTH)'` |

> Fontes: https://dev.mysql.com/doc/refman/8.0/en/storage-requirements.html · https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html · https://dev.mysql.com/doc/refman/8.4/en/sql-mode.html · https://dev.mysql.com/doc/refman/8.0/en/packet-too-large.html · https://www.sqlite.org/limits.html · https://www.sqlite.org/datatype3.html · https://www.postgresql.org/docs/current/datatype-character.html · https://postgrest.org/en/stable/references/configuration.html · https://www.prisma.io/docs/orm/overview/databases/mysql · https://github.com/brianc/node-postgres/issues/2653

---

## C.4 Transporte / tamanho de corpo

**⭐ Next.js `experimental.proxyClientMaxBodySize` — o ÚNICO botão do Next que trunca e ainda devolve 200.** Padrão **10 MB**. Literal: *"If a request body exceeds this limit, the body will only be buffered up to the limit, and a warning will be logged"* e *"The request will **not** fail or return an error to the client."* Ativo só quando há proxy/middleware no caminho. **Se mensagem longa é cortada com 200 limpo, olhe aqui primeiro.**
> https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize

**Next.js — outros:** Pages Router API routes `bodyParser.sizeLimit` padrão `'1mb'`; `responseLimit` avisa acima de 4 MB. Server Actions: *"By default, the maximum size of the request body sent to a Server Action is 1MB."* App Router Route Handlers não têm limite de parser — a parede é a plataforma.
> https://nextjs.org/docs/pages/building-your-application/routing/api-routes · https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions

**Vercel:**
- *"The maximum payload size for the request body or the response body of a Vercel Function is **4.5 MB**. If a Vercel Function receives a payload in excess of the limit it will return an error **413: `FUNCTION_PAYLOAD_TOO_LARGE`**."* (O "6 MB" que circula é do AWS Lambda, não da Vercel.)
- **Streaming é isento** desse teto — *"streaming functions, which don't have this limit"*. Resposta em stream é limitada por **duração**, não por payload.
- Duração corta stream: *"For request handlers, this includes time spent processing the request and sending the response, **including streamed responses**"* → 504 `FUNCTION_INVOCATION_TIMEOUT` **no meio do stream**; o cliente fica com o que chegou. Node/Python: 300 s padrão, 800 s máx (Pro/Ent).
- Edge: *"must begin sending a response within 25 seconds to maintain streaming capabilities beyond this period, and can continue streaming data for up to 300 seconds."*
> https://vercel.com/docs/functions/limitations

**nginx:**
- `client_max_body_size` padrão **`1m`** — *"If the size in a request exceeds the configured value, the 413... error is returned"*
- `proxy_buffer_size` padrão `4k|8k` — *"If the header exceeds the buffer size, the response is considered invalid"* ⇒ o clássico `upstream sent too big header` 502
- `proxy_read_timeout` padrão **`60s`** — *"The timeout is set only between two successive read operations... If the proxied server does not transmit anything within this time, the connection is closed."* **Para agente lento, isso amputa silenciosamente a cauda da resposta longa.**
**Diagnóstico:** `/var/log/nginx/error.log` por `client intended to send too large body`, `upstream sent too big header`, `upstream timed out`. E comparar `curl` direto no upstream vs através do proxy, `wc -c` nos dois.
> https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size · https://nginx.org/en/docs/http/ngx_http_proxy_module.html

**Outros gateways (verificados):** Cloudflare corpo de request — Free/Pro 100 MB, Business 200 MB, Ent 500 MB → 413; headers 128 KB; URL 16 KB. AWS API Gateway REST: payload **10 MB, "Can be increased: No"**, timeout de integração 50 ms–29 s. Lambda: 6 MB sync request/response, **200 MB em streaming**, 1 MB async. Express `body-parser`: padrão `limit: '100kb'` → 413 `entity.too.large`. Node origem: `server.requestTimeout` 300000, `headersTimeout` = min(requestTimeout, 60000), `keepAliveTimeout` 5000.
> https://developers.cloudflare.com/workers/platform/limits/ · https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-execution-service-limits-table.html · https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html · https://expressjs.com/en/resources/middleware/body-parser.html · https://nodejs.org/api/http.html

---

## C.5 Remontagem de streaming / SSE

### C.5.1 O formato do fio — evento termina em LINHA EM BRANCO
Spec WHATWG HTML, processamento de event stream:
- *"If the line is empty (a blank line) [Dispatch the event]."*
- ⚠️ *"Once the end of the file is reached, **any pending data must be discarded**."* ⇒ **um evento final sem linha em branco no fim é descartado em silêncio.** É o bug nº1 de "a última mensagem nunca chega".
- Multi-linha: *"Append the field value to the data buffer, then append a single U+000A LINE FEED"*, e *"If the data buffer's last character is a LINE FEED, then remove the last character."*
- *"If value starts with a U+0020 SPACE character, remove it from value."*

**O assassino para markdown:** um payload JSON com `\n` cru escrito direto depois de `data: ` **parte o evento cedo** — o cliente parseia JSON truncado, engole o erro no catch, e joga o resto fora. Todo payload precisa passar por `JSON.stringify` (que escapa newline) ou ser dividido em múltiplas linhas `data:`.

**Diagnóstico:**
```bash
curl -N -H 'Accept: text/event-stream' URL | tee /tmp/raw.sse | head -50
xxd /tmp/raw.sse | tail -3     # tem que terminar em 0a0a
grep -c '^data:' /tmp/raw.sse  # vs eventos que o cliente despachou
```
> https://html.spec.whatwg.org/multipage/server-sent-events.html

### C.5.2 Fronteira de chunk ≠ fronteira de mensagem
Uma leitura do `ReadableStream` pode conter meio evento ou vários. `chunk.split('\n\n')` **por chunk de rede, sem carregar o resto num buffer**, descarta o evento parcial do fim toda vez.
**Diagnóstico:** ao fim do stream, `if (buffer.length) console.error('CAUDA NÃO CONSUMIDA', buffer)`. No servidor: emitir número de sequência monotônico por evento e afirmar ausência de buracos no cliente.

### C.5.3 `TextDecoder` sem `{ stream: true }` — caractere multibyte partido
MDN: a opção `stream` é *"a boolean flag indicating whether additional data will follow in subsequent calls to `decode()`. Set to `true` if processing the data in chunks, and `false` for the final chunk... It defaults to `false`."* Com `stream: true` o decoder guarda estado entre chamadas; sem, um `€` (3 bytes) ou emoji partido numa fronteira de TCP vira **U+FFFD (�)** ou `TypeError` que aborta o loop de leitura.
**Diagnóstico:** `text.includes('�')` no render; comparar `sum(chunk.byteLength)` com `Buffer.byteLength(finalText,'utf8')`.
**No servidor, mesmo bug:** `node:string_decoder` existe exatamente pra isso — *"an internal buffer is used to ensure that the decoded string does not contain any incomplete multibyte characters"*. `buf.toString('utf8')` por chunk é o anti-padrão.
> https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode · https://encoding.spec.whatwg.org/ · https://nodejs.org/api/string_decoder.html

### C.5.4 Buffering de proxy
nginx `proxy_buffering` é **`on`** por padrão. Escape hatch literal da doc do nginx: *"Buffering can also be enabled or disabled by passing `yes` or `no` in the **X-Accel-Buffering** response header field."*
Sintoma: SSE é tempo real no localhost e chega em lotes (ou parece cortado) em produção.
Bloco correto de SSE: `proxy_buffering off; proxy_cache off; gzip off; proxy_http_version 1.1;` + `proxy_read_timeout` alto. (Evitar HTTP/2 no endpoint SSE — a implementação do nginx frequentemente quebra streaming.)
**Diagnóstico:** `curl -N` direto na porta do upstream vs através do proxy.
> https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering

### C.5.5 Compressão sobre stream
`Content-Encoding: gzip` sobre SSE buferiza até o compressor dar flush. O middleware `compression` do Express precisa de `res.flush()` explícito por evento, ou `gzip off` naquela rota.

### C.5.6 Backpressure de re-render matando o stream (⚠️ específico deste stack)
Relato real com AI SDK v5: com muitas chamadas de ferramenta gerando saída longa, chegam **1.000+ eventos** rápido; o React não re-renderiza rápido o bastante, a main thread trava, eventos se acumulam na fila, e **o stream termina prematuramente com HTTP 200** — a mensagem incompleta fica no histórico e a requisição seguinte falha com 400. Correção: `experimental_throttle: 100` (v5) / `throttle: 50` (v6+).
> https://zenn.dev/coji/articles/vercel-ai-sdk-streaming-backpressure · https://ai-sdk.dev/docs/ai-sdk-ui/chatbot

### C.5.7 EventSource reconecta sozinho
*"By default, if the connection between the client and server closes, the connection is restarted."* Na reconexão o browser manda `Last-Event-ID`; se o servidor ignora, o cliente **perde em silêncio** os eventos do intervalo — mensagem que simplesmente para no meio da frase, sem erro no console.

### C.5.8 Abort do cliente persistindo um parcial
Unmount do React / troca de rota dispara `AbortController`; se o servidor persiste o que acumulou, a mensagem **armazenada** fica truncada para sempre. **Diagnóstico:** grep de `AbortError`/`ClientDisconnect` nos logs; verificar se a linha tem flag `done`/`complete`.

---

## C.6 Parser de markdown

### C.6.1 Cerca de código não fechada — o clássico
CommonMark §4.5, literal: *"If the end of the containing block (or document) is reached and no closing code fence has been found, the code block contains all of the lines after the opening code fence until the end of the containing block (or document)."*

⇒ Durante o streaming, no instante em que chega um ``` solitário, **tudo depois disso é engolido para dentro de um bloco de código**. O usuário lê como "a mensagem foi cortada" / "o resto virou lixo". E uma cerca desbalanceada numa mensagem **armazenada** envenena tudo depois dela para sempre.

**Diagnóstico de uma linha, que qualquer revisor roda:**
```js
(raw.match(/```/g) || []).length % 2 !== 0   // contagem ímpar = cerca desbalanceada
```
E renderizar a string crua num `<pre>` ao lado da saída markdown: se o `<pre>` mostra tudo e o markdown não, a perda é no renderizador.
> https://spec.commonmark.org/0.31.2/

### C.6.2 A correção: completar o markdown incompleto ANTES de renderizar
**Streamdown** (Vercel) foi construído para isso: *"built to handle the unique requirements of streaming Markdown content from AI models, providing seamless formatting even with incomplete or unterminated Markdown blocks."* O pré-processador `remend` completa:

| Construto | Tratamento |
|---|---|
| Negrito `**` | *"adds a closing `**`"* |
| Itálico `*` / `_` | completado automaticamente |
| Negrito-itálico `***` | tratado |
| Código inline `` ` `` | *"closed with a backtick"* |
| Strikethrough `~~` | completado |
| Til solitário `~` | *"escaped to prevent GFM from misinterpreting them as strikethrough markers"* |
| Link `[texto](` | completado com placeholder `streamdown:incomplete-link`, ou `linkMode: 'text-only'` |
| Imagem | *"removed entirely rather than showing broken image placeholders"* |
| Matemática `$$` | *"adds the closing `$$`"* |
| Cerca de código | *"the unterminated block parser ensures the code block renders properly even without the closing backticks"*; identificador de linguagem truncado cai para texto puro em vez de o Shiki lançar |

Desligável com `parseIncompleteMarkdown={false}`. Também endurece contra conteúdo não confiável: *"Safe handling of untrusted content with restricted images and links"*.
assistant-ui expõe o mesmo via `StreamdownTextPrimitive`.
> https://streamdown.ai/docs/termination · https://github.com/vercel/streamdown · https://vercel.com/changelog/introducing-streamdown · https://www.assistant-ui.com/docs/ui/streamdown

### C.6.3 `react-markdown` descarta coisas **por design**
- HTML cru: *"react-markdown typically escapes HTML (or ignores it, with `skipHtml`) because it is dangerous and defeats the purpose of this library."* Precisa de `rehype-raw` (+~60 kb). ⇒ agente que emite `<details>`, `<think>`, `<Foo>` vê **sumir**.
- GFM (tabela, strikethrough, autolink, task list) exige `remark-gfm`. Sem ele, sintaxe de tabela vira pipe literal.
- *"normally when say `strong` is not allowed, it and it's children are dropped"* — a opção `unwrapDisallowed` preserva os filhos.
- O README **não** tem suporte a streaming nem a markdown incompleto — processa strings completas.
> https://github.com/remarkjs/react-markdown

### C.6.4 Sanitizadores cortando em silêncio
- `rehype-sanitize` segue o schema do GitHub e *"drops anything that isn't explicitly allowed by a schema"* — **sem erro, sem warning**. Regra de ordem: *"Use rehype-sanitize after the last unsafe thing"*.
- DOMPurify: `KEEP_CONTENT` — *"keep an element's content when the element is removed (default is true)"*; com `false`, o texto interno também vai embora. Hook de inspeção: *"you can also have a look at the property `DOMPurify.removed` and find out, what elements and attributes were thrown out."*
**Diagnóstico:** logar `DOMPurify.removed` após cada sanitize; ou renderizar uma vez com o sanitizador desligado num build de rascunho e comparar `innerText.length`.
> https://github.com/rehypejs/rehype-sanitize · https://github.com/cure53/DOMPurify

### C.6.5 Regra de renderização em streaming
**Re-parsear o buffer acumulado INTEIRO a cada token; nunca concatenar HTML já renderizado** — append incremental não consegue se recuperar de um construto que fecha depois. Artefatos reais conhecidos com react-markdown + streaming: footnotes que não renderizam até completar, list items quebrados no Safari, e colapso de performance do `remark-gfm` em strings muito longas (tempos de render relatados na casa das dezenas de segundos).
> https://github.com/remarkjs/remark-gfm/issues/48 · https://github.com/orgs/remarkjs/discussions/1262

---

## C.7 Específico de polling

| Causa | Diagnóstico |
|---|---|
| **Rota de lista devolve campo de preview** (`preview`, `excerpt`, `snippet`, `summary`, `label`) e a UI lê da lista | `curl LIST \| jq '.[0] \| keys'` vs `curl DETAIL/:id \| jq 'keys'`; depois `jq '.[0].content \| length'` nos dois |
| **Paginação / `LIMIT`** | Se a contagem renderizada cai num número redondo (50, 100, 500, 1000), **é o limite, não o dado** |
| **Fatiamento no serializador** (`content[:N]`, `.slice(0,N)`, `SUBSTRING`) | Se `content.length` é *exatamente* o mesmo número redondo em várias mensagens, grep daquela constante na API |
| **⭐ Poll pega a linha no meio da escrita e o cliente congela o parcial** — o cliente deduplica por id e nunca relê | Logar `content.length` por poll para o mesmo id e afirmar crescimento monotônico; verificar se a API expõe flag `done`/`complete`/`status` e se o cliente a respeita |
| **Bug de merge no cliente** — replace-vs-append; `Map` por id em que um poll posterior com valor **mais curto** vence; colisão de `key`; closure obsoleta em `setInterval` | No reducer de merge: `if (next.content.length < prev.content.length) console.error('ENCOLHEU', id, prev.length, next.length)` |
| **Cache do Next/HTTP servindo snapshot velho** | Headers `x-nextjs-cache` / `age`; teste diferencial com `cache: 'no-store'` |
| Tetos de string do V8 | 2²⁹−24 (~1 GiB) em 64-bit; `RangeError: Invalid string length` de `JSON.stringify`. Raro por mensagem, alcançável num dump de conversa inteira |

⚠️ **E o combo silencioso:** um `JSON.parse` dentro de `try/catch` que devolve um objeto parcial/último-bom converte um bug de transporte (§C.5) em truncamento silencioso.

---

## C.8 Específico de fonte CLI (captura de tmux)

| Causa | Fato | Diagnóstico |
|---|---|---|
| `capture-pane` pega **só o visível** | man do tmux: *"The default is to capture only the visible contents of the pane"*. `-S -` pega do início do histórico. `-J` *"preserve trailing spaces and join wrapped lines"* — **obrigatório**, senão hard-wrap de pane estreito parte linha lógica | `tmux capture-pane -p -S - -J -t <sess>` |
| `history-limit` = **2.000 linhas** por padrão | E *"applies only to new windows — existing window histories are not resized"* ⇒ subir no `~/.tmux.conf` não faz nada para sessões já rodando | `tmux show -g history-limit`; se `capture-pane -p -S - \| wc -l` cai exatamente no limite, você está na parede |
| **TUI repinta — o buffer tem só o último repaint** | Claude Code e Codex redesenham com `\r` e sequências de cursor. `capture-pane` devolve o **estado final da tela**, não o histórico do que foi impresso. Texto sobrescrito no lugar é **irrecuperável** do pane. **Estrutural, não ajustável** | — |
| Regex de strip de ANSI comendo conteúdo | Regex caseiro amplo demais (ex.: `\x1b\[.*m` guloso) engole tudo entre o primeiro escape e o último `m` da linha | Rodar o stripper numa fixture conhecida e comparar comprimentos |
| Buffering de stdio esconde a cauda | `setvbuf(3)`: *"Normally, all files are block buffered. If a stream refers to a terminal (as stdout normally does), it is line buffered."* ⇒ processo escrevendo num **pipe** troca line-buffered por block-buffered (4 KB/64 KB) e o último bloco parcial fica sem flush | `stdbuf -o0` / `stdbuf -oL` |

**⭐ A correção correta: parar de capturar o terminal.** Os dois CLIs escrevem um transcript **completo e estruturado** em disco; o pane é uma view com perda.
- **Claude Code:** `claude -p ... --output-format stream-json --verbose --include-partial-messages` — *"Each line is a JSON object representing an event"*, e *"The last line of the stream is a `result` message with the final response text."* ⚠️ **Bug de cauda documentado:** *"If your consumer reads the stream slowly, Claude Code waits for the queued output to drain before exiting, scaling the wait with how much is still queued, capped at 30 seconds. **Before v2.1.214 the exit wait was capped at about two seconds, which could cut off the end of a large response.**"* ⇒ **em versão < 2.1.214, isso sozinho trunca mensagem longa.** Transcripts em `~/.claude/projects/<encoded-cwd>/*.jsonl`.
  > https://code.claude.com/docs/en/headless
- **Codex CLI:** rollout JSONL por sessão em `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, com prompts, respostas do modelo, chamadas de ferramenta e resultados.
  > https://github.com/openai/codex/discussions/3827

**Diagnóstico:** comparar o comprimento do texto no JSONL com o que o painel mostra. JSONL completo + painel incompleto ⇒ o culpado é o caminho de captura, e a correção é **ler o JSONL**, não alargar o pane.

---

## C.9 Ordem de triagem recomendada

1. **Bissecção por camada** (§C.0) — 10 minutos, elimina 80% da árvore
2. Perda só na fronteira DOM → `overflow-hidden` no corpo markdown, depois a cadeia do §C.1.5, depois varredura de `truncate`/`line-clamp-*`
3. Perda na fronteira API → limites de paginação e campos de preview, depois a checagem de linha-em-branco/JSON-com-newline do §C.5.1
4. Perda na fronteira da origem → caps de pane + `history-limit`, e **mover a captura para o JSONL** (§C.8) — incluindo checar a versão do Claude Code contra a **v2.1.214**
5. **Independente de tudo:** rodar a checagem de cerca ímpar (§C.6.1) sobre as mensagens armazenadas. `(raw.match(/```/g)||[]).length % 2` é uma query de dois minutos que acha linhas envenenadas permanentemente

---

# D) Consistência entre dois provedores na mesma UI

## D.1 O diagnóstico: falta uma camada anticorrupção

**O que fazer:** definir **um** modelo de mensagem interno e escrever **um adaptador por provedor** que converte para ele. A UI só conhece o modelo interno. Nenhum componente de render deve ter `if (provider === 'codex')`.

**Por quê:** os dois CLIs emitem NDJSON estruturalmente diferentes:
- **Codex CLI (`codex exec --json`)**: um objeto JSON por linha, com eventos `thread.started`, `turn.started`, `turn.completed`, `turn.failed` e eventos `item` por operação; pode ser pareado com `--output-last-message` para o texto final
- **Claude Code (`--output-format stream-json`)**: NDJSON com `.type` variado — `system` (com `subtype` como `api_retry`), `assistant`, `stream_event` (deltas de token, chamadas de ferramenta), e um `result` final

E o conjunto completo de tipos do Claude Code é **explicitamente não documentado** — issue aberta: *"[FEATURE] Document all message types emitted by `claude -p --output-format stream-json`"*.
> Fontes: https://github.com/anthropics/claude-code/issues/24612 · https://code.claude.com/docs/en/headless · https://github.com/openai/codex/discussions/3827

⇒ **Conclusão de arquitetura:** um formato instável e não documentado **exige** camada anticorrupção. Se a UI lê o evento cru, cada mudança de versão de qualquer um dos dois CLIs quebra o render.

## D.2 O modelo alvo: mensagem com `parts` tipadas (não string)

**O que fazer:** mensagem = `{ id, role, metadata?, parts: Part[] }`. `Part` é uma união discriminada por `type`. **Não** guardar a mensagem como string de markdown.

**Por quê:** é o modelo que as duas bibliotecas líderes convergiram, e é o que permite render idêntico entre provedores — porque a diferença fica no adaptador, não no componente.

**AI SDK v5+ (`UIMessage`), tipo literal:**
```ts
interface UIMessage<METADATA = unknown, DATA_PARTS extends UIDataTypes = UIDataTypes,
                    TOOLS extends UITools = UITools> {
  id: string;
  role: 'system' | 'user' | 'assistant';
  metadata?: METADATA;
  parts: Array<UIMessagePart<DATA_PARTS, TOOLS>>;
}
```
Tipos de parte documentados:

| Parte | Forma | Estados |
|---|---|---|
| `TextUIPart` | `{ type:'text'; text:string; state?: 'streaming'\|'done' }` | ⭐ o `state` é o que resolve "está escrevendo ainda" |
| `ReasoningUIPart` | `{ type:'reasoning'; id?; text; state?: 'streaming'\|'done'; providerMetadata? }` | idem |
| `ToolUIPart` | `type: 'tool-${NAME}'` | `input-streaming` → `input-available` → `output-available` \| `output-error` |
| `DynamicToolUIPart` | `{ type:'dynamic-tool'; toolName; input; ... }` | para ferramenta não conhecida em tempo de compilação |
| `FileUIPart` | `{ type:'file'; mediaType; filename?; url }` | ⭐ `url` aceita http **ou** data URL |
| `SourceUrlUIPart` | `{ type:'source-url'; sourceId; url; title?; providerMetadata? }` | |
| `SourceDocumentUIPart` | `{ type:'source-document'; sourceId; mediaType; title; filename? }` | |
| `DataUIPart` | `type: 'data-${NAME}'` | extensão do app |
| `StepStartUIPart` | `{ type:'step-start' }` | separador de passo agêntico |
| `CustomContentUIPart` | `{ type:'custom'; kind:'${string}.${string}' }` | |

> Fonte: https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message

**assistant-ui (`ThreadMessageLike`), literal:**
```ts
{
  role: "assistant" | "user" | "system";
  content: string | Readonly<MessagePart[]>;
  id?: string;
  createdAt?: Date;
  status?: MessageStatus;                        // { type:"running" | "complete" | "incomplete" }
  attachments?: readonly CompleteAttachment[];   // só em mensagem de usuário
  metadata?: object;
}
```
Suporta `data-*` como prefixo de tipo customizado, convertido automaticamente em `DataMessagePart`. `attachments` aceita *"custom strings beyond 'image' | 'document' | 'file'; contentType is optional"*.
> Fonte: https://www.assistant-ui.com/docs/runtimes/custom/external-store

## D.3 O ponto exato do adaptador

**assistant-ui expõe o normalizador como um único campo obrigatório da `ExternalStoreAdapter`:**
```ts
convertMessage?: (message: T, index: number) => ThreadMessageLike
```
Ou seja: você mantém **seu** formato no estado (`messages: readonly T[]`), e a única coisa que a UI exige é uma função pura de conversão. Esse é o encaixe canônico de um adaptador por provedor.
> Fonte: https://www.assistant-ui.com/docs/runtimes/custom/external-store

**AI SDK** faz o equivalente no transporte: `DefaultChatTransport({ prepareSendMessagesRequest })` e `readUIMessageStream({ stream: toUIMessageStream(...) })` — o stream de qualquer origem vira `UIMessage` antes de tocar a UI.
> Fonte: https://ai-sdk.dev/docs/ai-sdk-ui/reading-ui-message-streams

## D.4 Renderização: um mapa de `type` → componente, e nada mais

**assistant-ui, `MessagePrimitive.Parts`:**
```tsx
<MessagePrimitive.Parts components={{
  Text:      () => <p className="whitespace-pre-wrap"><MessagePartPrimitive.Text /></p>,
  Image:     () => <MessagePartPrimitive.Image className="max-w-sm rounded-xl" />,
  File:      () => <div className="rounded-md border px-2 py-1 text-xs">File part</div>,
  tools:     { by_name: { get_weather: () => <div/> }, Fallback: ({toolName}) => <div>Unknown tool: {toolName}</div> },
  data:      { by_name: { "my-event": ({data}) => <pre>{JSON.stringify(data,null,2)}</pre> }, Fallback: ({name}) => <div/> },
  ToolGroup:      ({children}) => <div className="space-y-2 rounded-lg border p-2">{children}</div>,
  ReasoningGroup: ({children}) => <details><summary>Reasoning</summary>{children}</details>,
  Empty:     () => <span className="text-muted-foreground">...</span>,
}} />
```
⭐ **O `Fallback` obrigatório por categoria é o que impede regressão visual quando um provedor emite um tipo novo.** Sem fallback, tipo desconhecido = nada renderizado = "mensagem sumiu".
> Fonte: https://www.assistant-ui.com/docs/primitives/message

**Agrupamento** — para dar a mesma cara a "raciocínio + ferramentas" dos dois provedores:
```tsx
<MessagePrimitive.GroupedParts groupBy={groupPartByType({
  reasoning:   ["group-chainOfThought", "group-reasoning"],
  "tool-call": ["group-chainOfThought", "group-tool"],
})}>
```
> Fonte: https://www.assistant-ui.com/docs/primitives/chain-of-thought

## D.5 Um vocabulário de eventos pronto, se quiser padronizar o fio

O **AG-UI** (Agent-User Interaction Protocol) é um protocolo aberto que já define o vocabulário de eventos entre agente e UI. Vale como **checklist do que seu normalizador precisa cobrir**, mesmo que você não adote o protocolo:

- **Ciclo de vida:** `RunStarted` (`threadId`, `runId`, `parentRunId?`, `input?`), `RunFinished` (*"Every run terminates with either RunFinished or RunError"*, com `outcome` = success ou interrupt), `RunError` (`message`, `code?`), `StepStarted`/`StepFinished` (`stepName`)
- **Texto:** `TextMessageStart` (`messageId`, `role`), `TextMessageContent` (`messageId`, `delta`), `TextMessageEnd` (`messageId`), `TextMessageChunk` (conveniência que expande para Start→Content→End)
- **Ferramenta:** `ToolCallStart` (`toolCallId`, `toolCallName`, `parentMessageId?`), `ToolCallArgs` (`delta`), `ToolCallEnd`, `ToolCallResult` (`messageId`, `toolCallId`, `content`), `ToolCallChunk`
- **Estado:** `StateSnapshot`, `StateDelta` (*"incremental updates using JSON Patch operations (RFC 6902)"*), `MessagesSnapshot` (histórico completo)
- **Especiais:** `Raw` — *"Acts as a container for events originating from external systems"* (`event`, `source?`) ⭐ **exatamente o envelope para o NDJSON cru de cada CLI**; `Custom` (`name`, `value`)

> Fonte: https://docs.ag-ui.com/concepts/events

## D.6 Um renderizador de markdown só, para os dois

**O que fazer:** o mesmo componente de resposta (mesmo `prose`, mesmo highlighter, mesmo tratamento de markdown incompleto) para os dois provedores. Se hoje um usa `react-markdown` e o outro `<pre>`, é aí que a divergência visual nasce.

Recomendação concreta: **Streamdown** — drop-in de `react-markdown` desenhado para streaming (§C.6.2), com estilo Tailwind typography, GFM, Shiki, KaTeX e endurecimento de conteúdo não confiável. É o que a Vercel usa por baixo do componente `Response` do AI Elements.
> https://github.com/vercel/streamdown · https://vercel.com/changelog/introducing-streamdown

## D.7 Recomendação para ESTE produto

1. Definir `AgentMessage = { id, role, provider, createdAt, status, parts: Part[] }` com `Part` = união discriminada (`text` · `reasoning` · `tool-call` · `tool-result` · `file` · `step-start` · `raw`).
2. Dois adaptadores puros: `fromClaudeCodeStreamJson(event) → Part[]` e `fromCodexExecJson(event) → Part[]`. Testes de contrato: um NDJSON de fixture por provedor, mesma saída normalizada esperada.
3. **Toda parte não reconhecida cai em `raw`** e renderiza num bloco colapsável — nunca em nada.
4. `state`/`status` por parte (`streaming`/`done`) para que "digitando" e "terminado" tenham exatamente a mesma aparência entre provedores.
5. Um único componente de render por `type`, com `Fallback` por categoria.
6. Um único renderizador de markdown, com completamento de construto incompleto.

---

# E) Streaming/polling e identidade de objeto no React 19

## E.1 Chaves estáveis — identidade, não posição

`key={index}` está errado porque uma lista de chat é exatamente a forma que a react.dev alerta.

react.dev — *Rendering Lists*:
> *"Keys tell React which array item each component corresponds to, so that it can match them up later. This becomes important if your array items can move (e.g. due to sorting), get inserted, or get deleted."*
> *"You might be tempted to use an item's index in the array as its key... But the order in which you render items will change over time if an item is inserted, deleted, or if the array gets reordered. **Index as a key often leads to subtle and confusing bugs.**"*
> *"**Keys must not change** or that defeats their purpose! Don't generate them while rendering."*
> *"do not generate keys on the fly, e.g. with `key={Math.random()}`... **leading to all your components and DOM being recreated every time**."*

react.dev — *Preserving and Resetting State*:
> *"**React preserves a component's state for as long as it's being rendered at its position in the UI tree.** If it gets removed, or a different component gets rendered at the same position, React discards its state."*
> *"Specifying a `key` tells React to use the `key` itself **as part of the position**, instead of their order within the parent."*

**Por que morde num chat com polling:** ao prepender 20 mensagens antigas com chave por índice, toda chave existente desloca 20. O React vê "mesmo componente, mesma posição, props diferentes" em cada linha, então **mantém o nó do DOM e reescreve o conteúdo** — estado local por mensagem (chamada de ferramenta expandida, bloco de código colapsado, flag "copiado!", áudio tocando) migra para a mensagem errada, `<img>`/`<video>` re-decodificam e piscam, e seleção de texto em curso é destruída.

`@tanstack/react-virtual` diz sem meias palavras: *"Do not use index keys for chat history. After a prepend, every existing message shifts to a new index, so index keys cannot identify the same message across the update."*
> Fontes: https://react.dev/learn/rendering-lists · https://react.dev/learn/preserving-and-resetting-state · https://tanstack.com/virtual/latest/docs/chat · https://github.com/inokawa/virtua

⭐ **Exceção que vale saber:** *dentro* de uma única mensagem em streaming dividida em blocos de markdown, chave por índice **está correta** — blocos só crescem ou mutam o último (§E.7c).

## E.2 Identidade de objeto — a causa real do "pisca" no polling

Polling que faz `setMessages(await res.json())` produz um array novo de objetos novos a cada tick. Toda barreira `React.memo` falha, toda dep de `useMemo` invalida, todo `useEffect([messages])` redispara — **mesmo com zero bytes alterados**.

react.dev — `memo`:
> *"React compares old and new props by **shallow equality**: that is, it considers whether each new prop is **reference-equal** to the old prop."*
> *"**`memo` is completely useless if the props passed to your component are always different**, such as if you pass an object or a plain function defined during rendering."*
> *"If you create a new object or array each time the parent is re-rendered, **even if the individual elements are each the same**, React will still consider it to be changed."*
> https://react.dev/reference/react/memo

### A correção: structural sharing (compartilhamento estrutural)

TanStack Query faz isso e está **ligado por padrão**:
> *"React Query will keep the original reference if _nothing_ changed in the data"* — e em mudança parcial, *"React Query will keep the unchanged parts and only replace the changed parts."*
> ⚠️ *"This optimization only works if the `queryFn` returns **JSON compatible data**."*

⚠️ **Armadilha silenciosa:** o mecanismo é `replaceEqualDeep`; **Date, Map, Set e instâncias de classe quebram**. É o bug clássico de "eu converto `created_at` em `Date` no fetcher e tudo re-renderiza". **Parseie datas no componente, não no fetcher.**
> Fontes: https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations · https://tkdodo.eu/blog/react-query-render-optimizations

Comparador custom (v5 substituiu `isDataEqual`):
```ts
import { replaceEqualDeep } from '@tanstack/react-query'
structuralSharing: (oldData, newData) =>
  customCheck(oldData, newData) ? oldData : replaceEqualDeep(oldData, newData)
```

**Sem TanStack Query:** normalizar por id e **fazer merge, não replace**. Manter um `Map<id, Message>`; para cada linha recebida, comparar profundo contra o objeto guardado e **reusar a referência guardada quando igual**. Só depois disso o `memo` por mensagem faz algum trabalho.
> Referência conceitual: https://redux.js.org/usage/structuring-reducers/normalizing-state-shape — *"an update to a deeply nested data object could force totally unrelated UI components to re-render even if the data they're displaying hasn't actually changed."*

### Opções anti-flicker do próprio poll
- **`refetchInterval`** (número ou função). `refetchIntervalInBackground` padrão `false` — deixe assim para chat (dreno de bateria/quota)
- **Mesma query key ⇒ sem flicker por construção**: durante refetch em background, o `data` anterior fica na tela com `isFetching = true`. **Nunca condicione a lista a `isFetching`** — condicione um indicador discreto
- **`placeholderData: keepPreviousData`** só é preciso quando a *key muda* (trocar de thread, paginar). Sem ele: *"The UI jumps in and out of the `success` and `pending` states because each new page is treated like a brand new query."* Em v5 é `placeholderData: keepPreviousData` importado de `@tanstack/react-query` (o booleano `keepPreviousData: true` da v4 sumiu)
- **`notifyOnChangeProps: ['data']`** — instrumento bruto que impede o toggle de `isFetching` de re-renderizar o feed a cada poll. ⚠️ Rest destructuring (`{...rest}`) derrota o tracking automático por Proxy
- **`select`** precisa ser referência estável (escopo de módulo ou `useCallback`), senão re-roda a cada render
> Fontes: https://tanstack.com/query/latest/docs/framework/react/reference/useQuery · https://tanstack.com/query/latest/docs/framework/react/guides/background-fetching-indicators · https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries

## E.3 Específicos do React 19

### `useSyncExternalStore` — a armadilha do loop infinito
```js
const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)
```
> *"The store snapshot returned by `getSnapshot` **must be immutable**. If the underlying store has mutable data, return a new immutable snapshot if the data has changed. Otherwise, **return a cached last snapshot**."*

```js
// 🔴 objeto novo a cada chamada -> loop infinito ("The result of getSnapshot should be cached")
function getSnapshot() { return { todos: myStore.todos }; }
// ✅ devolve a referência guardada
function getSnapshot() { return myStore.todos; }
```
Segunda armadilha: `subscribe` definido inline **reassina a cada render** — içar para escopo de módulo ou `useCallback`. `getServerSnapshot` é obrigatório sob SSR.
> https://react.dev/reference/react/useSyncExternalStore

### React Compiler 1.0 — não salva você aqui
Estável desde 2025-10-07. *"For new code, we recommend relying on the compiler for memoization"*. **Mas o limite decisivo:** *"React Compiler's memoization is **not shared across multiple components or hooks**."* O compilador memoiza *dentro* de um componente, com chave nas entradas dele. Se o poller entrega um array novo de objetos novos a cada 2 s, o cache invalida a cada 2 s. **§E.2 (estabilidade de referência na camada de dados) é pré-requisito, não alternativa.**
> https://react.dev/blog/2025/10/07/react-compiler-1 · https://react.dev/learn/react-compiler/introduction

### `useOptimistic` — ver §B.7 para a armadilha com polling
Uso canônico com id estável gerado no cliente e ecoado pelo servidor, para que a transição otimista→confirmada seja mudança de props na mesma `key`.
> https://react.dev/reference/react/useOptimistic

### Transitions
- `useTransition`: atualizações em transição *"are non-blocking and will not display unwanted loading indicators"*. ⚠️ *"A state update marked as a Transition **will be interrupted by other state updates**."* Envolver o `setMessages` do poll em `startTransition` mantém a digitação no composer responsiva enquanto um feed de 500 mensagens reconcilia
- `useDeferredValue(value, initialValue?)`: *"tells React that re-rendering the list can be deprioritized so that it doesn't block the keystrokes."* ⚠️ *"This optimization requires `SlowList` to be wrapped in `memo`"*
> https://react.dev/reference/react/useTransition · https://react.dev/reference/react/useDeferredValue

### `<Activity>` — React 19.2, ótimo para troca de thread
Modos `visible` / `hidden`. *"When the boundary becomes visible again, React will reveal the children **with their previous state restored**"* — **incluindo posição de scroll**. ⚠️ Enquanto `hidden`, efeitos são limpos — o poller precisa viver **acima** da barreira.
Também 19.2: `useEffectEvent` — aplicável direto ao efeito de auto-scroll, que precisa do `isAtBottom` mais recente sem reassinar seus observers. Regra: **nunca colocar Effect Event em array de dependências**.
> https://react.dev/blog/2025/10/01/react-19-2 · https://react.dev/reference/react/useEffectEvent

## E.4 Gestão de scroll

### Scroll anchoring nativo NÃO é solução de "grudar no fim"
MDN: *"The `overflow-anchor` CSS property provides a way to **opt out** of the browser's scroll anchoring behavior"*, e é **ligado por padrão** onde há suporte. Status MDN: **"Limited availability — This feature is not Baseline because it does not work in some of the most widely-used browsers."** caniuse: **79,8% global**; **Safari desktop só em Technology Preview; Safari iOS sem suporte até a 26.5.**

E o pior: o anchoring **desliga sozinho** se, no nó âncora ou ancestrais, mudar `top/left/right/bottom`, `margin`, `padding`, qualquer propriedade de largura/altura, `transform`/`translate`/`scale`/`rotate`, ou `position` dentro do container. **Uma mensagem em streaming mudando de altura É uma mudança de altura na âncora.**
> https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor · https://caniuse.com/css-overflow-anchor

**Onde ajuda:** prepend de histórico acima do viewport no Chromium/Firefox — prevenção de salto de graça. Trate como progressive enhancement.
**Onde desligar:** em qualquer scroller cujo `scrollTop` você anima, e em toda lista virtualizada (a virtua faz `overflowAnchor: "none"` com o comentário *"opt out browser's scroll anchoring on header/footer because it will conflict to scroll anchoring of virtualizer"*).

### `scrollIntoView` vs `scrollTop`
MDN `scrollIntoView`: opção `container` tem **padrão `"all"`** ⇒ **todo ancestral rolável, inclusive o viewport da página, é rolado** — um painel de chat dentro de página rolável arrasta o documento inteiro. MDN documenta também a Promise de retorno com `{ interrupted: boolean }`.
MDN `scroll-behavior: smooth`: aplica **só a scroll programático**, com *"a user-agent-defined easing function over a user-agent-defined duration"* — você **não** pode encurtar.

⇒ **`scrollIntoView({behavior:'smooth'})` por token está errado:** cada token reinicia uma animação de duração definida pelo UA, a anterior é `interrupted` e re-mira no meio do caminho — a lista treme e nunca assenta. Pior: no Chromium, scroll suave programático concorrente com gesto de roda **cancela o scroll do próprio usuário**. Use `behavior: "instant"` dentro de `requestAnimationFrame`, ou uma spring sua.
`overscroll-behavior: contain` no scroller de mensagens impede encadeamento para a página e mata o pull-to-refresh no topo da thread.
> https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView · https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-behavior · https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior

### `use-stick-to-bottom` — a escolha por padrão
`use-stick-to-bottom@1.1.6`, MIT, **zero dependências de runtime**, peer `react ^16.8 || ^17 || ^18 || ^19`, publicado 2026-06-04. É o que o `Conversation` do AI Elements usa.

```ts
const { contentRef, scrollRef, scrollToBottom, stopScroll,
        isAtBottom, isNearBottom, escapedFromLock, state } = useStickToBottom(opts)
```
Constantes do fonte: `DEFAULT_SPRING_ANIMATION = { damping: 0.7, stiffness: 0.05, mass: 1.25 }`, `STICK_TO_BOTTOM_OFFSET_PX = 70`, `RETAIN_ANIMATION_DURATION_MS = 350`.

Racional do README, literal:
> *"Uses a custom implemented smooth scrolling algorithm, featuring velocity-based spring animations... Other libraries use easing functions with durations instead, but these doesn't work well when you want to stream in new content with variable sizing — which is common for AI chatbot use cases."*
> *"Does not require `overflow-anchor` browser-level CSS support which Safari does not support."*
> *"Clever logic distinguishes the user scrolling from the custom animation scroll events (without doing any debouncing which could cause some events to be missed)."*
> *"Uses the modern, yet well-supported, ResizeObserver API to detect when content resizes."*

O handler de `wheel` sobe de `event.target` até o scroller e, se `deltaY < 0`, marca `escapedFromLock`, com o comentário: *"The browser may cancel the scrolling from the mouse wheel if we update it from the animation in meantime. To prevent this, always escape when the wheel is scrolled up."* Também suprime auto-scroll durante seleção de texto (`mousedown`/`mouseup` + `getSelection()`).
> https://github.com/stackblitz-labs/use-stick-to-bottom

### O detalhe que toda implementação caseira erra
assistant-ui, teste de "está no fim" com tolerância de **1px**:
```ts
const newIsAtBottom =
  Math.abs(div.scrollHeight - div.scrollTop - div.clientHeight) <= 1 ||
  div.scrollHeight <= div.clientHeight;
```
E o guarda que distingue scroll do usuário de crescimento de conteúdo — **`lastScrollTop > scrollTop && lastScrollHeight === scrollHeight`**, com o comentário original: *"scrollHeight equality rules out content-driven shifts being misread as user scroll-up."* Mais um `pointerdown` que cancela intenção pendente, senão ela *"hijack the next content growth, e.g. expanding a collapsible tool call."*
Observa conteúdo com `ResizeObserver` **+** `MutationObserver({childList, subtree, attributes, characterData})`, filtrando mutações só-de-estilo *"to prevent feedback loops"*.
> https://github.com/assistant-ui/assistant-ui/blob/main/packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts

**O limiar é a alavanca mais visível, e as três referências discordam de propósito:** 1px (assistant-ui, estrito) · 70px (`use-stick-to-bottom`) · 100px (`vercel/ai-chatbot`, tolerante). **Escolha deliberadamente.**

### Sequenciamento React
- `useLayoutEffect` — *"fires **before the browser repaints the screen**."* Correções de scroll vão aqui, não em `useEffect`, para caírem no mesmo frame e nunca serem pintadas
- `flushSync` — só para "medir e então rolar" no envio do usuário. *"Using `flushSync` is uncommon and can hurt the performance of your app… Use sparingly."* Prefira `ResizeObserver`
> https://react.dev/reference/react/useLayoutEffect · https://react.dev/reference/react-dom/flushSync

## E.5 Virtualização — quando, e o preço

**Nenhuma biblioteca publica um limiar em número de mensagens.** O único número duro é de navegador: Lighthouse avisa acima de ~800 nós no `body` e erra acima de ~1.400. Uma bolha rica tem 20–60 nós ⇒ a linha de erro cai por volta de **~35 mensagens**, o que ninguém percebe como lento.

**O descompasso é o ponto:** o que trava um chat não é contagem de nós, é **reconciliação + layout do React sobre centenas de subárvores de markdown a cada tick de streaming**. Ordem de operações: (1) estabilidade de referência, (2) `memo` por mensagem, (3) `content-visibility: auto`, (4) **só então** virtualizar — na prática, acima de ~200–500 mensagens ricas *com 1–3 já feitos*.
> https://developer.chrome.com/docs/lighthouse/performance/dom-size/

**Preços que você herda, cada um com uma vítima documentada:**
- **Ctrl+F / Cmd+F morre.** A CircleCI shipou `react-virtualized` para output de step e **removeu** depois de pesquisa mostrar usuários falhando em achar texto. Sem solução genérica: issues abertas em Angular CDK (#10127), react-virtualized (#1835), TanStack (#481). A saída (busca no app → índice → `scrollToIndex`) é feature, não remendo
- **Scroll anchoring nativo tem que ser desligado** — as três libs fazem compensação própria
- **Seleção de texto entre mensagens quebra** — linhas absolutas que desmontam ao rolar; Cmd+A copia só o renderizado. Nenhuma das libs resolve
- ⚠️ **Margin é invisível para a medição.** `contentRect` do `ResizeObserver` exclui margin. **Use padding nas linhas de mensagem, nunca margin**
> https://circleci.com/changelog/find-cmd-f-now-working-in-the-new-ui · https://virtuoso.dev/react-virtuoso/troubleshooting/

**Comparativo (agosto/2026):**

| Lib | Versão / licença | Veredito para chat |
|---|---|---|
| **`@tanstack/react-virtual`** | 3.14.9 + `virtual-core` 3.17.7, MIT | ⭐ **melhor opção gratuita hoje.** Ganhou modo `anchorTo:'end'` + `followOnAppend` (release note: *"keeps an end-pinned viewport pinned when the last item grows during streaming output"*; *"The follow only occurs if the viewport was already at the end before the append. **Users who scrolled up to read history are not pulled down.**"*). ⚠️ **Pinar `virtual-core >= 3.17.7`** — versões abaixo carregam bug de drift durante streaming (PR #1236: *"a streaming chat message that spans the fold and grows at its bottom, dragging `scrollTop` downward token by token"*; PR #1239 corrige um segundo salto). Medição exige `ref={virtualizer.measureElement}` **e** `data-index={virtualItem.index}` |
| **`react-virtuoso`** | 4.18.11, MIT | Pior encaixe agora. `followOutput` *"scrolls down only if the list is already at the bottom"* (bom), mas `atBottomThreshold` padrão é **4 px** (flapeia com `devicePixelRatio` fracionário — subir para 50–80). **Não há tutorial de prepend na doc v4** (`firstItemIndex` só existe em JSDoc; links de blog para `virtuoso.dev/prepend-items/` dão 404). E `followOutput` é **quebrado conhecido quando um item redimensiona** (issue #195) — exatamente o caso de streaming |
| **`@virtuoso.dev/message-list`** | 1.17.1, **licença literal `"Commercial"`** | Único onde streaming e prepend são **intenções declaradas, não heurísticas** (`scrollModifier: {type:'items-change'}` documentado para *"a streaming bot response"*; `'prepend'` sem aritmética de `firstItemIndex`). Assinatura anual **por desenvolvedor** |
| **`virtua`** | 0.50.1, MIT, ~3 kB | Menor, medição automática de verdade, mas o "grudar no fim" é código seu. ⚠️ **Não existe prop `reverse`** na API React. `shift` precisa ser **transitório** (true só no frame do prepend). Chaves por id são obrigatórias (o cache de tamanho é por key) |

## E.6 `content-visibility` — os 80% baratos

```css
.message { content-visibility: auto; contain-intrinsic-size: auto 120px; }
```
MDN, `auto`: *"turns on layout containment, style containment, and paint containment. If the element is not relevant to the user, it also skips its contents. **Unlike hidden, the skipped contents must still be available as normal to user-agent features such as find-in-page, tab order navigation, etc., and must be focusable and selectable as normal.**"* E: *"Off-screen content... **remains in the document object model and the accessibility tree**."*

⭐ **É a diferença decisiva em relação à virtualização: Cmd+F, ordem de tabulação e seleção de texto sobrevivem.**

`contain-intrinsic-size` é **obrigatório** — sem ele, elementos contidos colapsam para altura zero e a barra de rolagem pula. A forma `auto <length>` dá "último tamanho lembrado" — *"especially useful for infinite scrollers, which can now automatically improve sizing estimation over time"*. Benchmarks citados: render inicial **232 ms → 30 ms (7×)**.
Suporte: **93,19% global** (Chrome/Edge 85, Firefox 125, Safari 18.0 desktop+iOS) — **Baseline 2024**.

⚠️ **Onde para:** o mantenedor do react-virtuoso: *"you will still have to fetch all data from the server and render it with React — which is a lot of work"*, e *"browser can do its tricks only after React does its rendering."* Compra pintura e layout; **não compra reconciliação**. Num chat com *polling*, reconciliação é o custo dominante — então é **complemento** de §E.2/E.7, não substituto.
> https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility · https://web.dev/articles/content-visibility · https://caniuse.com/css-content-visibility

## E.7 Não re-renderizar o feed inteiro a cada poll — três alavancas

**(a) Limitar a frequência.** AI SDK: *"By default, the `useChat` hook will trigger a render every time a new chunk is received. You can throttle the UI updates with the `throttle` option."*
```ts
const { messages } = useChat({ throttle: 50 })                 // v6/v7
const { messages } = useChat({ experimental_throttle: 50 })    // v5 e anteriores
```
⚠️ Ambas as gerações carregam: **"This feature is currently only available for React."** Valor do exemplo oficial: **50 ms**. Coalesce as escritas de estado; **não** toca no stream de rede. **Throttle sozinho ainda re-renderiza toda mensagem da lista a cada tick** — daí (b).
No equivalente com polling, a alavanca é o `refetchInterval`: 2–5 s bate 500 ms.
> https://ai-sdk.dev/docs/ai-sdk-ui/chatbot

**(b) Separar histórico assentado da cauda em streaming, com `memo` por mensagem.** Padrão do `vercel/ai-chatbot` (tag `v3.0.23` — ⚠️ **removido do `main`**, os arquivos mudaram para `components/chat/` e a memoização foi apagada):
```jsx
export const PreviewMessage = memo(PurePreviewMessage, (prev, next) => {
  if (prev.isLoading !== next.isLoading) return false;
  if (prev.message.id !== next.message.id) return false;
  if (!equal(prev.message.parts, next.message.parts)) return false;   // fast-deep-equal
  if (!equal(prev.vote, next.vote)) return false;
  return true;
});
```
Compara `id` por identidade, e faz deep-compare **só** em `parts`/`vote`. Avisos da react.dev valem inteiros: *"**If you provide a custom `arePropsEqual` implementation, you must compare every prop, including functions**"* e *"**Avoid doing deep equality checks inside `arePropsEqual` unless you are 100% sure that the data structure you're working with has a known limited depth.**"* — `message.parts` qualifica; o objeto mensagem inteiro não.

**Estrutura:** `<HistoricoAssentado messages={settled} />` memoizado no id da última assentada (re-renderiza **zero vezes** durante o stream) como irmão de `<CaudaStreaming message={last} />`.
> https://github.com/vercel/ai-chatbot/blob/v3.0.23/components/message.tsx · https://react.dev/reference/react/memo

**(c) Dividir a mensagem em streaming em blocos de markdown memoizados.** Cookbook oficial do AI SDK. Problema declarado: *"the entire conversation history is re-rendered with each new token."*
```js
const parseMarkdownIntoBlocks = (md) => marked.lexer(md).map(t => t.raw);
const MemoizedMarkdownBlock = memo(
  ({ content }) => <ReactMarkdown>{content}</ReactMarkdown>,
  (prev, next) => prev.content === next.content,
);
const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);
// key={`${id}-block_${index}`}
```
> *"Once a markdown block is fully parsed, it's cached. New tokens only affect the currently-streaming block, leaving completed blocks untouched."*

Importa desproporcionalmente porque **syntax highlighting de bloco de código é a coisa mais cara de um render de chat** e, sem a divisão em blocos, re-roda a cada token. Mesma técnica no Streamdown (`/docs/memoization`).
> https://ai-sdk.dev/cookbook/next/markdown-chatbot-with-memoization

## E.8 Stack recomendado

1. **Dados:** TanStack Query com `refetchInterval` 2–5 s, structural sharing LIGADO, **só JSON no `queryFn`** (parsear Date no componente), `notifyOnChangeProps: ['data']`, `placeholderData: keepPreviousData` só onde a key muda
2. **Chaves:** id do servidor em todo lugar. Id estável gerado no cliente para envio otimista, ecoado pelo servidor
3. **Render:** `memo` por mensagem com comparador `id` + `parts`; histórico assentado em subárvore memoizada própria; divisão em blocos de markdown para a cauda
4. **Scroll:** `use-stick-to-bottom@1.1.6`. **Não escrever à mão** — o guarda de igualdade de `scrollHeight` e o "wheel cancela scroll programático" são as duas coisas que toda versão caseira erra
5. **Performance, nesta ordem:** `content-visibility: auto` + `contain-intrinsic-size: auto <h>` primeiro (93% de suporte, preserva Cmd+F). Virtualizar só se não bastar — então `@tanstack/react-virtual` com `anchorTo:'end'` + `followOnAppend` + `getItemKey` devolvendo ids, **`virtual-core` pinado ≥ 3.17.7**
6. **CSS:** padding e não margin nas linhas; `overflow-anchor: none` em qualquer scroller que você anima; `overscroll-behavior: contain` no scroller de mensagens

---

# CHECKLIST DE AUDITORIA

> Verificações **objetivas** — cada uma dá um veredito verificável, não uma opinião. Um revisor roda essa lista contra a implementação e diz se está profissional ou amador. Marcado **[BLOQ]** o que, se falhar, é defeito de produto e não refinamento.

### Composer — teclado e entrada
1. **[BLOQ]** O `textarea` **NÃO** tem `disabled` amarrado a `status`/`isRunning`. `document.querySelector('textarea').disabled` deve ser `false` enquanto o agente processa. *(§A.3)*
2. **[BLOQ]** Existe guarda de composição: `grep -n "isComposing\|compositionstart"` no composer retorna resultado, e o Enter é ignorado enquanto a composição está ativa. Teste manual: digitar `~` + `a` (til morto pt-BR) e apertar Enter → não envia no meio da composição. *(§B.3)*
3. Existe o guarda extra do Safari/iOS (timestamp de `compositionend` + janela de ~500 ms), ou está registrado como limitação conhecida. *(§B.3)*
4. **[BLOQ]** Enter envia e Shift+Enter quebra linha **em desktop**; em dispositivo de toque Enter quebra linha e o botão Enviar existe e está visível. Teste: emular touch no DevTools, apertar Enter → insere newline. *(§B.2)*
5. O textarea tem `enterkeyhint="send"`. *(§B.2)*
6. Auto-resize funciona: digitar 10 linhas cresce até um teto e depois aparece scroll interno — `getComputedStyle(ta).fieldSizing === 'content'` ou existe fallback JS, e `maxHeight !== 'none'`. *(§B.1)*
7. Colar uma imagem (Ctrl+V) da área de transferência cria um anexo — `onPaste` lê `clipboardData.items` e faz `getAsFile()`. *(§B.4)*
8. Arrastar arquivo sobre o composer dá feedback visual e o drop anexa — existe `preventDefault()` no `dragover` (sem ele o drop nem acontece). *(§B.5)*
9. Cada anexo tem chip com botão remover; e `URL.revokeObjectURL` aparece em **todos** os caminhos de saída (remover, limpar, desmontar, submeter). `grep -c revokeObjectURL` ≥ `grep -c createObjectURL`. *(§B.6)*
10. Depois de enviar, o foco continua no textarea (`document.activeElement === textarea`). *(§B.8)*

### Composer — fila e estado de "ocupado"
11. **[BLOQ]** Com o agente processando, digitar e apertar Enter **produz efeito visível** — o item entra numa fila mostrada na UI, ou é injetado no turno. Não pode "não sair do composer". *(§A.3)*
12. **[BLOQ]** O botão principal vira **Parar** durante o run (não fica desabilitado), com `aria-label` correspondente. *(§A.3, §B.9d)*
13. A fila é **do servidor**, não só do React: uma mensagem chegando pelo Telegram com o agente ocupado aparece na mesma fila do painel. Teste: mandar pelo Telegram durante um run e ver o item no painel. *(§A.4)*
14. Existe distinção explícita entre **enfileirar** e **dirigir/interromper** (modo, atalho ou botão) — não é um único comportamento implícito. *(§A.2, §A.9)*
15. A fila drena no **fim de turno real** (evento terminal do NDJSON), não na primeira pausa entre chamadas de ferramenta. Teste: enfileirar durante uma tarefa com várias ferramentas e verificar que o item não entra no meio. *(§A.5)*
16. Cada item da fila é **cancelável individualmente** e mostra ordem/posição. *(§A.8)*
17. Existe chave de idempotência gerada no cliente por envio (`clientRequestId`/UUID), e o servidor deduplica. Teste: reenviar o mesmo request duas vezes → uma mensagem só. *(§A.6, §B.7)*
18. A fila sobrevive a um F5 (vem do servidor no polling, não só do estado local). *(§A.6)*
19. Há teto de fila com política definida (rejeitar/resumir/descartar) — não cresce infinito. *(§A.2)*

### Feed — render e consistência entre provedores
20. **[BLOQ]** `git grep -n "provider === \|isCodex\|isClaude"` **não** retorna nada em componente de render. A diferença entre provedores mora só no adaptador. *(§D.1)*
21. **[BLOQ]** Existe um tipo de mensagem interno único, com `parts` tipadas por união discriminada — a mensagem **não** é armazenada como string de markdown solta. *(§D.2)*
22. Existe uma função pura por provedor (`fromClaudeCodeStreamJson`, `fromCodexExecJson`) com **teste de contrato** — fixture NDJSON de cada CLI → mesma saída normalizada. *(§D.3, §D.7)*
23. **[BLOQ]** Toda parte de tipo desconhecido cai num **Fallback** que renderiza algo (bloco cru colapsável). Teste: injetar um `type` inventado no adaptador → aparece alguma coisa, não some. *(§D.4)*
24. Estado por parte (`streaming` vs `done`) existe e é usado, para que "digitando" e "pronto" pareçam iguais nos dois provedores. *(§D.2)*
25. Um único renderizador de markdown para os dois provedores (mesmo `prose`, mesmo highlighter). *(§D.6)*
26. Markdown incompleto é tratado antes do render (Streamdown/`remend` ou equivalente). Teste: injetar uma mensagem com um ``` solitário → não engole o resto. *(§C.6.2)*

### Truncamento
27. **[BLOQ]** Bissecção por camada executada e o resultado registrado: comprimento da mensagem em cada uma das 6 fronteiras. Sem isso, qualquer conclusão sobre truncamento é chute. *(§C.0)*
28. `getComputedStyle` no corpo da mensagem: `webkitLineClamp === 'none'`, `whiteSpace !== 'nowrap'`, `textOverflow !== 'ellipsis'`. *(§C.1.1, C.1.4, C.2)*
29. Varredura de ancestrais rodada: nenhum ancestral com `overflow` recortando **e** `scrollHeight > clientHeight`. *(§C.1.2)*
30. **[BLOQ]** Auditoria da cadeia flex/grid: todo item da cadeia entre o scroller e o corpo da mensagem tem `min-w-0`/`min-h-0` (ou é scroll container). Rodar o snippet do §C.1.5 e não ter nenhum "PRECISA". *(§C.1.5)*
31. Texto longo sem espaço (URL, hash, linha de código) usa `overflow-wrap: anywhere` / `wrap-anywhere`, **não** `break-word` (que não abaixa o `min-content`). *(§C.1.6)*
32. Se usa `prose`: ou `max-w-none`, ou o `max-width: 65ch` é intencional e documentado. *(§C.2)*
33. Blocos de código: `<pre>` rola horizontalmente (`overflow-x: auto`) **com barra visível ou affordance**, ou quebra linha — não some silenciosamente. *(§C.2)*
34. Grep de cortes duros no backend: `git grep -nE "\[:[0-9]+\]|\.slice\(0, *[0-9]+\)|SUBSTRING\(|_short_text|_snippet|limit=[0-9]+"` — cada ocorrência classificada como "label/preview" ou "corpo de mensagem". Nenhuma no caminho do corpo. *(§C.7)*
35. Nenhum número redondo suspeito: contar mensagens renderizadas e caracteres da maior mensagem; se cair em 50/100/191/280/500/1000/20000/65535, investigar antes de olhar CSS. *(§C.3, §C.7)*
36. Se o caminho passa por nginx: `proxy_buffering off`, `proxy_read_timeout` folgado e `client_max_body_size` acima do maior payload real — na rota de streaming. *(§C.4, §C.5.4)*
37. Se há middleware/proxy no Next: `experimental.proxyClientMaxBodySize` conferido (trunca **com 200 OK**). *(§C.4)*
38. Decodificação de stream usa `TextDecoder` com `{ stream: true }` (cliente) e `string_decoder` (Node) — `grep -n "TextDecoder\|toString('utf8')"`. E não há `�` no texto renderizado. *(§C.5.3)*
39. Parser de SSE mantém buffer entre chunks e afirma cauda vazia no fim (`if (buffer.length) console.error(...)`). *(§C.5.2)*
40. `curl -N` no endpoint de stream: o arquivo termina em `0a0a` (linha em branco final). *(§C.5.1)*
41. Payload de SSE passa por `JSON.stringify` (nenhum `\n` cru depois de `data: `). *(§C.5.1)*
42. Query sobre mensagens armazenadas: `(content.match(/```/g)||[]).length % 2` — nenhuma linha ímpar, ou as ímpares estão identificadas. *(§C.6.1)*
43. Se captura de tmux ainda é usada: `-S -` e `-J` presentes, `history-limit` conferido, **e** existe plano de migrar para o JSONL do CLI. Versão do Claude Code ≥ **2.1.214**. *(§C.8)*

### Feed — performance e identidade
44. **[BLOQ]** `git grep -n "key={i}\|key={index}"` na lista de mensagens retorna vazio. Chave = id do servidor. *(§E.1)*
45. **[BLOQ]** O poll **não** faz `setMessages(await res.json())` cru. Há structural sharing (TanStack Query com dado JSON puro) ou merge por id reusando referências. Teste: dois polls sem mudança de dado ⇒ `prevMessages[0] === nextMessages[0]` é `true`. *(§E.2)*
46. Nenhum `new Date(...)` dentro do `queryFn` (mata o structural sharing silenciosamente). *(§E.2)*
47. A lista **não** é condicionada a `isFetching`/`isLoading` (senão pisca a cada poll). *(§E.2)*
48. Componente de mensagem é `memo` com comparador que compara `id` por identidade e faz deep-compare só em `parts`. *(§E.7b)*
49. Histórico assentado e cauda em streaming são subárvores separadas — a histórica não re-renderiza durante o stream. Verificar com React DevTools Profiler: um tick de streaming não deve destacar mensagens antigas. *(§E.7b)*
50. Markdown da mensagem em streaming é dividido em blocos memoizados; blocos completos não re-renderizam por token. *(§E.7c)*
51. Se usa `useChat`: `throttle`/`experimental_throttle` configurado (≈50 ms). *(§E.7a)*
52. Auto-scroll usa `use-stick-to-bottom` ou equivalente com: tolerância explícita, guarda de igualdade de `scrollHeight`, e `ResizeObserver` no conteúdo. **Nada de `scrollIntoView({behavior:'smooth'})` por token.** *(§E.4)*
53. **[BLOQ]** Rolar para cima durante o streaming **não** puxa o usuário de volta para baixo. Teste manual obrigatório. *(§E.4)*
54. Botão "ir para o fim" aparece só quando `!isAtBottom`. *(§E.4)*
55. `overflow-anchor: none` em qualquer scroller cujo `scrollTop` é animado; `overscroll-behavior: contain` no scroller de mensagens. *(§E.4)*
56. Linhas de mensagem usam **padding**, não margin (margin é invisível para `ResizeObserver`). *(§E.5)*
57. Se ainda não virtualiza: `content-visibility: auto` + `contain-intrinsic-size: auto <h>` aplicados (preserva Cmd+F). Se virtualiza: `@tanstack/virtual-core` pinado ≥ 3.17.7 e há plano para busca no app (Cmd+F morreu). *(§E.5, §E.6)*
58. `useSyncExternalStore` (se usado): `getSnapshot` devolve referência cacheada, `subscribe` é estável. Nenhum aviso "The result of getSnapshot should be cached" no console. *(§E.3)*

### Acessibilidade
59. **[BLOQ]** O container do feed tem `role="log"` (ou `role="feed"` com o contrato completo) **e** nome acessível (`aria-label`/`aria-labelledby`). *(§B.9)*
60. **Não** há `aria-live="assertive"` no feed nem em nenhum elemento que recebe texto em streaming. *(§B.9b)*
61. A live region existe vazia no carregamento (não é injetada no DOM junto com o primeiro conteúdo). *(§B.9e)*
62. Todo botão do composer tem `aria-label`; o botão que muda de função muda de nome. *(§B.9d)*
63. Navegação por teclado: Tab chega ao composer, aos anexos e ao botão; Escape tem função definida (cancelar geração ou limpar). *(§A.9, §B.2)*

### Higiene geral
64. Existe teste automatizado que reproduz o cenário "usuário envia enquanto o agente processa" — não só verificação manual. *(§A)*
65. Existe fixture NDJSON de cada CLI versionada no repo, e um teste que falha quando o formato do CLI muda. *(§D.7)*
66. Existe uma métrica ou log de "mensagem entregue com comprimento X" nas fronteiras 3 e 5, para que truncamento futuro seja detectado sem bissecção manual. *(§C.0)*

---

## Fontes principais (índice)

**Documentação oficial**
- Vercel AI SDK — https://ai-sdk.dev/docs/ai-sdk-ui/chatbot · https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message · https://ai-sdk.dev/cookbook/next/markdown-chatbot-with-memoization
- assistant-ui — https://www.assistant-ui.com/docs/runtimes/custom/external-store · https://www.assistant-ui.com/docs/api-reference/primitives/composer.md · https://www.assistant-ui.com/docs/primitives/message
- LangChain / LangGraph — https://docs.langchain.com/langgraph-platform/double-texting · https://docs.langchain.com/oss/python/langchain/frontend/message-queues
- GitHub Copilot SDK — https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/steering-and-queueing
- OpenClaw — https://docs.openclaw.ai/concepts/queue
- AG-UI — https://docs.ag-ui.com/concepts/events
- React — https://react.dev/reference/react/memo · https://react.dev/reference/react/useOptimistic · https://react.dev/reference/react/useSyncExternalStore · https://react.dev/learn/rendering-lists · https://react.dev/learn/preserving-and-resetting-state
- TanStack Query — https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations
- MDN — `field-sizing`, `isComposing`, `log_role`, `overflow-anchor`, `content-visibility`, `TextDecoder.decode`, `scrollIntoView`, `overflow-wrap`, `min-width`, Live regions
- W3C — https://www.w3.org/TR/css-flexbox-1/#min-size-auto · https://www.w3.org/WAI/ARIA/apg/patterns/feed/
- WHATWG — https://html.spec.whatwg.org/multipage/server-sent-events.html
- CommonMark — https://spec.commonmark.org/0.31.2/
- Tailwind — field-sizing, line-clamp, text-overflow, overflow-wrap, upgrade-guide, preflight
- Vercel / Next.js / nginx — limites de função, `proxyClientMaxBodySize`, `proxy_buffering`
- Claude Code headless — https://code.claude.com/docs/en/headless

**Código-fonte de implementações de referência (lido diretamente)**
- Vercel AI Elements — `packages/elements/src/prompt-input.tsx`, `packages/elements/src/conversation.tsx`
- Open WebUI — `src/lib/components/chat/MessageInput.svelte`
- LibreChat — `client/src/hooks/Chat/useSteering.ts`, `client/src/store/families.ts`, `client/src/components/Chat/Input/ChatForm.tsx`
- assistant-ui — `packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts`
- use-stick-to-bottom — `src/useStickToBottom.ts`
- tailwindcss-typography — `src/styles.js`

**Issues / discussões citadas**
- https://github.com/vercel/ai/issues/4891 (status não volta a `ready` depois de `stop()`)
- https://github.com/anthropics/claude-code/issues/57497 · /49373 · /57624 · /26388 · /29224 · /24612
- https://github.com/tailwindlabs/tailwindcss/discussions/12468 · /13431 · /6677
- https://github.com/open-webui/open-webui/issues/16615 (bug de composição no Safari iOS)
- https://github.com/petyosi/react-virtuoso/issues/195 (`followOutput` quebrado com item que redimensiona)
- https://github.com/TanStack/virtual/pull/1236 · /1239 (drift de scroll durante streaming)
- https://zenn.dev/coji/articles/vercel-ai-sdk-streaming-backpressure (stream truncado por backpressure de re-render)
