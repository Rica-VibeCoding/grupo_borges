# Voz em tempo real no modo conversa — texto por bloco e sinal de ferramenta

**Pesquisa do Canário (pedido do Pavan, ordem do Rica).** 29/09/2026.
Só pesquisa: nenhum arquivo do cockpit foi tocado.
Toda afirmação traz `[DOC OFICIAL]`, `[COMUNIDADE]` ou `[DEDUÇÃO SUA]`, com fonte e data.

**Versão conferida na máquina:** Claude Code `2.1.284` (`claude --version`), mapa de hooks lido
em `https://code.claude.com/docs/en/hooks.md` em 29/09/2026.

---

## 0. Causa raiz, medida — por que hoje tudo toca junto no fim

Antes das perguntas, o diagnóstico do que já existe. Hoje o texto do agente chega ao TTS pelo
vigia do JSONL (`apps/api/orchestrator/jsonl_watcher.py`), e ele só age no fim:

- `jsonl_watcher.py:710-711` — `stop_reason = _short_text(message.get("stop_reason"))` e
  `if stop_reason == "end_turn":`. Só a **última** mensagem do turno passa.
- O texto escrito ANTES de uma ferramenta vem com `stop_reason == "tool_use"` — é descartado.

**Medição na fonte primária** (sessão real em `~/.claude/projects/-home-clawd-repos-ze-claude-pavan/`,
arquivo `231fd872-081c-4db9-a74a-0ae70b1b2379.jsonl`, lido em 29/09/2026):

- 15 mensagens `assistant` com texto e `stop_reason=tool_use` — ou seja, **o texto entre
  chamadas de ferramenta existe e é mensagem própria**, não está perdido no JSONL.
- 23 mensagens `assistant` com texto e `stop_reason=end_turn` — as únicas que o vigia enxerga.

`[DOC OFICIAL]` O JSONL é gravado de forma assíncrona e pode atrasar em relação à conversa em
memória — a própria doc desaconselha ler o transcript para "a mensagem final do turno":
> "The transcript file is written asynchronously and may lag the in-memory conversation, so it may
> not yet include the current turn's most recent messages when a hook fires."
> — hooks.md, seção `Stop input` (29/09/2026)

Isto é a mesma armadilha que virou a issue #74340 (ver §3).

---

## 1. Texto do assistente em tempo real, por bloco

### A fonte oficial certa para sessão INTERATIVA: o hook `MessageDisplay`

`[DOC OFICIAL]` Existe um evento de hook feito exatamente para isto, e ele existe na versão
instalada (2.1.284). Entrou no changelog da **2.1.152**: "Added a `MessageDisplay` hook event that
lets hooks transform or hide assistant message text as it is displayed"
(`raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`, linha do bloco `## 2.1.152`).

O que ele garante, citado:
> "Runs while an assistant message streams to the screen. Claude Code displays the message in
> increments: each time a batch of newly completed lines is ready to render, the hook runs once with
> those lines and Claude Code renders the hook's replacement text in their place. A long message
> produces several calls; a short message may produce only one."
> "MessageDisplay doesn't support matchers and fires for every assistant message that streams text;
> messages with no text, such as tool-call-only responses, don't trigger it."
> — hooks.md, `### MessageDisplay` (29/09/2026)

Campo a campo do que chega no `stdin` (`#### MessageDisplay input`):

- `turn_id` — UUID do turno
- `message_id` — UUID da mensagem; **estável** em todos os blocos da mesma mensagem
- `index` — índice do bloco dentro da mensagem, base zero
- `final` — `true` no último bloco. É o sinal de fim, não o `delta` vazio
- `delta` — as linhas novas desde o bloco anterior, com as quebras de linha

Ponto que responde à pergunta do Rica: **"fires for every assistant message that streams text"**.
No laço de ferramentas, cada ida ao modelo é uma mensagem `assistant`; o texto antes da ferramenta é
uma delas. `[DEDUÇÃO SUA]` Logo, o bloco de texto que precede uma ferramenta dispara
`MessageDisplay` enquanto é escrito — ANTES de a ferramenta começar. **E eu medi: bateu.** O bloco
saiu ~20 ms antes do `PreToolUse` da ferramenta seguinte, nos dois pares do teste — §4.

Três limites que importam para vocês:

1. `[DOC OFICIAL]` **É display-only.** "the replacement text changes only what is rendered on
   screen. The transcript and what Claude sees keep the original text". Nada muda no que o agente vê.
