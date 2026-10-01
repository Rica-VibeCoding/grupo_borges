# Cockpit v2 — lista de conversas para retomar

Pesquisa de referência para o "/resume" visual: lista das conversas de cada agente (últimos
30 dias, por data), com título, nota de estacionamento, briefing de retorno e selo de arquivo
sem commit.

- **Verificado em:** 01/10/2026
- **Motor de referência:** Claude Code 2.1.286 (binário local em `~/.local/share/claude/versions/2.1.286`)
- **Medições locais:** feitas nesta máquina em 01/10/2026
- Marcador **[DEDUÇÃO]** = conclusão minha, não está escrito na fonte.

---

## 1. O que o Claude Code já entrega (fonte primária)

Tudo nesta seção sai da documentação oficial em `code.claude.com/docs` — os links antigos
`docs.claude.com/en/docs/claude-code/*` redirecionam (301) para lá.

### 1.1 Título da conversa — três origens, e a sua máquina escreve duas no JSONL

A doc de sessões descreve três rótulos diferentes, e só dois servem como handle:

> "Generated title: if you don't name a session, Claude Code generates a session title for it.
> The title is a short summary of your first prompt, written by a background request to the
> small/fast model, normally a Haiku-class model."
> — https://code.claude.com/docs/en/sessions

> "Default display name: interactive sessions you never name still get a default display name
> when they start. […] The default combines the working directory's name with a two-character
> suffix, for example `my-app-3f` […] **The default isn't a resume handle.**"
> — https://code.claude.com/docs/en/sessions

Ordem de precedência, como a doc descreve: **nome dado pelo usuário > título de plano (quando
um plano é aceito) > título gerado (resumo do primeiro prompt) > primeiro prompt**.

O `/rename`:

> "`/rename [name]` — Rename the current session and show the name on the prompt bar. Without a
> name, auto-generates one from conversation history. Also available in non-interactive mode
> (`-p`)."
> — https://code.claude.com/docs/en/commands

E o `--name` na largada:

> "`--name`, `-n` — Set a display name for the session, shown in `/resume` and the terminal
> title. You can resume a named session with `claude --resume <name>`."
> — https://code.claude.com/docs/en/cli-reference

**Como isso aparece no disco** (medido nesta máquina, 01/10/2026): o JSONL guarda entradas de
metadado, não um campo único. Em `~/.claude/projects/<projeto>/<session-id>.jsonl`:

- `{"type":"ai-title","aiTitle":"...","sessionId":"..."}` — o título automático
- `{"type":"custom-title","customTitle":"...","sessionId":"..."}` — o nome dado pelo usuário
- `{"type":"agent-name","agentName":"...","sessionId":"..."}` — nome do agente
- `{"type":"last-prompt","lastPrompt":"...","leafUuid":"...","sessionId":"..."}` — prévia do último pedido, truncada em ~200 caracteres

Contagem em todo o parque (`~/.claude/projects/`): **16.170** entradas `custom-title`,
**18.157** `last-prompt`, **1.927** `ai-title`, **0** do tipo `summary`.

> [!WARNING]
> **A entrada `summary` morreu.** O tipo histórico `{"type":"summary","summary":...}` — que é o
> que a maioria das ferramentas de comunidade procura — **não existe em nenhum arquivo desta
> máquina**. Foi substituído por `ai-title`. Ferramenta que só procura `summary` mostra lista
> sem título. (Medição local, 01/10/2026. A doc não documenta esse formato — ela diz o
> contrário, ver 1.4.)

### 1.2 O que a linha da lista mostra (o picker nativo)

> "Each row shows the session name if you set one, otherwise the AI-generated session title,
> conversation summary, or first prompt, along with **time since last activity, git branch, and
> file size**. Widen to all projects with `Ctrl+A` to also see each session's project path."
> — https://code.claude.com/docs/en/sessions

Atalhos do picker que dão o "padrão de mercado" de graça:

- `↑`/`↓` navegar · `Enter` retomar · `Space` pré-visualizar o conteúdo
- `Ctrl+R` renomear a conversa destacada (dentro do picker)
- `/` ou qualquer letra entra em modo busca; **colar URL de PR acha a sessão que criou o PR**
- `Ctrl+A` todos os projetos · `Ctrl+W` todas as árvores de trabalho (worktrees) do repo · `Ctrl+B` filtrar pelo ramo git atual
- `→` expande sessões agrupadas: quando há mais de uma entrada para a mesma sessão (ramos de `/branch`, `--fork-session`), elas ficam sob uma linha só
- Sessões de fundo aparecem marcadas com `bg`

