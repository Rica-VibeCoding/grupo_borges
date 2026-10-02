# O feed do turno — as quatro deduções, medidas

Pesquisa pedida pelo Pavan em 02/10/2026. Só leitura e medição — nenhum arquivo
de código foi tocado. Repos: `apps/cockpit`, `apps/api`, `packages/cockpit-core`.

**Corpus.** Não há tabela de mensagens no SQLite. O feed lê `task_events`, que é
o espelho do JSONL do Claude Code (`apps/api/db/grupo_borges.db`, 773 MB,
`GB_DB_PATH` do `apps/api/.env`). Janela: **28/09 a 02/10/2026**. Volume medido:

- 46.579 eventos `jsonl:user` + `jsonl:assistant`
- 15.583 `tool_use` distintos · 15.589 `tool_result` distintos
- 9.427 blocos `thinking`

Os arquivos de 0 byte com nome parecido em `apps/api/db/` são iscas, como
avisado. O caminho válido é o `.db` de 773 MB.

---

## Dedução 1 — grupo preso por `tool_use` órfão

> **PARCIAL.** O mecanismo está confirmado no código. A frequência é que não
> sustenta "aberto horas depois": **2 casos em 15.583 `tool_use` (0,013%)**.

### O mecanismo — CONFIRMADO

Três peças, todas lidas:

1. `components/feed/execucao-do-item.ts:111-119` — sem resultado no lookup,
   `estado: 'running'` (ou `requires-action` para `AskUserQuestion`).
2. `components/feed/resumo-do-grupo.ts:94-97` — **um** membro `rodando` põe o
   grupo inteiro em `rodando`.
3. `components/feed/grupo-ferramentas.tsx:49-50` — `emVoo` governa `aberto`
   quando não há preferência do dedo. O grupo nasce aberto e nunca fecha.

Não há prazo. A linha viva tem um (`VALIDADE_LINHA_VIVA_MS = 300_000`,
`linha-viva.ts:80`); o grupo não tem nenhum. E o `isRunning`
(`lib/spike/corrida-em-voo.ts`) desliga sozinho no fim do turno — então a
bolinha pode dizer *parado* enquanto o grupo diz *Executando…*, que é a
contradição que o próprio módulo diz combater.

### A medição

Comando (Python, sem `sqlite3` no PATH da VPS):

```bash
python3 - <<'EOF'
import sqlite3, json
c=sqlite3.connect('file:/home/clawd/repos/grupo_borges/apps/api/db/grupo_borges.db?mode=ro',uri=True)
usos, resultados = {}, set()
for (raw,) in c.execute("select raw_jsonl from task_events where kind in ('jsonl:assistant','jsonl:user') and raw_jsonl is not null"):
    try: e=json.loads(raw)
    except: continue
    cont=(e.get('message') or {}).get('content')
    if not isinstance(cont,list): continue
    for p in cont:
        if not isinstance(p,dict): continue
        if p.get('type')=='tool_use': usos[p['id']]=p.get('name')
        elif p.get('type')=='tool_result': resultados.add(p['tool_use_id'])
print(len(usos), 'tool_use |', len(resultados), 'tool_result |',
      sum(1 for k in usos if k not in resultados), 'orfaos')
EOF
```

Resultado: **2 órfãos**, ambos `Bash`, ambos do `pavan`, ambos na sessão
`fb9a39bd-e0ff-4ae9-a907-f50c54342f63` (01/10/2026):

- `toolu_01C4ujD7oWtai4hoAJnNp4JU` — 04:01:12. Depois dele vem
  `queue-operation` (04:02:11) e um `<task-notification>`. O turno foi
  atravessado por um evento de fila; a ferramenta nunca devolveu.
- `toolu_015vBbur5GJfKF9WJumKm59x` — 06:22:37. Depois dele vêm mais três
  `tool_use` **sem nenhum `tool_result`** e o log morre. É o "turno que morre sem
  despedida" — o caso que `linha-viva.ts:67-79` já documenta para a linha viva.

### As hipóteses de causa — DERRUBADAS as duas

- **"result cortado pelo `_corta_resultados_grandes`"** — não.
  `apps/api/routers/agents.py:2665` trunca **string** dentro do resultado
  (`fonte["data"] = ""`, `_corta_texto`). O bloco `tool_result` continua inteiro
  no log, com o `tool_use_id`. Nunca transforma resultado em órfão.