2. `[DOC OFICIAL]` **Segura a tela.** "Claude Code holds each batch until your hook returns, so keep
   the hook fast. If the hook fails or times out, Claude Code displays the original text. The default
   timeout for this event is 10 seconds." Pra não atrasar a UI, use `"async": true` — ver §2.
3. `[DOC OFICIAL]` **Em `-p` e no Agent SDK ele muda de comportamento:** "runs once per assistant
   message instead of once per batch of lines. The single call arrives after the message completes".
   Ou seja, em headless ele NÃO serve para tempo real. Tem que ser sessão interativa (é o caso de vocês, tmux).

### Por que as outras opções que você listou não servem

- **Ler o JSONL de `~/.claude/projects`.** `[DOC OFICIAL]` É a fonte que já usam, e é justamente a
  que a doc marca como atrasada ("written asynchronously and may lag"). Além disso a mensagem só é
  gravada quando fecha. **É a causa raiz do §0.** Não resolve.
- **`--output-format stream-json` + `--include-partial-messages`.** `[DOC OFICIAL]` Funciona e dá
  delta por delta — mas o `claude --help` da 2.1.284 é explícito: "only works with `--print` and
  `--output-format=stream-json`". Isto é, exige **trocar o modo de condução** de `send-keys` no tmux
  para headless/SDK. É a opção "de verdade" do Agent SDK:
  > "By default, the Agent SDK yields complete `AssistantMessage` objects after Claude finishes
  > generating each response. To receive incremental updates (...) set `include_partial_messages`
  > (...) `true`."
  > — `code.claude.com/docs/en/agent-sdk/streaming-output` (29/09/2026)
  Só que aí a tela de voz deixa de dirigir um terminal e passa a ser um cliente do SDK — reescrita
  grande. Fica como plano B, não como conserto.
- **Hook `Stop`.** `[DOC OFICIAL]` Só roda no fim do turno. Tem `last_assistant_message` (o texto
  final, sem precisar do transcript) — serve para "terminei", não para "por bloco".

---

## 2. `PreToolUse` como sinal garantido de "comecei a usar ferramenta"

**Sim, dá — e sem atrasar a ferramenta, se o hook for assíncrono.**

`[DOC OFICIAL]` O que chega no `stdin` de um `PreToolUse`
(`#### PreToolUse input`, exemplo literal da doc):

```json
{
  "session_id": "abc123",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test", "description": "Run test suite" },
  "tool_use_id": "toolu_01ABC123..."
}
```

`[DOC OFICIAL]` Nome da ferramenta em `tool_name` — é o que o painel já usa para o estado
"trabalhando". `tool_use_id` permite casar com o `PostToolUse`.

**Tempo e bloqueio:**

- `[DOC OFICIAL]` Timeout padrão de 600 s para hook `command`, `http` e `mcp_tool`; **não** cai para
  30 s no `PreToolUse` (a redução vale só para `UserPromptSubmit` e as trocas de modelo).
- `[DOC OFICIAL]` Estourou o tempo: "A timed-out `command`, `http`, or `mcp_tool` hook doesn't block
  the tool call. The call continues through the normal permission flow" — ou seja, **não dá pra
  contar com hook travado como porteiro**.
- `[DOC OFICIAL]` Síncrono, ele **atrasa**: "All matching hooks run in parallel" mas o Claude Code
  espera todos os que casam. Então não é de graça.
- `[DOC OFICIAL]` **A saída limpa é `"async": true`:** "Claude Code starts the hook process and
  immediately continues without waiting for it to finish. The hook receives the same JSON input via
  stdin as a synchronous hook." Async só existe em `type: "command"` (não em `http`), não tem
  `timeout` aplicado, e não pode bloquear nada — que é exatamente o que se quer para um bipe.

**Chamar URL local:** duas formas, ambas oficiais.

- Hook `type: "http"` — "send the event's JSON input as an HTTP POST request to a URL"
  (`#### HTTP hook fields`). Simples, mas **síncrono por natureza**: segura a ferramenta até
  responder. Com `localhost` é ~1 ms, mas é um ponto de falha na frente de toda ferramenta.
- Hook `type: "command"` com `"async": true` chamando `curl` — não atrasa nada, e é o padrão que a
  comunidade usa (ver §3).

`[DEDUÇÃO SUA]` Para o "som de ferramenta" que o Rica quer, o `async: true` + `curl` para o servidor
local é a escolha certa: o sinal sai sempre (é o arnês que dispara, não o modelo), e o pior caso é
um `curl` que falha sozinho, sem tocar na ferramenta.

---

## 3. O que a comunidade faz