### 1.3 Como se retoma

> "`claude -r "<session>" "query"` — Resume session by ID or name"
> — https://code.claude.com/docs/en/cli-reference

Isso é o que interessa pro cockpit: **aceita um prompt junto**, então o briefing de retorno
pode ir na própria linha de comando.

Dois pontos que mudam o desenho:

> "`/resume` | Switches to a different conversation from inside an active session" — e, no
> detalhe: "`/resume` **moves your current conversation to the background** and attaches this
> terminal to the running session."
> — https://code.claude.com/docs/en/sessions

> "If you resume the same session in two terminals without forking, **messages from both
> interleave into one transcript**."
> — https://code.claude.com/docs/en/sessions

Também: `claude --resume <caminho-absoluto-do-.jsonl>` funciona — aceita caminho de arquivo no
lugar do ID. E `--fork-session` cria um ID novo em vez de reusar o original.

### 1.4 Retenção — os 30 dias já são o padrão

> "Change the 30-day retention → [`cleanupPeriodDays`] → `settings.json`"
> — https://code.claude.com/docs/en/sessions

**30 dias é o padrão de fábrica.** A janela que o Rica quer é exatamente a retenção nativa.

> [!CAUTION]
> **A doc proíbe o que a gente pretende fazer.**
> > "The entry format is internal to Claude Code and changes between versions, so **scripts that
> > parse these files directly can break on any release**. To build on session data, use
> > `/export` or the [script interfaces] instead."
> > — https://code.claude.com/docs/en/sessions
>
> Interfaces oficiais oferecidas: `/export`, `claude -p --output-format json`,
> o campo `transcript_path` que hooks e statusline recebem, e o Agent SDK.
> **Não existe interface documentada para LISTAR sessões.** `claude agents --json` lista, mas
> só sessões de fundo ativas (`claude agents --json` / `--all`). [DEDUÇÃO] Listar é o único
> ponto em que ler o `~/.claude/projects/` é inevitável hoje — o risco é real e precisa de
> blindagem (ver §6).

### 1.5 Hooks — o que dá pra disparar