- **"filtrado"** — não. `apps/api/db/store.py:79` aceita `jsonl:user`, e é
  dentro dele que o `tool_result` viaja. O que o filtro corta é o `type=system`
  (ver dedução 3), não resultado de ferramenta.

Ou seja: **a órfã nasce no Claude Code, não no cockpit.** O conserto não cabe no
back — cabe na régua do front, dando ao grupo o mesmo prazo que a linha viva já
tem.

### O reverso, que ninguém pediu mas existe

8 `tool_result` sem `tool_use` correspondente (6 deles do `pavan`, mesma sessão
de 01/10). Viram "linha seca de órfão" — não prendem nada, mas são o mesmo
sintoma de log cortado.

---

## Dedução 2 — rótulos, `Usou` e o buraco do alvo

> **CONFIRMADO**, e o buraco é maior do que o `download_attachment`.

O caminho, linha a linha:

- `vocabulario-da-gramatica.ts:164-166` — `verboDe` devolve `usos` (`Usou`/`Usando`)
  para qualquer nome fora da tabela. **MCP nunca entra na tabela, por decisão
  declarada** (linhas 158-163).
- `alvo-da-execucao.ts:67-88` — a lista de campos nomeados (`command`, `query`,
  `pattern`, `skill`, `description`, `recipient`, `to`, `text`, `prompt`,
  `method`, `task_id`). Nada casando, cai no `for (const valor of Object.values(args))`
  da linha 84: **o primeiro valor de texto do objeto, na ordem de inserção**.

Prova executada (a gramática real, sem transpilar):

```bash
node --experimental-strip-types /tmp/t.mjs   # importa components/renderers/gramatica.ts
```

| ferramenta | frase que sai na linha |
|---|---|
| `mcp__plugin_telegram_telegram__download_attachment` | `Usou AwACAgEAAxkBAAI7CGq55oBQbD7gi70QXNq3dIE8yQMCAALzCgACq5fQRZ5A-VcIZET4PQQ` |
| `mcp__plugin_winnow_winnow__winnow_recall` | `Usou x` |
| `mcp__ha-mcp__ha_get_logs` | `Usou s` |
| `ListAgents` | `Usou ListAgents` |
| `ExitPlanMode` | `Usou Refatorar o feed do turno para animar com Motion` |
| `ScheduleWakeup` | `Usou continue` |
| `mcp__plugin_telegram_telegram__reply` | `Usou Bom dia, chefe` |
| `Bash` | `Roda a suíte` |

Duas correções ao enunciado: o `AwACAg…` cortado **não** é código — é o CSS
`truncate` de `grupo-ferramentas.tsx:109`. E o `telegram/reply` (568 chamadas,
a MCP mais usada da frota) **não** cai no buraco: tem `text` na lista de campos.

### As ferramentas que caem no buraco (medido no corpus)

MCP, ordem de volume — o predicado é "nenhuma chave do `input` está na lista do
`alvoDe`":

- `mcp__plugin_telegram_telegram__download_attachment` — **420** (só `file_id`)
- `mcp__plugin_winnow_winnow__winnow_recall` — 23
- `mcp__ha-mcp__ha_get_camera_image` — 11
- `mcp__ha-mcp__ha_get_history` — 8
- `mcp__ha-mcp__ha_get_logs` — 7
- `mcp__ha-mcp__ha_get_automation_traces` — 6
- `mcp__ha-mcp__ha_config_get_automation` — 5
- `mcp__ha-mcp__ha_eval_template` — 5
- `mcp__ha-mcp__ha_get_state` — 4
- `mcp__supabase_geral__get_advisors` — 3
- `mcp__ha-mcp__ha_get_entity` — 2
- `mcp__ha-mcp__ha_call_service` — 2
- `mcp__ha-mcp__ha_config_set_automation` — 1

São 44 ferramentas distintas no corpus. Fora do MCP, 7 nunca ganharam verbo —
e as mais usadas delas são do próprio Claude Code, não da frota:

- `ListAgents` — 17, **sem argumento nenhum**: sai `Usou ListAgents`
- `ScheduleWakeup` — 9 · `Monitor` — 7 · `ExitPlanMode` — 3
- `ListMcpResourcesTool` — 2 · `EnterPlanMode` — 1 · `SendFeedback` — 1