`[COMUNIDADE]` **cc-beeper** (`github.com/vecartier/cc-beeper`, 175 estrelas, último push
12/04/2026) é o exemplo mais limpo e o mais próximo do que vocês querem. Lido no README em 29/09/2026:

- Registra **7 hooks** em `~/.claude/settings.json`: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `Stop`, `StopFailure` (todos async), mais `Notification` e `PermissionRequest` (bloqueantes).
- Comunicação: "All communication happens over `127.0.0.1` — plain `curl` hooks to a local HTTP
  server", nas portas 19222–19230.
- Estados mapeados nos hooks: WORKING (`PreToolUse`), DONE (`Stop`), ERROR, pedido de permissão.
- Ele fala por TTS, mas **também só no `Stop`** — sofre o mesmo "tudo no fim" que vocês. Não resolve
  o problema 1, só prova o padrão de sinal.

`[COMUNIDADE]` Outros do mesmo feitio, todos por hook e todos falando no fim do turno:
`Null-Phnix/claude-voice` (37★, "I built a Claude Code Stop hook", TTS local Kokoro);
`MichaelPGifford/claude-read-aloud` (10★, plugin + extensão de VS Code);
`antonyjaen/claude-speak` (tool call vira fala de "trabalhando").

`[COMUNIDADE]` Painéis ao vivo quase sempre **tail do JSONL** — herdam o mesmo atraso:
`hoangsonww/Claude-Code-Agent-Monitor` (1019★), `AnEntrypoint/ccsniff` (watcher com eventos
`streaming_start` / `streaming_progress` / `streaming_complete`), `Jamie-BitFlight/claude_skills`
(o `dot-dash`). `voglster/lumbergh` foge disso olhando o **tmux/PTY** via xterm.js, e
`XiaoChu-1208/claude-baby` usa **stream-json** — as duas alternativas do §1.

`[COMUNIDADE]` **Issue #74340** (`anthropics/claude-code`, fechada em 14/09/2026, conferida por API
em 29/09/2026) é o mesmo tropeço de vocês, por outro caminho:
> "Stop hook fires before the final assistant message is flushed to the transcript; hooks reading
> the transcript get the previous turn's message (breaks read-aloud accessibility)"
O autor é dev cego que dependia do hook para ler a resposta em voz alta. O conserto documentado é o
campo `last_assistant_message` do `Stop` em vez de ler o transcript.

`[COMUNIDADE]` **Issue #97601** (aberta em 27/09/2026) pede um "PreResponse bloqueante / blocking
MessageDisplay"; o autor cita `v2.1.283` e mede 1.982 turnos em 14 dias. Confirma que o
`MessageDisplay` existe e que **não** é bloqueante. `[COMUNIDADE]` Issues #37243 e #87223
(hook de texto do assistente; corrida do `PreToolUse` lendo transcript velho) foram fechadas como
"not planned".

`[COMUNIDADE]` Não achei thread no Reddit sobre isto — a busca não retornou nenhum link do
r/ClaudeAI ou r/ClaudeCode. No Hacker News, o único "Show HN" no tema é o
`Stargx/claude-code-dashboard` (14★, parado desde 09/03/2026).

**Leitura do conjunto:** ninguém na comunidade resolveu o "por bloco" — todo mundo que fala usa o
`Stop`, e quem lê o JSONL carrega o atraso junto. O `MessageDisplay` é do bloco `2.1.152` do
changelog e não aparece em nenhum dos projetos que achei. Vocês estariam à frente, não atrás.
`[DEDUÇÃO SUA]` Não consegui a data de publicação da 2.1.152 no changelog — ele lista as notas por
versão, sem data.

---

## 4. Medição empírica na máquina (o que eu mesmo rodei)

`[MEDIDO PELO CANÁRIO, 29/09/2026]` Não me contentei com a doc: montei um diretório descartável em
`/tmp/voztest` com hooks que carimbam hora em milissegundos, subi o Claude Code `2.1.284` num tmux
interativo (o mesmo jeito que o cockpit dirige) e pedi o roteiro: escreva BLOCO UM → rode `sleep 5`
→ escreva BLOCO DOIS → rode `ls` → escreva BLOCO TRES e pare. Hooks instalados: `UserPromptSubmit`,
`MessageDisplay`, `PreToolUse`, `Stop`.

Resultado, na ordem do relógio (a coluna é o carimbo de quando o hook **começou**):