**SessionStart** (https://code.claude.com/docs/en/hooks):

- Filtros (matchers): `startup`, `resume`, `clear`, `compact`, `fork`
- Recebe no JSON de entrada: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`, `model`, `agent_type` e **`session_title`** ("The session's custom title, when one is set")
- **Quando `source` é `resume` ou `fork` E o histórico já tem resposta do Claude**, recebe mais quatro campos de graça — e são exatamente o miolo de um briefing de retorno:
  - `seconds_since_last_response`
  - `context_tokens`
  - `prompt_cache_likely_expired`
  - `estimated_cache_write_usd`
  - (exige v2.1.251+)
- Pode devolver: `additionalContext`, `initialUserMessage`, **`sessionTitle`**, `watchPaths`, `reloadSkills`. Não pode bloquear.
- ⚠️ Só aceita handler `type: "command"` e `type: "mcp_tool"` — `prompt` e `agent` não rodam aqui.

**SessionEnd** (mesma página):

- Motivos (matchers): `clear`, `resume`, `logout`, `prompt_input_exit`, `other`
  — confirmado também no binário: `["clear","resume","logout","prompt_input_exit","other"]`
- Não decide nada (sem controle de decisão; saída 2 só mostra stderr pro usuário)
- **Orçamento de tempo compartilhado de 1,5 s**, elevado até 60 s por `timeout` explícito no hook
- A doc cita o uso canônico: "A `SessionEnd` hook can archive the transcript when a session ends."

[DEDUÇÃO] O motivo `resume` é o gatilho que o desenho do Rica precisa: é o instante em que a
conversa é largada porque outra foi retomada — o momento exato de escrever a nota de
estacionamento. A doc lista o valor mas não descreve a semântica; **testar antes de confiar**.

### 1.6 `/clear` já titula a conversa que sai — nativo

> "`/clear [name]` — Start a new conversation with empty context. **Pass a name to label the
> previous conversation in the `/resume` picker.**"
> — https://code.claude.com/docs/en/commands

> "With no argument, the new conversation keeps a name you set with `--name` or `/rename`, but
> not an AI-generated session title. **To name the conversation you're leaving instead, pass the
> name**, as in `/clear release-prep`; the new conversation then starts unnamed."
> — https://code.claude.com/docs/en/sessions

Isso derruba uma premissa do desenho: **não precisa de hook para dar título à conversa que
sai.** `/clear <nome>` faz isso sozinho. O que precisa de mecanismo próprio é a *nota de
estacionamento* — essa não tem campo nativo.

### 1.7 Um detalhe de statusline que serve pro cockpit

A doc de sessões cita que o título aparece "in the statusline `session_name` field when no name
is set". O binário confirma os campos `session_name`, `session_name_uniqueness` e
`session_name_collision`. [DEDUÇÃO] O script de statusline de cada agente pode ler o nome da
conversa viva sem abrir o JSONL — barato, e é interface documentada.

### 1.8 A armadilha do diálogo de retomada

> "On a Pro or Max plan, when you resume a session that has been inactive for more than about an
> hour and is over 100,000 tokens, Claude Code restores the conversation and then **opens a
> dialog before you send your first message**."
> — https://code.claude.com/docs/en/sessions

O diálogo oferece "Resume from summary", "Resume full session as-is" e "Don't ask me again".
**Numa linha tmux sem terminal humano, um diálogo é uma linha travada.** Ver §6.

---

## 2. Como produtos validados resolvem

### 2.1 Hermes Agent (Nous Research)

- Repo/doc: https://github.com/NousResearch/hermes-agent · https://hermes-agent.nousresearch.com/docs/user-guide/sessions
- **Título:** automático, gerado por LLM — "a short descriptive title (3–7 words) for each session after the first exchange", numa thread de fundo, "only fires once per session". Regras citadas: único entre sessões, máximo de 100 caracteres. Manual por `/title My Session` ou `hermes sessions rename <id> <title>`. Sem título, a coluna mostra "—".
- **Linha da lista:** colunas documentadas `Title`, `Preview`, `Last Active`, `ID`. Exemplo da doc: `refactoring auth` / "Help me refactor the auth module please" / "2h ago". Sem contagem de mensagens e sem modelo na linha.
- **Retomada:** `hermes --continue`, `hermes --resume <id>`, `hermes --resume "<título>"` (resolve por título), `--resume latest`. Restaura o histórico completo do SQLite.
- **Nota de retorno — é o ponto forte deles:** ao resumir, mostra um painel "Previous Conversation" entre o banner e o prompt, com mensagens do usuário e do assistente, truncadas (300 caracteres para o usuário, 200 / 3 linhas para o assistente), chamadas de ferramenta colapsadas em contador (`[3 tool calls: terminal, web_search]`) e limite de "last 10 exchanges" com indicador de mensagens anteriores.
- **Ordenação:** recentes primeiro, pinagem com flag durável (`hermes sessions pin`) que também isenta a sessão da limpeza automática; busca FTS5 com frases, booleano e prefixo.
- **Furos:**
  - Issue [#12173](https://github.com/NousResearch/hermes-agent/issues/12173) — `/resume <título>` resolvia sessões **fora do escopo do usuário**: "one gateway user can resume an unrelated CLI or another user's titled session if they know or guess the title". Fechada (P1, `type/security`).
  - Issue [#125078](https://github.com/NousResearch/hermes-agent/issues/125078) — a dica de retomada impressa na saída do TUI não levava o perfil (`-p`), então colar a dica retomava a sessão errada / falhava. Fechada.
  - Issue [#58933](https://github.com/NousResearch/hermes-agent/issues/58933) — após expirar o prazo de retomada, a próxima mensagem criava sessão nova **sem avisar**, e como o título é gerado da primeira mensagem, parecia conversa nova de propósito.
  - PR [#37112](https://github.com/NousResearch/hermes-agent/pull/37112) — lista corrompida passou a preservar "the last good raw history instead of silently blanking the resumable section"; e o polling de status parou de reconsultar as 200 linhas de histórico a cada 1,5 s.

### 2.2 OpenClaw

- Repo/doc: https://github.com/openclaw/openclaw · https://docs.openclaw.ai/web/control-ui/sessions-and-sidebar
- **Título:** gerado por LLM, com um detalhe peculiar — na interface web, o rascunho parado por 1 segundo já dispara a geração ("prepares a session name in the background using only the selected agent's utility model"), a partir de 12 caracteres enviados e no máximo 1.000. **Não re-titula:** "This applies only at creation — later messages don't re-title an existing session". Se falhar, cai num nome de duas palavras. Manual por `/name <label>`; "A saved custom name outranks an automatic title".
- **Linha da lista:** **prévia escondida por padrão** — "Session previews are hidden by default for compact, single-line rows". Traz bolinha de não-lido, anel de atividade, badge de lápis quando há rascunho não enviado, badge de globo para sessão em nuvem, linhas arquivadas esmaecidas. **Modelo não aparece na linha.** Altura fixa de 32 px no desktop.
- **Retomada:** `openclaw resume` — "The session stays on the Gateway; `resume` selects it and opens the existing TUI" e "it never starts a new session". Sem argumento, lista até 50 sessões ativas nos últimos sete dias.
- **Nota de retorno:** **não existe** recap em prosa. O equivalente é delta por versão: aviso "changed (other actor). Reconcile before acting" apontando para `session_status ... changesSince 12`, e os eventos carregam "metadata and a one-line summary — never message content".
- **Furos (a lista de conversas é a área historicamente problemática deles):**
  - Issue [#58534](https://github.com/openclaw/openclaw/issues/58534) — em 447 sessões, CPU do Gateway "100-115% sustained", `sessions.list` em 6,5 s, RAM acima de 1 GB; causa citada: "serializes all sessions on every call — O(n) with expensive per-session work", com o painel consultando "~every 7 seconds" e sem paginação nem cache.
  - Issue [#64321](https://github.com/openclaw/openclaw/issues/64321) — "takes 23 seconds to complete with 124 session files totaling 112MB", "without caching or indexing".
  - Issue [#98742](https://github.com/openclaw/openclaw/issues/98742) — nome de sessão **sumia da interface** mesmo com o rótulo intacto no disco: "a display/rehydration mismatch rather than true data loss".
  - PR [#141600](https://github.com/openclaw/openclaw/pull/141600) — antes do conserto, conversas novas ficavam "retain first-message fragments or device placeholders when utility-model session naming failed".
  - Issue [#157340](https://github.com/openclaw/openclaw/issues/157340) — o mesmo objeto chamado de "session", "thread" e "chat" em telas diferentes: "People think sessions, threads, and chats are different things."

### 2.3 UIs de comunidade para Claude Code

**claude-code-log** — https://github.com/daaain/claude-code-log (~1,2 mil estrelas, ativo)
É a referência mais explícita de leitura do JSONL. Reconhece `type: "summary"` (a entrada
legada), entradas `ai-title` (`AiTitleTranscriptEntry` / `aiTitle`) e a flag `isMeta`. A TUI
mostra "session IDs, summaries, timestamps, message counts, and token usage", e a tecla `c` roda
`claude -r <sessionId>`. Furo que eles documentam em comentário no código: `summary` e
`ai-title` **não têm carimbo de tempo**, então o filtro por data precisa mantê-los vivos à mão —
"Summary / ai-title entries carry no timestamp — keep them so the title/summary survives date
filtering".

**claudecodeui / CloudCLI** — https://github.com/siteboon/claudecodeui (~13,9 mil estrelas)
Título por prioridade de campo: `customTitle || aiTitle || lastPrompt`, com queda para o
`history.jsonl` global. Linha = `sessionId, provider, projectId, projectDisplayName,
sessionTitle, lastActivity` — e **`messageCount` vai fixo em zero**. Favoritar é por *projeto*,
não por conversa. Furos: [#1022](https://github.com/siteboon/claudecodeui/issues/1022)
"message history silently truncated at resume boundaries"; [#1462](https://github.com/siteboon/claudecodeui/issues/1462)
"Session renames don't propagate between the UI and the Claude Code CLI"; [#1144](https://github.com/siteboon/claudecodeui/issues/1144)
"split prompt-cache lineage for the same resumed session".

**Happy Coder** — https://github.com/slopus/happy (~24 mil estrelas)
**Não lê `~/.claude/projects`**: mantém estado próprio (`~/.happy/...`) com expiração de 14 dias.
Título vem do modelo de sessão do próprio Happy, não do JSONL. A linha é a mais rica das que
vi: avatar, nome, projeto, árvore de trabalho com ícone de ramo, carimbo de tempo, ponto de
estado (aguardando entrada / aguardando permissão), badge de não-lido, badge de rascunho e
**`gitChangedFiles`** — que é literalmente o "arquivo alterado e não commitado" do nosso selo.
Sessão de máquina desligada fica esmaecida (`machineOffline`) — mesmo padrão do "apagada" do
Rica. Retomada por `--resume <claudeSessionId>`. **Sem busca e sem fixar.** Furo:
[#613](https://github.com/slopus/happy/issues/613) "Garbled Input Line after coming back from
remote state".

**opcode (ex-Claudia)** — https://github.com/winfunc/opcode (~22,4 mil estrelas)
Título **não é de LLM**: o parser guarda só `first_message`, extraída do primeiro `role=="user"`
do JSONL, pulando `Caveat:` e entradas de comando. Linha = id da sessão, projeto,
`first_message` e timestamps vindos do **mtime do arquivo**, não do conteúdo. Retomada por
`--resume <session_id>`. Furos: não dá para apagar sessão ([#305](https://github.com/winfunc/opcode/issues/305)),
e no Windows "Create a new session every question" ([#313](https://github.com/winfunc/opcode/issues/313)).

**ccmanager** — https://github.com/kbwo/ccmanager (~1,2 mil estrelas)
O contraexemplo mais útil. **Não retoma nada:** o README diz que "restoring means starting the
same command again, not resuming where it left off" e "The previous terminal output and the
conversation ... are not restored". Sessão = nome dado pelo usuário por árvore de trabalho, com
estado Idle / Busy / Awaiting confirmation detectado lendo o **buffer do terminal**, não o JSONL.

**Crystal / Conductor** — Crystal (https://github.com/stravu/crystal) está **deprecado** desde
fev/2026, substituído pelo Nimbalyst. Conductor (https://www.conductor.build) é aplicativo Mac
**proprietário, sem repositório público**. Nenhum dos dois foi verificado em nível de código.

### 2.4 Produtos maduros de conversa (ChatGPT, Claude.ai, Cursor, Warp)

Nenhum deles documenta **como** o título é gerado — só o Claude Code faz isso. O que eles
documentam é a lista.

**ChatGPT** — https://learn.chatgpt.com/docs/projects
Renomear é por conversa e é recurso de primeira linha: "Rename a chat with a short title that
describes its outcome". A barra lateral é **deliberadamente truncada**:

> "we only keep a compact list of your most recent conversations in the fast-loading sidebar
> […] Older chats are trimmed"
> — https://help.openai.com/en/articles/10056348-how-do-i-search-my-chat-history-in-chatgpt

Busca casa **título e conteúdo**, por atalho `Ctrl/Cmd+K`, e conversas arquivadas continuam
buscáveis. Fixar existe ("Pin a chat when you return to it often") e também por projeto.
[DEDUÇÃO] O truncamento da barra é a mesma decisão de projeto que o OpenClaw errou ao não tomar
(§2.2) — lista curta por padrão, histórico atrás de busca.

**Claude.ai** — https://support.claude.com/en/articles/8230524-delete-or-rename-a-conversation
Renomear é por conversa, no menu `⋮` ao lado do nome. A busca é o **diferencial e é
contraintuitiva**:

> "You can prompt Claude to search through your previous conversations […] These searches use
> Retrieval-Augmented Generation (RAG) and will appear as tool calls"
> — https://support.claude.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context

Não é caixa de busca — é conversa. Projetos são "self-contained workspaces with their own chat
histories and knowledge bases", e o escopo da busca respeita isso. Estrelar/se fixar existe
**por projeto**, não por conversa.

**Cursor** — https://cursor.com/help/ai-features/conversation-search.md
Não documenta lista de conversas com título nem renomear. O que documenta é o índice local:

> "Cursor builds a local search index that scales to thousands of conversations"
> — https://cursor.com/help/ai-features/conversation-search.md

[DEDUÇÃO] É a única referência de escala do levantamento que assume milhares de conversas como
caso normal, e resolve com **índice** — não varredura. A segmentação é por Project (repositório),
não por pasta. O "Previous Chats", o lápis de renomear e o título automático que circulam em
tutoriais **não estão na doc oficial** — NÃO VERIFICADOS.

**Warp** — https://docs.warp.dev/agents/local-agents/interacting-with-agents/
É a doc que mais se parece com o que o Rica quer. O "Conversation Panel" é descrito como "the
home for browsing and switching between agent conversations", com dois dropdowns: **Active**
("threads where you have sent at least one query") e **Past**. Cada linha traz:

- **Conversation title**
- tempo relativo — "8 min ago", "3 days ago"
- **working directory**, "when relevant"

Busca filtra "by title" (às vezes também por diretório), com atalho `⌘+Y` / `Ctrl+Shift+Y`,
comando `/conversations` e o mesmo no command palette. Em conversas na nuvem:
"Restore: Click a conversation to load it into your current session and continue where you left
off", com link compartilhável e visualização no navegador sem instalar.

**O que não existe em nenhum dos quatro:** resumo do tipo "o que mudou desde que você saiu".
Procurado e não encontrado na doc oficial do Cursor, e nenhum dos outros três documenta algo
equivalente.

---

## 3. Padrões que se repetem

1. **Toda conversa tem título, e o título é o que se clica.** É o único item 100% comum entre
   todos os produtos vistos — ChatGPT, Claude, Warp ("Conversation title"), Cursor, Hermes,
   OpenClaw e Claude Code. O *mecanismo* de geração só é documentado por Claude Code (modelo
   pequeno, uma vez, resumo do primeiro pedido) e por Hermes e OpenClaw.
2. **Escrita do usuário sempre pode renomear, e vence o automático.** É também o único título
   que serve de handle estável de retomada: Claude Code `--resume <nome>`, Hermes
   `--resume "<título>"`, OpenClaw `/name`. ChatGPT e Claude.ai permitem renomear sem usar o
   título para retomar.
3. **Linha enxuta**: título + prévia + "há quanto tempo". Contagem de mensagens, modelo e custo
   quase nunca aparecem na linha — vivem no detalhe. O Happy é a exceção que confirma a regra:
   é a linha mais carregada do levantamento e a mais difícil de ler no celular.
4. **Tempo relativo, não data crua.** Documentado no Warp ("8 min ago", "3 days ago"), no picker
   do Claude Code ("time since last activity") e no Hermes ("2h ago"). Onde a data aparece
   (Hermes, `Last Active`), é por ser lista ordenável, não a leitura principal.
5. **Estado esmaecido** para o que não está disponível (Happy `machineOffline`, OpenClaw
   arquivada) — o mesmo que o Rica quer para "conversa já aberta em outro lugar".
6. **A lista encolhe de propósito.** ChatGPT trunca a barra lateral assumidamente ("Older chats
   are trimmed"); Cursor resolve com índice local que "scales to thousands". Histórico completo
   atrás de **busca**, não de rolagem.
7. **Busca é obrigatória na lista.** ChatGPT casa título e conteúdo; Warp filtra por título ou
   conteúdo; Cursor indexa transcrições inteiras; Hermes usa FTS5 com booleano. Claude.ai é o
   caso extremo: trocou a caixa de busca por busca conversacional (RAG). O único que não tem
   busca é o Happy — e é o mais limitado dos sete.
8. **Nota de retorno é rara e é diferencial.** Só o Hermes faz recap em prosa. OpenClaw faz
   delta por versão (o que mudou, não o que foi dito). Claude Code oferece o diálogo
   resumo-vs-inteiro. Nenhum dos quatro produtos de conversa (ChatGPT, Claude.ai, Cursor, Warp)
   documenta qualquer coisa parecida. **O "briefing de retorno" do Rica está na frente do
   mercado.**
9. **A lista é o ponto de quebra quando cresce.** OpenClaw quebrou em 400+ sessões; Hermes
   corrigiu polling de 200 linhas. Ninguém sofreu problema por *mostrar de menos*.
10. **Agrupar por data ("Hoje", "Ontem", "Últimos 7 dias") não é documentado em nenhum deles** —
    procurei no ChatGPT e no Claude.ai e não está na doc oficial. [DEDUÇÃO] É padrão de
    aplicativo de mensagem, não de lista de sessões de trabalho: aqui as conversas são poucas e
    nomeadas, não um fluxo diário. **Vale reavaliar o "por data" do desenho** — o que os
    produtos fazem é ordenar por atividade recente, com tempo relativo por linha.

---

## 4. Furos no desenho proposto

Ordem de gravidade. Os três primeiros mudam o desenho, não só a implementação.

### 4.1 "Mata o que roda em background" briga com o Claude Code

A doc é explícita: `/resume` **não mata** a conversa atual — "moves your current conversation to
the background". E retomar uma sessão que já roda **anexa** a ela em vez de substituí-la. Pior:
"If you resume the same session in two terminals without forking, **messages from both interleave
into one transcript**".

Matar a linha tmux antes resolve para a *nossa* linha, mas não protege contra a conversa estar
aberta em outro lugar. O selo "apagada" (Rica) é a mitigação certa — mas ele precisa ser
**estado bloqueante**, não decorativo. [DEDUÇÃO] Se a conversa está aberta em outro tmux,
retomar deve ficar desabilitado, não só esmaecido.

### 4.2 `customTitle` na nossa frota não distingue conversa

Medição local, 01/10/2026: **em 100% das sessões do Canário, a entrada `custom-title` está na
linha 1 do arquivo e vale "Canário"** — é o nome do agente gravado na largada, não o título da
conversa. Hoje a lista do Canário mostraria 18 linhas idênticas.

Pior: o `/clear` sem argumento **preserva** esse nome ("the new conversation keeps a name you set
with `--name` or `/rename`"). Ou seja, se nada mudar, toda conversa nova continua "Canário".

**Correção:** o botão "Nova conversa" precisa mandar `/clear <título-da-que-sai>` (nome
explícito, sintaxe nativa), e a largada da linha **não pode** passar `--name Canário` — ou o
nome do agente tem que sair do `agent-name`/`--agent`, não do título.

### 4.3 O título automático não é confiável na nossa frota

Medição local, 01/10/2026, entradas `ai-title` por agente: Pavan **836**, Miga **324**, Tara
**196**, **Canário 0** — em 18 arquivos, nenhuma. Enquanto isso o Canário tem 16.170 entradas
`custom-title` no parque inteiro.

[DEDUÇÃO] O título automático é uma requisição de fundo ao modelo pequeno; na nossa frota o
motor é DeepSeek via OpenCode Go, e alguma combinação de sessão curta + motor trocado está
derrubando a geração. **A causa não foi verificada** — mas o efeito é medido: não dá para
desenhar a lista contando com `aiTitle`. A ordem de queda tem que ser
`customTitle-da-conversa → aiTitle → lastPrompt → primeira mensagem`, como faz o claudecodeui.

### 4.4 Ler o JSONL é contramão da doc oficial

A doc avisa em letras grandes que o formato "changes between versions" e que script que lê
direto "can break on any release". Não existe interface oficial para **listar** sessões — só
para ler uma que você já conhece (`--export`, `claude -p --resume --output-format json`,
`transcript_path` de hook).

[DEDUÇÃO] Listar exige ler `~/.claude/projects/`. O que dá para blindar:
- Ler **só o começo e o fim** de cada arquivo (as entradas de metadado ficam na linha 1 e nas
  últimas), nunca o arquivo inteiro — o maior aqui tem 3,1 MB.
- Degradar para `lastPrompt` quando o título faltar, em vez de mostrar linha vazia.
- Testar contra a versão do CC no boot, e ter um plano B declarado quando o formato mudar.

### 4.5 A escala do Pavan

172 arquivos só no Pavan, contra 18 no Canário e 40 na Tara. O OpenClaw quebrou exatamente aqui:
listar O(n) a cada 7 segundos deu 6,5 s e 100% de CPU com 447 sessões, e 23 s com 112 MB. A
regra do "últimos 30 dias" já limita, mas o parse por arquivo precisa de cache e de teto por
página.

### 4.6 O diálogo de retomada pode travar a linha

Sessão parada há mais de uma hora e acima de 100 mil tokens abre **diálogo interativo** ao
retomar (Pro/Max). Numa linha tmux relançada pelo cockpit, isso é um bloqueio silencioso — a
lista diz "retomada", a linha fica parada esperando tecla. Precisa ser testado; se acontecer,
o briefing tem que entrar por `-r <id> "<texto>"` ou o diálogo precisa ser desarmado.

### 4.7 Um ponto a favor, que o desenho não aproveitou

`file-history-snapshot` já registra **quais arquivos a conversa mexeu**. Medição local: em 200
snapshots do Pavan, 126 têm lista não vazia, e cada item traz caminho absoluto,
`backupFileName`, `backupTime`, `realParentDir` e `version`. É a fonte natural para o briefing
(`git log` sobre esses caminhos) e para o selo ⚠️ (`git status` sobre eles), sem varrer chamada
de ferramenta uma por uma.

Ressalva: arquivos **criados** pela conversa não aparecem lá — só os que o CC salvou backup
antes de editar. [DEDUÇÃO] O selo vai ter falso negativo em arquivo novo.

---

## 5. Recomendações pro cockpit

- **Título da conversa que sai: usar `/clear <nome>` nativo.** Não construir hook para isso. Só
  garantir que a largada não passe `--name` com o nome do agente.
- **Nota de estacionamento: `SessionEnd` com filtro `resume` (e `clear`) escrevendo num arquivo
  lateral por sessão.** Testar antes a semântica do `resume` — a doc lista o valor mas não
  descreve quando ele dispara.
- **Briefing de retorno: hook `SessionStart` com filtro `resume`**, devolvendo `additionalContext`.
  Aproveitar de graça `seconds_since_last_response`, `context_tokens`,
  `prompt_cache_likely_expired` e `estimated_cache_write_usd` (CC 2.1.251+).
- **Arquivos da conversa: ler `file-history-snapshot`**, não o histórico inteiro. `git log` e
  `git status` sobre esses caminhos dão o briefing e o selo. Aceitar falso negativo em arquivo
  novo e compensar com o que o `git status` do repo já mostra.
- **Ordem de queda do título:** `custom-title` (só quando diferente do nome do agente) →
  `ai-title` → `last-prompt` → primeira mensagem. Nunca mostrar linha vazia.
- **Ler só cabeça e cauda de cada JSONL**, com cache por mtime. Teto por página na lista.
- **Selo "aberta em outro lugar" bloqueia, não só esmaece.** Retomar sessão viva em dois lugares
  interleave mensagens — o dano é corrupção de histórico, não confusão visual.
- **Agrupar como o picker nativo:** ramos de `/branch` e `--fork-session` (mesmo `sessionId`
  lógico) sob uma linha só, com expandir.
- **Estado como ícone + rótulo curto**, no molde do Happy: aguardando entrada / aguardando
  permissão / máquina desligada / alterações não commitadas.
- **Nunca chamar de "chat", "thread" e "sessão" na mesma tela.** O furo [#157340] do OpenClaw
  é literalmente isso, com usuário reclamando.
- **Ordenar por atividade recente, com tempo relativo na linha** ("3h", "ontem"), como o Warp
  documenta. O agrupamento por data do desenho não tem precedente em doc oficial de nenhum dos
  sete produtos — vale trocar ou, no mínimo, não depender dele.
- **Busca na lista desde a primeira versão**, casando título e conteúdo. É o que permite a lista
  ficar curta sem esconder nada — ChatGPT trunca a barra justamente porque existe busca atrás.
  Sem busca, "últimos 30 dias" vira rolagem de 172 linhas no Pavan.
- **Furo de segurança do Hermes (#12173) como lição:** se o cockpit algum dia expuser retomada
  por título, escopar por agente. Título não é identificador — dois agentes podem ter "Correção
  do recibo".

---

## 6. O que não deu para verificar

- **Semântica do motivo `resume` no `SessionEnd`** — valor confirmado na doc e no binário
  (`["clear","resume","logout","prompt_input_exit","other"]`), gatilho real não testado.
- **Se o diálogo "Resume from summary" aparece com prompt na linha de comando** — a doc diz que
  ele vem "before you send your first message"; o comportamento com `-r <id> "texto"` não está
  documentado.
- **Conductor** — aplicativo proprietário, sem repositório público. Nada verificado.
- **Crystal / Nimbalyst** — Crystal está congelado (deprecado), Nimbalyst não foi inspecionado
  em nível de código.
- **Causa da ausência de `ai-title` no Canário** — o efeito é medido (0 em 18 arquivos), a causa
  não.
- **Como ChatGPT, Claude.ai, Cursor e Warp geram o título** — nenhum dos quatro documenta. Tudo
  que circula sobre "primeiras palavras da primeira mensagem" vem de tutorial de terceiros, sem
  fonte primária. Só Claude Code, Hermes e OpenClaw documentam o mecanismo.
- **Cursor: "Previous Chats", renomear e título automático** — aparecem só em espelho de doc
  antiga e em tutoriais; não estão na doc atual. Se a referência importa, precisa de teste
  manual no produto.
- **ChatGPT: prévia e data por linha na barra lateral** — a doc só fala em "compact list of your
  most recent conversations"; nada sobre o que cada linha mostra.
- **Acesso a `help.openai.com` bloqueou leitura direta** (403). Os trechos do ChatGPT vieram de
  cópias no Wayback da própria página oficial — a data de captura dos snapshots está nos links.

---

*Fontes oficiais usadas: https://code.claude.com/docs/en/sessions ·
https://code.claude.com/docs/en/hooks · https://code.claude.com/docs/en/cli-reference ·
https://code.claude.com/docs/en/commands · binário Claude Code 2.1.286 e
`~/.claude/projects/` desta máquina (medições de 01/10/2026).*