`ExitPlanMode` é o pior caso da lista: o alvo é o plano inteiro.

---

## Dedução 3 — `thinking` e os eventos de verdade do JSONL

> **PARCIAL.** "O thinking vem redigido" é verdade **só nos motores Claude**. E
> "Pensando há X s" é inferência, sim — mas há um evento explícito de fim de
> turno no log que nunca chega à tela.

### O thinking não é redigido em todo lugar — depende do MOTOR

9.427 blocos `thinking` no corpus: **100% têm `signature`**, **1.300 têm texto
visível (13,8%)**. A distribuição não é aleatória:

- `claude-opus-5-5` — 161/7.798 = **2,1%** com texto
- `claude-sonnet-5` — 0/186 = **0%** · `claude-haiku-4-5` — 0/15 = **0%**
- `deepseek-v4.1-flash` (canarinho/Canário) — 674/847 = **79,6%**
- `gpt-6-astra` (tara) — 466/540 = **86,3%**

O `claude-sonnet-5-5` fica em 4,4%, então nem todo Claude é idêntico — mas a
fronteira principal é Claude × motor trocado. O comentário "803 de 804 não têm
texto" (`lib/thinking.ts:89`, `lib/spike/conteudo-visivel.ts:4`) foi medido em
agente de motor Claude e **envelheceu**: no Canário e na Tara o raciocínio
aparece.

**A consequência é grande e não estava no radar.** Mensagem `assistant` que é só
raciocínio visível não é "linha de trabalho" (`grupo-ferramentas.ts:112-116`:
`case 'thinking': if (/\S/.test(...)) return false`) e portanto **corta a run**.
Quanto cada agente é cortado, comparado ao número de `tool_use`:

- canarinho — **698** quebras para 1.125 `tool_use`
- tara — **466** para 1.305
- pavan 51/6.076 · fluytcom 44/2.818 · daniel 39/2.476 · maestro 24/1.366 — a
  casa de 0,3 a 2%
- caseiro 1/94 · felipe 0/27 · barsi 0/17

Ou seja: **no Canário e na Tara o grupo de ferramentas quase não se forma** —
ele é picado a cada raciocínio. Nos agentes de motor Claude, ele se forma e
segura. A mesma tela se comporta diferente por agente, e a causa é o motor, não
o CSS.

Um detalhe que quase virou erro de leitura: **nenhuma** mensagem do corpus tem
`tool_use` e `thinking` visível juntos (0/15.651 nas dez contas). O CC grava o
raciocínio numa mensagem e a ferramenta na seguinte — por isso a quebra é entre
itens, não dentro deles.

### "Pensando há X s" é inferência — CONFIRMADO

- `linha-viva.tsx:71` monta a string; `linha-viva.ts:88-92` formata o tempo.
- `linha-viva.ts:59-65` — a âncora é o `timestamp` da **última mensagem** do
  stream, não um evento de "comecei a pensar".
- `lib/spike/corrida-em-voo.ts` — o liga/desliga é leitura semântica de
  `stop_reason` (`tool_use` ou nulo = em voo; qualquer outro = acabou), com três
  respostas (em voo / acabou / não falo sobre isso), justamente porque a régua de
  duas respostas mentia.

Não existe evento "pensando" no JSONL. Também não existe "executando": os dois
são derivados da mesma leitura. O que existe de verdade está abaixo.

### Os eventos que o JSONL traz durante um turno

Contagem no corpus (por `type` do evento):

- `assistant` 28.382 · `attachment` 23.089 · `user` 18.227 · `mode` 3.627
- `last-prompt` 3.611 · `atis-latch` 3.589 · `custom-title` 3.320
- `agent-name` 3.313 · `queue-operation` 2.407 · `system` 1.952
- `permission-mode` 1.418 · `file-history-snapshot` 1.046 · `ai-title` 449
- `file-history-delta` 378 · `cost-state` 220 · `fork-context-ref` 3

Os `type: system` (1.952), por subtipo — **é aqui que mora o sinal explícito**:

- `turn_duration` — **1.527**, com `durationMs` e `messageCount`. É o fim de
  turno declarado pelo próprio CC.
- `local_command` — 342 (`/clear`, `/compact`, `/model`)
- `away_summary` — 45 · `compact_boundary` — **30**, com `compactMetadata`
  (`preTokens`, `postTokens`, `cumulativeDroppedTokens`, `durationMs`)
