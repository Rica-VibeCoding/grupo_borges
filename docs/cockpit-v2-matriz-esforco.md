# MATRIZ DE ESFORÇO POR MOTOR — como cada plataforma da frota pensa "esforço" (v2, 09/08/2026)

> Pedido do Rica (09/08): levantar, com fonte, para cada motor da frota — Claude Code,
> Codex, Kimi K3 e DeepSeek via OpenCode Go — os níveis reais de esforço, como se aplica,
> se pega em sessão viva, onde persiste e como se lê o valor efetivo. A lista do §4 é o que
> vira a fase 2 da refatoração: **cada motor com níveis e mecanismo próprios**, em vez do
> tratamento desencontrado de hoje.
>
> **v2 (09/08, noite) — por que esta segunda passada existe:** a v1 nasceu desatualizada
> porque a Tara estava corrigindo o backend enquanto o Canário documentava. O Rica conferiu
> o código e deu a régua: **todo item marcado como resolvido cita onde se conferiu, com
> caminho e linha — não confiar na palavra de ninguém** (ele mesmo errou hoje ao declarar
> provado um teste no alvo errado). Esta versão reconferiu cada item no código atual do
> repositório principal (`/home/clawd/repos/grupo_borges`, onde a produção e a Tara vivem;
> o worktree canário espelha). Onde o Rica descreveu um estado e o código diz outro, está
> marcado como **furo** — o caminho do Rica pediu isso explicitamente.
>
> Frente do Daniel e da Tara ficam paradas aqui: este documento é pesquisa, sem mudança de
> código. Versões testadas: `claude` 2.1.226, `codex-cli` 0.146.0.

## 1. Em uma frase

O "seletor de esforço" do cockpit não é um knob único: **cada motor tem níveis, mecanismo
de aplicação e fonte de verdade próprios**. Desde a v1, o Claude Code deixou de escrever o
`~/.claude/settings.json` global: o PATCH agora **dirige `/effort` por tmux** (aplica ao
vivo) e o painel **lê o efetivo da statusline**, não o arquivo. O que antes era a queixa
central da v1 (§4 itens 1–3) morreu para o CC e **virou o ponto mais perigoso**: a troca em
sessão viva pode **deixar o agente travado num modal de confirmação** que o cockpit não vê.

## 2. A matriz — as 5 perguntas do Rica, por motor (atualizada)

| Motor (agentes) | Níveis reais | Como se aplica | Sessão viva? | Onde persiste | Como se lê o efetivo |
|---|---|---|---|---|---|
| **Claude Code** (Daniel, Felipe, Barsi, Lucas, Vinicius, Pavan) | `low, medium, high, xhigh, max` por modelo; `auto` = reset pro default (não é nível); `ultracode` = modo CC (envia xhigh + orquestração), session-only | PATCH `/effort` → **`/effort <v>` via tmux** (`agents.py:500`), Enter separado (`agents.py:506`), confirmação via `_poll_claude_effort` (`agents.py:820`) | **Sim — dirigido ao vivo agora** | o `/effort` do CLI grava o default na settings do escopo da sessão (medium/high/xhigh); `max`/`ultracode` session-only; env var lida no boot | statusline → `/tmp/cc-status-<sid>.json` → `effort.level`; painel lê **isto primeiro** (`agents.py:951`), settings global é só fallback (`agents.py:970`) |
| **Codex** (Tara, `gpt-5.6-*`) | `low, medium, high, xhigh, max` (model-dependent; `none`/`minimal` citados na doc) | `-c model_reasoning_effort=<v>` por invocação (persistido em `agent_state`); `model_reasoning_effort` no `~/.codex/config.toml`. **Sem toggle em runtime** | N/A — `codex exec` é processo one-shot; "próximo boot" = próxima delegação | `agent_state.codex_reasoning_effort` (o pedido do cockpit); config.toml (default); `threads.reasoning_effort` (o que rodou) | `state_5.sqlite → threads.reasoning_effort` (já lido pelo `codex_reader`, mas o painel usa `agent_state` — **ver furo no item 4**) |
| **Kimi K3** (Hiro) | canônico `low, high, max`; aliases (`max/ultra/xhigh`→max, `high/medium`→high, `low/minimum/light`→low) | PATCH `/effort` grava `agent_state.kimi_reasoning_effort` → `subir_hiro` exporta `CLAUDE_CODE_EFFORT_LEVEL` no boot (`subir-frota.sh:141-153`) | env var = só boot; `/effort` do CLI funcionaria (mesmo CLI) mas **não é dirigido** | `agent_state.kimi_reasoning_effort`; vazio → cai no settings global (vazamento) | statusline `effort.level` (o que o CLI enviou); painel lê `agent_state` (`agents.py:758`) — o **pedido**, não o efetivo |
| **DeepSeek V4-Flash via OpenCode Go** (Canário) | `low, high, xhigh, max` + `none` (off); para o flash: `low`→low, `high`→high, `xhigh`→**high**, `max`→max. Dica, não knob | CLI claude lê `effortLevel` do settings global no boot (xhigh) → `output_config.effort` → `opencode.ai/zen/go`. `CLAUDE_CODE_EFFORT_LEVEL` **não** é exportada no boot | igual CC (mesmo CLI) — `/effort` aplicaria; não é dirigido | **nada próprio** — herda o settings global (vazamento); `agent_state.canarinho` vazio | statusline `effort.level` (o que o CLI crê; hoje xhigh → DeepSeek aplica **high** no flash). Se o Go repassa: **não confirmado** |