```
04:56:00.276  PROMPT
04:56:02.879  MSG   delta="BLOCO UM"        index=0 final=true
04:56:02.904  PRE   tool=Bash                          (+25 ms)
04:56:10.183  MSG   delta="BLOCO DOIS"      index=0 final=true
04:56:10.199  PRE   tool=Bash                          (+16 ms)
04:56:11.616  MSG   delta="BLOCO TRES"      index=0 final=true
04:56:11.623  STOP  last_assistant_message="BLOCO TRES" (+7 ms)
```

O que isso prova, e é o que responde ao pedido:

1. **O `MessageDisplay` dispara antes da ferramenta.** Nos dois pares, o bloco de texto sai ~20 ms
   antes do `PreToolUse` da ferramenta que ele precede. O "tudo junto no fim do turno" morre aqui.
2. **Um bloco = uma chamada, com o texto exato.** Os três blocos vieram com `index=0` e
   `final=true`, isto é, cada um fechou numa chamada só — o `delta` é a frase inteira, pronta pra
   mandar ao TTS sem remontar nada.
3. **O `Stop` continua sendo o "terminei"**, e o `last_assistant_message` traz o texto final.

Duas ressalvas honestas:

- A ordem das LINHAS dentro do arquivo não é a ordem dos fatos — dois processos escrevem ao mesmo
  tempo. Quem manda é o carimbo de hora, que é o que está acima. `[MEDIDO]`
- A primeira tentativa falhou e vale registrar. `[MEDIDO]` Com o diálogo "Is it a project you
  trust?" ainda na tela, **nenhum** dos quatro hooks disparou naquela sessão — nem o
  `UserPromptSubmit`. `[DEDUÇÃO SUA]` A explicação mais provável é que as configurações de projeto
  (`.claude/settings.local.json`) só passam a valer depois do aceite de confiança. Não isolei a
  causa: pode ser o carregamento das configurações ou o momento do aceite. Subi de novo com a pasta
  já confiada e funcionou. Se um dia um hook novo não disparar na frota, é o primeiro lugar a olhar.

---

## Risco

- **O `MessageDisplay` segura a tela até o hook voltar** (10 s de teto). Hook síncrono que fala com o
  TTS coloca o servidor de voz no caminho crítico de TODO bloco de texto do agente. `"async": true`
  resolve — e, sendo assíncrono, o `timeout` não é aplicado.
- **Texto nem sempre precede a ferramenta.** Se o agente chama ferramenta sem escrever nada, o
  `MessageDisplay` não dispara (a doc diz que mensagem só com ferramenta não dispara). Por isso o
  sinal de "trabalhando" tem que vir do `PreToolUse`, e não do texto.
- **Não verifiquei com `"async": true` ligado.** O probe mediu ordem e formato dos campos com hooks
  síncronos. O comportamento do `async` no `MessageDisplay` está na doc, não na minha medição.
- **Não testei no cockpit de verdade** — só num tmux limpo, com a CLI pura, sem os hooks da frota
  (`ze-shared`) carregados em cima.
- **Efeito colateral do teste:** aceitar a confiança da pasta `/tmp/voztest` gravou uma entrada
  dessa pasta no `~/.claude.json` real. Lixo inofensivo; não removi para não mexer no config vivo
  com a frota rodando.

## Recomendação (3 linhas)

1. **Trocar a origem do texto:** hook `MessageDisplay` (existe desde a 2.1.152, e vocês estão na
   2.1.284) com `"async": true` chamando o `/api/tts/synth/stream` — cada bloco fala assim que o
   agente escreve, e o vigia do JSONL sai do caminho para isso.
2. **Sinal de ferramenta:** hook `PreToolUse` com `"async": true` + `curl` para o servidor local;
   o arnês dispara sempre, não depende do modelo lembrar, e não atrasa a ferramenta.
3. **Não trocar o modo de condução agora:** `stream-json` com `--include-partial-messages` é a
   alternativa sólida, mas só existe com `--print`, o que exigiria dirigir a sessão por SDK no lugar
   do `send-keys`.

### Esboço de configuração (não é código do cockpit, é só o formato)

```json
{
  "hooks": {
    "MessageDisplay": [
      { "hooks": [ { "type": "command", "command": "/caminho/hook-fala-bloco.sh", "async": true } ] }
    ],
    "PreToolUse": [
      { "hooks": [ { "type": "command", "command": "/caminho/hook-ferramenta.sh", "async": true } ] }
    ]
  }
}
```

O `hook-fala-bloco.sh` recebe o JSON no `stdin`, lê `.delta` e faz o `curl` para o endpoint que já
existe (`POST /api/tts/synth/stream`, campos `text` e `slug` — `apps/api/routers/tts.py:150`).
Não precisa de `matcher`: o `MessageDisplay` nem aceita.