- `informational` — 5 (limite de uso) · `scheduled_task_fire` — 3

### O que o back filtra, e o que o classifier suprime

**Filtro do back** — `apps/api/db/store.py:79`:

```python
_JSONL_MESSAGE_KINDS = ("jsonl:user", "jsonl:assistant", "jsonl:attachment", "jsonl:summary")
```

Mais `jsonl:queue-operation` com `operation == 'enqueue'` (linha 80). **Fora**:
todo `jsonl:system`, `last-prompt`, `mode`, `atis-latch`, `custom-title`,
`agent-name`, `permission-mode`, `file-history-*`, `cost-state`, `ai-title`,
`fork-context-ref`.

Consequência direta: **`turn_duration` e `compact_boundary` nunca chegam ao
cockpit.** O comentário de `chat-payload-classifier.ts:45-49` já registra isso
("Hoje o stream filtra `type=system` fora"), e agora está medido. O pós-mudança
tem, portanto, um atalho disponível que hoje ninguém usa: o fim de turno não
precisa ser inferido — ele está escrito no log.

**Supressão pelo `classifyMessage`** (proxy replicando as regex do arquivo):

- `jsonl:attachment` — **23.125/23.125 = 100%** (não têm `message`, caem no
  `!text.trim() && !hasStructuredContent`)
- `jsonl:user` — 566/18.275 = **3,1%**: 239 stdout de comando local, 169
  preâmbulo de skill, 113 `<system-reminder>` puro, 45 marker `[Image: …]`
- `jsonl:assistant` — **0%**
- 47 interrupções (`[Request interrupted by user`) **não** são suprimidas — viram
  `plain`, e quem as lê é o `corrida-em-voo.ts:83`.

---

## Dedução 4 — a transição

> **CONFIRMADO** — com uma ressalva que muda o alvo: metade do movimento da
> bolinha **já** interpola por `transition`. Quem pula são as duas animações que
> fazem a bolinha parecer viva.

### O `animation-duration` trocado no meio — CONFIRMADO

`app/globals.css` § A BOLINHA:

- `.ck-bolinha-voa` — base 3,9s; `pensando` 2,4s; `parado`/`ouvindo` 6,4s
- `.ck-bolinha-infla` — base 5,3s; `pensando` 3,3s; `executando` 2,4s;
  `parado`/`ouvindo` 7,6s

Trocar `animation-duration` com a animação rodando faz o navegador recalcular o
progresso da iteração corrente (mesmo tempo decorrido, duração nova) — a fase
pula. E são exatamente as duas que animam caixa HTML
(`.ck-bolinha-voa`, `.ck-bolinha-infla`), as que carregam o "está vivo".

**O que NÃO pula:** `.ck-bolinha-cabeca`, `.ck-bolinha-rosto`, `.ck-bolinha-vista`
e `.ck-bolinha-olhos` são `transform` declarativo com `transition` — e o CSS
documenta o porquê (a nota de 17/08 sobre `transition` não observar saída de
animação). A inclinação da cabeça, o olhar e a piscada já cruzam suave.

Os sete estados são `offline`, `parado`, `ouvindo`, `pensando`, `executando`,
`pronto`, `atencao`. Há dois pisos de tempo que seguram estado por um instante —
`PISO_EXECUTANDO_MS = 1.100` e `DURACAO_PRONTO_MS = 900`
(`bolinha-agente.tsx:58-64`) — então a troca de `data-estado` nem sempre é a troca
visual: às vezes a bolinha mostra um estado que já acabou.

### Linha viva e grupo se substituem sem fade — CONFIRMADO

A linha viva é item **sintético**, criado no fim do feed só quando
`!trabalhoEmVooNoFim` (`linha-viva.ts:26-52`, montado em
`app/agente/[slug]/feed-da-conversa.tsx`). Quando a primeira ferramenta aparece,
o item `linha-viva` sai e o `grupo-ferramentas` entra — dois itens diferentes, sem
transição entre eles. O único `.ck-chega` do grupo é o do **dedo**
(`grupo-ferramentas.tsx:139`), nunca o do voo. E `corpo-do-item.tsx:181-182`
desenha a linha viva sem nenhum wrapper animado.

### Motion — instalado e não usado ali