## 3. Detalhe por motor

### 3.1 Claude Code

- **Níveis.** `low, medium, high, xhigh, max` por modelo; default da API `high` (mesmo que
  omitido). `auto` é sentinela de reset pro default do modelo. `ultracode` é modo do CC
  (envia `xhigh` + orquestração), session-only. Fonte: https://code.claude.com/docs/en/model-config.md
  (seções *Adjust effort level* e *Ultracode*).
- **Aplicar — mudou desde a v1.** O PATCH `/effort` de um agente CC agora **não escreve mais
  `~/.claude/settings.json`** — envia `/effort <v>` ao tmux da sessão (`agents.py:500`),
  manda Enter separado (`agents.py:506`) e confirma pelo `effort.level` da statusline
  (`_poll_claude_effort`, `agents.py:820`). Comentário do código, `agents.py:487-489`:
  *"O próprio comando persiste o default para novas sessões; escrever `~/.claude/settings.json`
  aqui seria redundante e vazaria a escolha para os outros agentes."* → **o item 1 da v1
  morreu para o CC.** O resíduo é a leitura: `_read_agent_effort` (`agents.py:979`) ainda lê
  o global como **fallback** quando a sessão não tem statusline (`agents.py:968-976`).
- **Sessão viva.** Sim, dirigido ao vivo. Resposta do PATCH carrega `tmux_delivered` e
  `confirmed` (`agents.py:522-523`): entregue ao tmux ≠ aplicado. A distinção é o cerne do
  §3.5 (o modal).
- **Persistência por nível** (doc model-config): `low/medium/high/xhigh` persistem entre
  sessões quando setados em sessão interativa; **`max` é session-only** — "applies to the
  current session only, except when set through the `CLAUDE_CODE_EFFORT_LEVEL` environment
  variable"; **`ultracode` é session-only** também; **`settings.json`/`effortLevel` não
  aceita `max` nem `ultracode`** — só `low|medium|high|xhigh` ("not accepted here"). Isto
  **mata definitivamente o item 9 da v1** (gravar `max` no settings era duplamente errado:
  o caminho de escrita morreu E a doc proíbe).
- **Ler o efetivo.** `_build_claude_painel_effort` (`agents.py:951`) lê a statusline viva
  primeiro; `session_may_diverge` = `stale` (statusline caiu em fallback ou passou de
  `_AGENT_PAINEL_CONTEXTO_STALE_AFTER_SECONDS`). **O item 2 da v1 morreu para o CC** — o
  painel não mostra mais o arquivo quando a sessão está viva.
- **Transmissão ao modelo.** `output_config.effort` no corpo Anthropic Messages; com
  `ANTHROPIC_BASE_URL` custom, o CC só envia se reconhecer o model ID como effort-capable —
  a doc aponta `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1` para forçar, e `_SUPPORTED_CAPABILITIES`
  para declarar `effort`/`xhigh_effort`/`max_effort` em IDs custom. Fonte:
  https://code.claude.com/docs/en/model-config.md (seção *Supported capabilities*).

### 3.2 Codex (Tara)

- **Níveis.** A doc oficial da API aceita, por modelo, `none, minimal, low, medium, high,
  xhigh, max` (default `medium` quando omitido). Fonte:
  https://developers.openai.com/api/docs/guides/reasoning
- **Aplicar.** `-c model_reasoning_effort=<v>` por invocação (o `tara-codex` injeta isso na
  próxima exec) ou `model_reasoning_effort` no `~/.codex/config.toml` (verificado: o config
  global está em `max`). PATCH `/effort` grava `agent_state.codex_reasoning_effort`
  (`agents.py:462-470`); **não há toggle em runtime.**
- **O buraco do wrapper — FURO no que o Rica descreveu.** O Rica disse que o item 4 foi
  corrigido: *"`scripts/tara-codex`, por volta da linha 164, agora casa
  `^(low|medium|high|xhigh|max)$` e tem comentário citando o codex 0.146+"*. **Verificado no
  código dos dois worktrees (principal e canário, idênticos): `scripts/tara-codex:164` é
  `if [[ "$persisted_effort" =~ ^(low|medium|high)$ ]]` — SEM `xhigh`, SEM `max`, e não há
  comentário de versão de codex em lugar nenhum do arquivo.** O backend passou a aceitar
  `xhigh`/`max` (`_CODEX_PAINEL_ALLOWED_EFFORTS` com `max`, `agents.py:85`), então o painel
  agora **oferece** níveis que o wrapper **não injeta**: persistir `xhigh`/`max` grava no
  `agent_state`, o painel mostra, e a próxima delegação roda **sem flag nenhuma** — no-op
  silencioso, agora com o agravante de o painel permitir. **Este item continua vivo e é o
  maior furo de consistência do Codex.** (Se a intenção era aceitar `max`, o wrapper precisa
  da regex; se não, o backend deveria filtrar — decisão de fase 2.)
- **Sessão viva?** N/A. `codex exec` é one-shot; o conceito certo é persistir para a próxima
  delegação.
- **Ler o efetivo.** `threads.reasoning_effort` em `~/.codex/state_5.sqlite` — o que a thread
  rodou de fato. O `codex_reader` já expõe (`CodexThread.reasoning_effort`, `codex_reader.py:59`)
  mas o painel usa `agent_state` (`_build_codex_painel_effort`, `agents.py:746`). **Divergência
  demonstrada:** `agent_state` = `high`, threads rodam `max`.

### 3.3 Kimi K3 (Hiro)

- **Níveis.** Canônico `low, high, max` (endpoint aceita aliases; default `high`). K3 pensa
  sempre. Fonte: https://platform.kimi.ai/docs/guide/use-thinking-models
- **Aplicar.** PATCH `/effort` grava `agent_state.kimi_reasoning_effort` (`agents.py:477-480`);
  o `subir_hiro` exporta `CLAUDE_CODE_EFFORT_LEVEL` no boot. Comentário do código
  (`agents.py:471-473`): *"Kimi pensa sempre; o nível é env var lida no boot — persistir no
  settings.json global não teria efeito e ainda vazaria pros outros agentes. Vale no próximo
  boot, como o modelo."*
- **Sessão viva?** Não é dirigido. O `/effort` do CLI funcionaria (mesmo CLI do CC), mas o
  cockpit não envia — **o item 7 da v1 continua vivo para o Kimi** (ao contrário do CC).
- **Ler o efetivo.** statusline `effort.level` (o que o CLI enviou); painel lê `agent_state`
  (`agents.py:758`) — o **pedido**. **Vazamento verificado:** quando a env var não é setada,
  o CLI cai no settings global (`effortLevel: xhigh`) — o `unset` do `subir_hiro` protege
  contra env var herdada, não contra o default do arquivo. **Item 6 da v1 segue vivo.**