- `apps/cockpit/package.json:26` — `"motion": "^12.43.0"`
- `components/feed/**` — **zero** import de `motion`
- `components/shell/bolinha-agente.tsx` — **zero** import de `motion`
- Mas o **composer**, que monta a bolinha, usa: `composer.tsx:65` importa
  `MotionConfig, motion`; a linha 473 abre `<MotionConfig reducedMotion="user">`;
  a 496 envolve o `<BolinhaAgente>` (501) num `motion.div layout="position"`
  com `layoutDependency={formaDaCaixa}`.

São 17 arquivos da UI que já importam de `motion/react`, todos em `shell/` e
`gaveta/`. O feed ficou de fora.

---

## A doc oficial — como o próprio Claude Code representa o turno

Levantamento em `code.claude.com/docs` em 02/10/2026, com o markdown cru baixado
(o WebFetch trunca). Tudo abaixo é citação literal; onde a doc não existe, está
escrito que não existe.

### O "pensando" do CC é um verbo girando — e a lista não é publicada

`https://code.claude.com/docs/en/settings-reference.md`, chave `spinnerVerbs`:

> "While a turn is in progress, the spinner shows a rotating verb such as
> "Accomplishing", "Architecting", or "Baking". Use this key to add your own
> verbs to that rotation or replace the built-in list with yours."

A chave tem `"append"` (soma aos embutidos) e `"replace"` (só os seus). A mesma
página traz `showTurnDuration`:

> "Show or hide the turn duration message after each response, such as "Cooked
> for 1m 6s · done 6:05 PM"."

**SEM DOC OFICIAL** para a lista completa dos verbos e para a afirmação de que a
escolha é aleatória — a doc só confirma que há uma rotação embutida. Páginas
tentadas: `settings-reference.md`, `interactive-mode.md`, `terminal-config.md`,
`accessibility.md`. A lista de ~185 verbos que circula é extração da comunidade,
não doc.

Ou seja: **a TUI não distingue "pensando" de "executando" com dois estados.** Há
um verbo girando enquanto o turno está em progresso, e uma linha de duração
depois que ele termina. O "pensando / executando" que o feed desenha é invenção
nossa, coerente com a doc justamente porque a doc não define esses estados.

### O que o `stream-json` emite de verdade

`https://code.claude.com/docs/en/cli-reference.md`:

> `--output-format` — "Specify output format for print mode (options: `text`,
> `json`, `stream-json`)"
> `--include-partial-messages` — "Include partial streaming events in output.
> Requires `--print` and `--output-format stream-json`"

`https://code.claude.com/docs/en/headless.md`:

> "`stream-json`: newline-delimited JSON for real-time streaming"
> "Each line is a JSON object representing an event"
> "The last line of the stream is a `result` message with the final response
> text, cost, and session metadata."

A tabela de eventos, em
`https://code.claude.com/docs/en/agent-sdk/streaming-output.md` — citada na
íntegra:

> | `message_start` | Start of a new message |
> | `content_block_start` | Start of a new content block (text or tool use) |
> | `content_block_delta` | Incremental update to content |
> | `content_block_stop` | End of a content block |
> | `message_delta` | Message-level updates (stop reason, usage) |
> | `message_stop` | End of the message |

**`tool_use` e `tool_result` não são eventos de `stream-json`** — chegam como
blocos dentro de mensagens `assistant`/`user`, exatamente como no JSONL. E o
delta por token só sai com `--include-partial-messages`
(`SDKPartialAssistantMessage`, `type: "stream_event"`, em
`https://code.claude.com/docs/en/agent-sdk/typescript.md`), e **só da sessão
principal**:

> "Stream events are emitted for the main session only; token-level deltas from
> subagents aren't forwarded. To attribute output to a subagent, use complete
> messages, which carry `parent_tool_use_id`."

### O evento `result` — e o fim de turno que a doc documenta

Campos, em `https://code.claude.com/docs/en/agent-sdk/python.md` (`ResultMessage`):
`subtype`, `duration_ms`, `duration_api_ms`, `is_error`, `num_turns`,
`session_id`, `stop_reason`, `total_cost_usd`, `usage`, `result`,
`structured_output`, `model_usage`, `permission_denials`, `errors`,
`api_error_status`, `terminal_reason`.

Subtipos, literal:

> "It is one of `"success"`, `"error_during_execution"`, `"error_max_turns"`,
> `"error_max_budget_usd"`, or `"error_max_structured_output_retries"`."