### 3.4 DeepSeek V4-Flash via OpenCode Go (Canário)

- **Níveis.** `low, high, xhigh, max` + `none` (off); para `deepseek-v4-flash`: `low`→low,
  `high`→high, `xhigh`→**high**, `max`→max. Effort é dica. Fonte:
  https://api-docs.deepseek.com/guides/thinking_mode
- **Aplicar.** `subir_canario` sobe o CLI claude com `ANTHROPIC_BASE_URL=opencode.ai/zen/go`
  e `ANTHROPIC_MODEL=deepseek-v4-flash[1m]`, **sem** `CLAUDE_CODE_EFFORT_LEVEL`
  (`subir-frota.sh:170-205`). O CLI lê o `effortLevel` do settings global (xhigh) e envia
  `output_config.effort`. Statusline da sessão atual reporta `effort.level: xhigh`.
- **Sessão viva?** Igual CC (mesmo CLI) — `/effort` aplicaria; não é dirigido.
- **Onde persiste.** Nada próprio — herda o settings global (mesmo vazamento dos 6 CC).
  `agents.yaml:191-193` registra que o canarinho **não tem `model_family`** — o backend o
  trata como Anthropic (escala de 5 níveis + leitura de statusline). **Item 10 da v1 segue
  vivo** (conferido no `agents.yaml` do principal, linha 191).
- **Ler o efetivo.** statusline `effort.level` (o que o CLI crê; hoje xhigh → DeepSeek aplica
  **high** no flash).
- **Não confirmado:** se o OpenCode Go repassa/mapeia o `output_config.effort` pro
  `reasoning_effort` do DeepSeek (mesmo item da v1).

## 3.5 O que a troca de esforço faz com a SESSÃO do agente — o ponto que ninguém tinha mapeado

> Descoberto pelo Rica, medido no Felipe (09/08). A doc oficial confirma o mecanismo por trás
> do modal. **Este é o item mais perigoso da lista da fase 2**: o cockpit hoje pode entregar
> um `/effort` que deixa o agente **travado num modal** que o backend não vê.

### Os três estados de um PATCH `/effort` dirigido por tmux (medido pelo Rica)

1. **Agente parado** → aplica na hora, sem diálogo. PATCH devolve `confirmed: true`.
2. **Agente pensando** → o comando **fica preso na fila de input** do tmux e não aplica.
   PATCH devolve `tmux_delivered: true, confirmed: false` — a entrega ao tmux foi confirmada,
   a aplicação não.
3. **Quando o turno acaba** → o comando enfileirado dispara e o Claude Code **abre um modal
   `Change effort level?` com duas opções**, e a sessão fica **travada até alguém escolher**.
   Dois PATCHes seguidos empilham dois modais.

**O que o backend consegue (e não consegue) ver:** `_poll_claude_effort` (`agents.py:820`)
dá 3× 0.5s de janela e devolve `confirmed=False` se a statusline não mudar. Ele **não tem
como detectar o modal aberto** — o painel devolve "entregue, não confirmado" e o agente segue
preso até um humano tocar no tmux. **É um deadlock invisível**: o cockpit acha que avisou, o
agente está esperando decisão humana que ninguém sabe que é necessária.

### O que a fonte oficial diz — confirma, não contradiz o Rica

Da página **How Claude Code uses prompt caching** (https://code.claude.com/docs/en/prompt-caching):

> "**Effort level**: each effort level has its own cache for the same model. Changing it
> mid-session recomputes the entire request, and Claude Code asks you to confirm before
> applying the change."

> "**Changing effort level** … the next request reads the entire conversation history with no
> cache hits. Once a conversation has started, Claude Code shows a confirmation dialog before
> applying an effort change that would invalidate the cache. A change that resolves to the same
> level already in effect, such as setting the model's default explicitly, skips the dialog and
> keeps the cache."

Ou seja: **o modal é comportamento documentado do CC** — a troca invalida o prefixo de cache
daquela conversa e o CC pede confirmação. O Rica descreveu por quê ("a troca invalida o cache
do prompt daquela conversa") e a doc confirma com as duas citações acima. E há uma **boa
notícia na doc**: se a troca resolve para o **mesmo nível já em efeito**, o CC **pula o modal**
e mantém o cache — um PATCH redundante para o nível atual não trava.

A doc de **commands** (https://code.claude.com/docs/en/commands) diz que o `/effort`
interativo "takes effect immediately without waiting for the current response to finish" —
mas isso é o que o comando faz **quando é submetido**; na fila do tmux (estado 2 acima) ele
só dispara no fim do turno, e então esbarra no modal. A doc não cobre o caminho "enfileirado
durante turno", que é o que o Rica mediu no terminal.

### Implicação para a fase 2 (decisão de desenho, não implementação)

- O `confirmed: false` do PATCH é **alarme real**: ou a sessão está pensando (e o comando vai
  travar no fim do turno), ou já travou no modal. O cockpit precisa de um **estado "aguardando
  confirmação de esforço"** na UI, com o caminho de destravar (mandar a escolha no tmux —
  Enter para confirmar, Esc/não para cancelar) e avisar que **dois PATCHes seguidos empilham
  modais** (só o primeiro modal deve existir; os seguintes empilham).
- **Mitigação barata (doc):** PATCH que resolve para o nível já em efeito **não abre modal**.
  Um `GET` de leitura antes do PATCH (a statusline diz o nível atual) permite **no-op
  silencioso** quando o alvo já é o atual — evita o modal sem custo.
- **`max` não vira default**: responder do CLI é "this session only"; `medium`/`high`/`xhigh`
  respondem "saved as your default for new sessions" (medido pelo Rica). A doc model-config
  confirma: só `low/medium/high/xhigh` persistem; `max`/`ultracode` session-only.

## 4. Onde o cockpit assume errado hoje — a lista da fase 2, REORDENADA por impacto real

> v1 listava por ordem de descoberta; o Rica pediu por **impacto real** — o que dói mais
> primeiro. Estado de cada item **reconferido no código** em 09/08 (caminho:linha). "FURO"
> = o Rica descreveu um estado e o código diz outro.

1. **A troca em sessão viva pode travar o agente num modal invisível** (NOVO, §3.5 — o mais
   perigoso). PATCH com a sessão pensando → comando na fila → modal `Change effort level?`
   quando o turno acaba → sessão presa até humano escolher; dois PATCHes empilham dois modais.
   O `confirmed:false` do backend não distingue "pensando" de "travado". **Fonte do mecanismo:
   doc oficial de prompt-caching** ("asks you to confirm before applying the change").
2. **Codex: o painel oferece `xhigh`/`max` que o wrapper não injeta — FURO no que o Rica
   disse ter corrigido.** `scripts/tara-codex:164` ainda casa só `^(low|medium|high)$` (sem
   `xhigh`/`max`, sem comentário de codex 0.146 — conferido nos dois worktrees, idênticos).
   O backend passou a aceitar `max` (`agents.py:85`), então persistir `xhigh`/`max` é **no-op
   silencioso**: painel mostra, próxima delegação roda sem flag. **Continua vivo e piorou**:
   a permissão do backend agravou a mentira de UI.
3. **Kimi: painel mostra o pedido, não o efetivo, e o vazamento do settings global segue.**
   `_build_kimi_painel_effort` lê `agent_state` (`agents.py:758`); sessão viva pode rodar em
   `xhigh`→max com o card dizendo `high`. E quando a env var não é setada, o CLI cai no
   settings global (`effortLevel: xhigh`) — o `unset` do `subir_hiro` não protege contra o
   default do arquivo. **Vivo.**
4. **Canário sem `model_family`** — `agents.yaml:191-193`, conferido. O backend o trata como
   Anthropic (escala de 5 níveis + leitura de statusline); o DeepSeek flash mapeia `xhigh`→
   **high**, então o "extra alto" exibido é efetivamente `high` no modelo. **Vivo.**
5. **Codex: leitura do efetivo ignorada.** O painel usa `agent_state` (`agents.py:746`) em vez
   de `threads.reasoning_effort` que o `codex_reader` já expõe. Demonstrado: `agent_state` diz
   `high`, threads rodam `max`. **Vivo** (subitem do item 2, mas a leitura existe para
   Codex mesmo sem o wrapper). 
6. **Kimi: "vale no próximo boot" é escolha do cockpit, não limite do motor.** O `/effort` do
   CLI (mesmo CLI do CC) funcionaria ao vivo; o cockpit só grava `agent_state` para o boot.
   **Vivo para Kimi** (para CC morreu — o §3.1 dirige tmux).
7. **`_write_agent_effort` ficou órfão** (NOVO, do Rica, confirmado): definido em
   `agents.py:996`, **zero chamadores em todo `apps/api/`** (grep em 09/08). É a sobra do
   caminho antigo que escrevia o settings global; o comentário do novo caminho (`agents.py:487`)
   explica por que morreu. **Lixo morto — remover na fase 2** (junto do `_read_agent_effort`,
   que ainda é fallback de leitura, `agents.py:979`).
8. **Codex não é "sessão viva".** O `session_may_diverge` do Codex diz respeito à **thread**
   (efetivo em `threads.reasoning_effort`), não a uma sessão tmux; "mudar em runtime" não se
   aplica igual. A fase 2 não pode tratar os 4 motores com a mesma UX. **Vivo** (conceitual).

**Resolvidos desde a v1 (conferido no código):**

- **Item 3 (v1) — não dirige `/effort` ao vivo → MORTO.** PATCH CC envia `/effort <v>` via
  tmux (`agents.py:500`) + Enter (`agents.py:506`) + confirmação pela statusline
  (`agents.py:820`). (O Rica não o listou como morto, mas o código mostra; registrado aqui.)
- **Item 5 (v1) — painel rejeita `max` no Codex → MORTO.** `_CODEX_PAINEL_ALLOWED_EFFORTS`
  agora inclui `max` (`agents.py:85`).
- **Item 8 (v1) — `auto` não representável → MORTO de ponta a ponta.** `AgentPainelEffortValue`
  inclui `auto` (`agents.py:111`), `_CLAUDE_PAINEL_ALLOWED_EFFORTS` existe (`agents.py:81`),
  front traduz `auto: 'automático'` (`motor.ts:94`), `_poll_claude_effort` trata `auto` como
  caso especial (mudança do nível observado, `agents.py:853-859`).
- **Item 9 (v1) — `max` no settings é questionável → MORTO por dois motivos.** (a) O caminho
  de escrita morreu (PATCH vai por tmux, não mais por settings); (b) a doc model-config diz
  que `effortLevel` **não aceita `max`/`ultracode`** — "not accepted here". O órfão
  `_write_agent_effort` (item 7 acima) é a sobra disso.
- **Item 1 (v1) — um knob para todos → MORTO para CC.** O PATCH não escreve mais o settings
  global (comentário explícito `agents.py:487-489`); a leitura do painel vem da statusline
  viva (`agents.py:951`), global só como fallback (`agents.py:970`).
- **Item 2 (v1) — lê o pedido, não o valor → MORTO para CC.** `_build_claude_painel_effort`
  lê `effort.level` da statusline; `session_may_diverge` = stale. **Continua vivo para
  Codex/Kimi** (itens 3/5 acima).

## 5. Não consegui confirmar (v2)

- **OpenCode Zen/Go repassando o effort ao DeepSeek.** Doc oficial de providers não menciona
  `/v1/messages` nem effort; o mapeamento `output_config.effort`→`reasoning_effort` é inferido.
- **`ultra` como nível de Codex.** Aparece em docs de terceiros; a doc oficial não lista.
- **Se o OpenCode Go aplica os mesmos níveis da doc DeepSeek direct.** Não testei o wire do
  canário.
- **O caminho de confirmação do modal no tmux** (Enter vs Esc e o que cada opção do
  `Change effort level?` faz). O Rica mediu que **abre e trava**; a doc confirma que **pede
  confirmação** e que troca para o mesmo nível **pula o modal**. O conjunto exato de teclas
  para destravar no tmux não foi verificado (é comportamento do TUI do CC, não documentado no
  nível de tecla).
- **Origem da env var `CLAUDE_EFFORT=xhigh`** observada no env do canário (não é a
  `CLAUDE_CODE_EFFORT_LEVEL`); não documentada — não confiar como fonte.

## 6. Método e fontes (v2)

**Código conferido em 09/08 (repositório principal `/home/clawd/repos/grupo_borges`, onde
vive a produção — não o worktree canário; os dois estão idênticos nos pontos citados):**

- `apps/api/routers/agents.py` — `:81` `_CLAUDE_PAINEL_ALLOWED_EFFORTS` (com `auto`) ·
  `:85` `_CODEX_PAINEL_ALLOWED_EFFORTS` (com `max`) · `:111` `AgentPainelEffortValue` ·
  `:462-470` PATCH codex grava agent_state · `:477-480` PATCH kimi grava agent_state ·
  `:487-489` comentário "escrever settings seria redundante" · `:500` `_send_tmux_or_409`
  `/effort` · `:506` press_enter · `:520-524` response com tmux_delivered/confirmed/
  runtime_switch · `:746-755` `_build_codex_painel_effort` lê agent_state ·
  `:758-767` `_build_kimi_painel_effort` lê agent_state · `:814-817` `_cc_effort_level` ·
  `:820-861` `_poll_claude_effort` · `:951-976` `_build_claude_painel_effort` lê statusline,
  fallback settings · `:979-989` `_read_agent_effort` · `:996-1010` `_write_agent_effort`
  (órfão)
- `scripts/tara-codex:164` — regex do effort **ainda `^(low|medium|high)$`** (conferido nos
  dois worktrees, idênticos)
- `apps/cockpit/components/shell/motor.ts:94` — `auto: 'automático'`
- `agents.yaml:191-193` — canarinho sem `model_family`
- `ze-shared/scripts/subir-frota.sh:141-153` (subir_hiro) e `:170-205` (subir_canario) — do
  repositório ze_claude, não do canário
- `~/.codex/config.toml` → `model_reasoning_effort = "max"` · `~/.claude/settings.json` →
  `effortLevel: xhigh` · `~/.codex/state_5.sqlite → threads.reasoning_effort` → valores reais
  de threads (low/medium/high/xhigh/max)

**Docs oficiais (v2):**

- **Claude Code — commands**: https://code.claude.com/docs/en/commands — `/effort` aceita
  `low|medium|high|xhigh|max|ultracode`; `max`/`ultracode` session-only; `auto` reseta; o
  interativo "takes effect immediately".
- **Claude Code — model config**: https://code.claude.com/docs/en/model-config.md —
  `effortLevel`/env não aceitam `max`/`ultracode`; persistência cross-session só de
  `low/medium/high/xhigh`; `_SUPPORTED_CAPABILITIES` para IDs custom.
- **Claude Code — prompt caching**: https://code.claude.com/docs/en/prompt-caching — **a
  fonte do modal**: *"Changing it mid-session recomputes the entire request, and Claude Code
  asks you to confirm before applying the change"* e *"A change that resolves to the same
  level already in effect … skips the dialog and keeps the cache."*
- OpenAI reasoning guide · Kimi thinking models · DeepSeek thinking mode (mesmos da v1).

**Empírico (v2, do Rica — medido no terminal, no Felipe):** os três estados do PATCH em
sessão viva (§3.5), o texto do modal `Change effort level?`, `max` respondendo "this session
only" vs `medium/high/xhigh` "saved as your default for new sessions", e dois PATCHes
empilhando dois modais. O Rica pediu para seguir a doc se ela contradissesse — **ela
confirma, não contradiz** (o modal é o comportamento documentado de confirmação de cache).

**v1:** os itens da v1 não refeitos aqui (persistência/leitura de Codex por threads, wire do
OpenCode Go) seguem nas fontes da v1 (§6 original); os que mudaram estão marcados acima.