E `terminal_reason`:

> "such as `"completed"`, `"max_turns"`, `"api_error"`, `"aborted_streaming"`,
> or `"aborted_tools"`."

**`aborted_tools` é o nome oficial do caso da dedução 1** — o turno abortado com
ferramenta em voo. A doc nomeia o fenômeno; o feed não tem onde lê-lo.

**Não existe evento de "fim de turno" no `stream-json`.** O `result` fecha a
*query*, não cada turno. O sinal por turno que a doc documenta está nos **hooks**,
em `https://code.claude.com/docs/en/hooks.md`:

> | `Stop` | When Claude finishes responding |
> | `StopFailure` | When the turn ends due to an API error |

> "per turn: `UserPromptSubmit`, `Stop`, and `StopFailure`"

### O formato do JSONL — a doc avisa que é interno

`https://code.claude.com/docs/en/sessions.md`:

> "By default, Claude Code stores transcripts as JSONL at
> `~/.claude/projects/<project>/<session-id>.jsonl`"
> "Each line is a JSON object for a message, tool use, or metadata entry. **The
> entry format is internal to Claude Code and changes between versions, so
> scripts that parse these files directly can break on any release.** To build
> on session data, use `/export` or the script interfaces instead."

Este é o aviso que interessa mais ao cockpit, que lê o JSONL direto (via
`task_events`).

**`turn_duration` como entrada de transcript: SEM DOC OFICIAL.** A string só
aparece como *setting* de interface (`showTurnDuration`), nunca como entrada de
`.jsonl`. Páginas tentadas: `sessions.md`, `claude-directory.md`, `hooks.md`,
`checkpointing.md`, `monitoring-usage.md`, `statusline.md`,
`agent-sdk/session-storage.md`, `agent-sdk/typescript.md`. O campo existe no log
(1.527 eventos medidos), mas não é contrato.

### Thinking: a doc explica POR QUE o motor muda o resultado

`https://code.claude.com/docs/en/model-config.md`:

> "Claude Code collapses thinking output by default. Press `Ctrl+O` to toggle
> verbose mode and see the reasoning as gray italic text. Interactive sessions
> on the Anthropic API receive redacted thinking blocks by default, so set
> `showThinkingSummaries: true` in settings if you want the full summaries
> available when you expand."

`https://code.claude.com/docs/en/agent-sdk/typescript.md` (`ThinkingConfig`):

> "The optional `display` field controls whether thinking text is returned
> `"summarized"` or `"omitted"`. On Claude Opus 4.7 and later, the API default
> is `"omitted"`, so set `"summarized"` to receive thinking content in
> `thinking` blocks."

Isto casa exatamente com a medição: **2,1% no `claude-opus-5-5`** (default
`omitted` / redigido) contra **79,6% no `deepseek-v4.1-flash`** e **86,3% no
`gpt-6-astra`** — motores que não passam por esse caminho da API Anthropic e por
isso entregam o raciocínio em texto puro.

**O campo `signature`: SEM DOC OFICIAL.** A palavra não aparece em
`model-config.md`, `typescript.md`, `headless.md` nem `streaming-output.md`. O
documentado é `display` (`summarized`/`omitted`). Existe o evento
`SDKThinkingTokensMessage`, cujo `estimated_tokens` é "a running estimate of the
thinking tokens generated so far in the current block" — contagem, não conteúdo.

### Subagente: `parent_tool_use_id` é o contrato; `isSidechain` NÃO é doc

`https://code.claude.com/docs/en/headless.md`:

> "Messages from subagents appear in the stream as `assistant` and `user`
> messages whose `parent_tool_use_id` field is the ID of the tool call that
> spawned the subagent. Messages from the main conversation carry `null` in that
> field."

> "With `--forward-subagent-text` … the subagent's text and thinking blocks too,
> so you can reconstruct each subagent's transcript."

**`isSidechain`: SEM DOC OFICIAL** — a string não aparece em `typescript.md`,
`session-storage.md`, `sessions.md`, `hooks.md` nem `observability.md`. É campo
interno. O cockpit depende dele (`payload.is_sidechain`,
`buildSidechainRoots`, `corrida-em-voo.ts:67`), então vale registrar o risco.

### Compactação: o evento é documentado no SDK

`https://code.claude.com/docs/en/agent-sdk/streaming-output.md`:

> "a compact boundary message indicating when conversation history was
> compacted (`SDKCompactBoundaryMessage` in TypeScript; `SystemMessage` with
> subtype `"compact_boundary"` in Python)."

O tipo, em `https://code.claude.com/docs/en/agent-sdk/typescript.md`:

> type `SDKCompactBoundaryMessage` = `{ type: "system"; subtype:
> "compact_boundary"; uuid: UUID; session_id: string; compact_metadata: {
> trigger: "manual" | "auto"; pre_tokens: number; }; }`

O efeito visível, em `https://code.claude.com/docs/en/context-window.md`:

> "Replaces the conversation with a structured summary. You see a "Conversation
> compacted" message. The summarization happens without appearing in your
> terminal."

O `compact_boundary` é, portanto, **documentado como mensagem `system` do SDK** —
o que corrobora os 30 eventos medidos no log. Como linha de transcript
especificamente, a doc não o descreve.

### Os buracos, declarados

Sem doc oficial, em nenhuma página tentada: lista completa dos `spinnerVerbs` e a
aleatoriedade; `turn_duration` como entrada de transcript; `compact_boundary`
como linha de `.jsonl` (só como mensagem do SDK); o campo `signature`; e
`isSidechain`.

---

## Notas para a mudança que vem (Motion + bolinha na linha em voo)

Não implementei nada. O que a medição diz que **ajuda**:

- **O `MotionConfig` já está na árvore que monta a bolinha** e já traz
  `reducedMotion="user"` — quem se move para dentro dele herda de graça.
- **O precedente de animar posição está no arquivo ao lado**: o
  `motion.div layout="position"` de `composer.tsx:496` existe exatamente para a
  bolinha não pular quando a caixa cresce.
- **A linha em voo já tem a gramática pronta**: `linha-viva.tsx` e a linha de
  ferramenta em voo compartilham `minHeight: 32px`, a cor `--ck-pulso-ouro` e o
  `data-estado="trabalhando"` do `.ck-pulso`. É o gancho natural para pendurar a
  bolinha à esquerda.
- **O sinal de fim de turno existe e está barrado.** `turn_duration`
  (1.527 eventos, com `durationMs`) chega ao `task_events` e morre no filtro de
  `store.py:79`. Liberar esse `kind` dá o "acabou" de graça — e resolve o outro
  lado da dedução 1.
- **A doc oficial nomeia o caso da órfã.** `terminal_reason` pode ser
  `"aborted_tools"` (`agent-sdk/python.md`) e os hooks `Stop`/`StopFailure`
  marcam o fim de turno (`hooks.md`). Nenhum dos dois está no caminho que o
  cockpit consome hoje; os dois são âncora de contrato, não heurística.

O que **atrapalha**:

- **O feed é virtualizado** (`@tanstack/react-virtual`, `feed.tsx:18` e `:86`).
  Item virtualizado desmonta e remonta ao rolar. Hoje a bolinha está **fora** do
  scroll, no composer — é por isso que a piscada (`setInterval`) e o `useEffect`
  de olhar nunca reiniciam. Dentro de uma linha do feed, eles reiniciam a cada
  ida e volta.
- **Mover a bolinha para o feed a tira do `MotionConfig` do composer.** O
  `prefers-reduced-motion` continuaria coberto pelo `@media` de
  `globals.css` (`.ck-bolinha * { animation: none !important }`), mas só para
  CSS — animação via Motion precisaria de `reducedMotion` próprio.
- **O composer desenha uma camada de névoa sobre o feed**
  (`composer.tsx:474-479`, a "borda progressiva" com escada de desfoque). Uma
  bolinha na linha em voo entra por baixo dessa camada, não por cima.
- **Linha viva e grupo em voo são mutuamente exclusivos por construção**
  (`linha-viva.ts:26-52`). Se a bolinha morar na linha em voo, ela precisa
  existir nos **dois** casos — senão some justamente quando há ferramenta
  rodando, que é quando ela mais importa.
- **O grupo preso da dedução 1 é o maior risco de reputação da mudança nova.**
  Se a bolinha for ancorada na linha em voo, uma órfã de 1 em 15.583 prende a
  bolinha em `executando` **para sempre** — hoje ela já prende o grupo, mas o
  grupo é uma linha discreta; a bolinha é o rosto do agente.
