# Pesquisa — stack da feature Faxina

**Canário, 23/09/2026.** Fontes: doc oficial + código local + **medição própria** onde a doc calava.
Ambiente: Claude Code **2.1.280** na Oracle, usuário `clawd`, motor DeepSeek v4.1-flash[1m] via proxy.
Bancadas usadas: `/tmp/hooktest` (captura de payload) e `/tmp/faxina-git-r3TU` (git). Descartáveis.

---

## 1. Hooks do Claude Code — PostToolUse em Read e Skill

### Payload exato (medido, não deduzido)

Capturei o stdin real de um hook `"matcher": "Read|Skill"` numa sessão headless. Os dois payloads, verbatim:

```json
{"session_id":"<uuid>","transcript_path":"/home/clawd/.claude/projects/-tmp-hooktest/<uuid>.jsonl",
 "cwd":"/tmp/hooktest","prompt_id":"<uuid>","permission_mode":"bypassPermissions",
 "effort":{"level":"medium"},"hook_event_name":"PostToolUse","tool_name":"Read",
 "tool_input":{"file_path":"/tmp/hooktest/alvo.md"},
 "tool_response":{"type":"text","file":{"filePath":"/tmp/hooktest/alvo.md","content":"alvo de leitura\n",
                 "numLines":2,"startLine":1,"totalLines":2}},
 "tool_use_id":"call_00_...","duration_ms":24}
```

```json
{"tool_name":"Skill","tool_input":{"skill":"skill-de-teste"},
 "tool_response":{"success":true,"commandName":"skill-de-teste"}}
```

- **Read** → `tool_input.file_path` (string absoluta). Com `offset`/`limit` esses campos também aparecem.
- **Skill** → `tool_input.skill` (o nome, não o caminho). `tool_response.commandName` repete o nome.
- Comuns aos dois: `session_id`, `cwd`, `transcript_path`, `prompt_id`, `permission_mode`, `effort`, `tool_use_id`, `hook_event_name`, `tool_name`, `duration_ms`.
- **`tool_response` do Read carrega o arquivo INTEIRO** em `content`. Logar stdin = gravar o documento todo.

### Sintaxe do matcher

Do doc oficial ([code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks), lido 23/09/2026):

| Valor | Como é avaliado |
|---|---|
| `"*"`, `""` ou omitido | casa tudo |
| só letras, dígitos, `_`, `-`, espaço, `,`, `\|` | string exata, ou lista separada por `\|` / `,` |
| qualquer outro caractere | **regex JavaScript, não ancorada** (`Edit.*` casa `NotebookEdit`) |

O matcher é avaliado contra `tool_name`. `Read|Skill` e `Read, Skill` funcionam (vírgula exige ≥ 2.1.191; hífen no set exato exige ≥ 2.1.195). MCP casa por `mcp__<servidor>__<tool>` — `mcp__x__.*`, o `.*` é obrigatório. Filtro fino por argumento é o campo `if` (ex.: `"Edit(*.ts)"`).

### Global × workspace

Não é "um ou outro": **hooks somam entre níveis** (merge, não substituição), **todos os que casam rodam em paralelo**, e o mesmo handler repetido em dois arquivos roda **uma vez**.

Locais: `~/.claude/settings.json` (todos os projetos do usuário) · `.claude/settings.json` do projeto · `.claude/settings.local.json` · managed policy · plugin (`hooks/hooks.json`) · frontmatter de skill e de subagente.

⚠️ **Sessão em nuvem lê o `.claude/settings.json` do repo, NÃO o `~/.claude/settings.json`** (doc, mesma página). Tunel global não cobre sessão em nuvem.

Na prática hoje: o `~/.claude/settings.json` já roda 4 hooks de `PreToolUse`, 2 de `UserPromptSubmit` e 1 de `SessionStart`; o workspace `canario` acrescenta `UserPromptSubmit` + `PostToolUse`. Os dois conjuntos valem na mesma sessão.

### Motor não-Anthropic via proxy (Tara, eu)

**Vale igual — hooks são do harness, não do modelo.** Medido: rodaram no teste headless com `deepseek-v4.1-flash[1m]`, a ponto de o CC imprimir `claude-code:unrecognized_model` e mesmo assim executar o hook; e rodam nesta sessão (o `UserPromptSubmit` do cockpit disparou agora). Tara usa o mesmo binário e o mesmo `clawd`. Confiança ALTA.

### Bash escapa do hook

**Escapa, medido.** Com o matcher `Read|Skill` ativo, mandei a sessão ler o arquivo com `cat` — **zero payloads capturados**. O `tool_name` é `Bash`; nenhum matcher de Read casa. Para pegar isso só com matcher em `Bash` + parse do comando (que é o que `bloqueia-regex-explosiva.py` já faz).

### Subagente NÃO perde a leitura

**Medido também**: um Read dentro de subagente `Explore` disparou o hook e o payload veio com `agent_id` e `agent_type`:

```
tool: Read | agent_id: afd2212311c55e1d1 | agent_type: Explore | input: {'file_path': '/tmp/hooktest/alvo.md'}
```

Contador de faxina não fica cego pra `Explore`/`general-purpose`. (O doc confirma: hooks de settings e plugins rodam dentro de subagentes.)

### Quanto pesa por chamada

Hook `command` = **um processo novo por disparo**, e por padrão ele **segura o turno** (só `async: true` desacopla). Timeout default 600 s pra `command` (30 s em `UserPromptSubmit`). Medido, 30 execuções cada:

- `bash` no-op: **3,6 ms**
- `python3` no-op: **48,4 ms**
- hook real da casa (`memoria-teto-indice.py`): **85,5 ms**

Ou seja: ~50–90 ms de custo fixo por Read, se o hook for Python. **Zero token** — o que entra no contexto só se o hook devolver `additionalContext`. Com centenas de Reads por sessão isso vira dezenas de segundos de espera, e é a razão pra escrever o coletor em `bash` puro ou usar `async: true`.

---

## 2. Jev chamado de fora de qualquer agente

### Forma de chamada

CLI Python, stdlib pura, um request por invocação — sem scheduler e sem retry automático.

```bash
python3 /home/clawd/repos/ze_claude/pavan/.claude/skills/jev/scripts/jev.py decide request.json --dry-run
python3 /home/clawd/repos/ze_claude/pavan/.claude/skills/jev/scripts/jev.py decide request.json
```

Flags (`scripts/jev.py:200-216`): `--model` (default `typesafe/jev-1.13`), `--min-probability` **0,8**, `--min-margin` **0,15**, `--review-label`, `--timeout` **30 s**, `--dry-run` (valida e imprime, não chama API, não precisa de chave).

Exit code (`scripts/jev.py:250-253`): **0** = selecionado · **2** = alguma pergunta `needs_review` · **1** = erro de entrada/API. O `2` é a deixa natural pra fila "revisar com o Rica".

Roda fora de agente sem problema: é `python3` + `urllib`, não depende de MCP nem de sessão CC (`references/api.md:1-3`). **Só precisa de `OPENROUTER_API_KEY` no ambiente do processo** (`scripts/jev.py:101`).

### Formato do lote

Um `state` compartilhado + **uma pergunta por registro por propriedade**, com ID estável, e a instrução citando o caminho exato do registro (o ID sozinho não é instrução). O molde pronto é `assets/batch-triage.json` (2 registros × 3 perguntas num request só):

```json
{"state": {"goal": "...", "policy": {"manter": "...", "arquivar": "...", "duplicata": "..."},
           "records": {"docs/x.md": {"dias_sem_leitura": 22, "referencias_em_codigo": []}}},
 "questions": {"x_destino": {"type": "choice", "instructions": "Avalie APENAS state.records['docs/x.md']...",
                             "criteria": {"manter": "...", "arquivar": "...", "duplicata": "...", "incerto": "..."}}}}
```

Regras que a skill fixa: perguntas do mesmo request **não leem a resposta uma da outra**; registros relacionados podem ir no mesmo lote, registros grandes ou sem relação pedem requests separados; para muitos registros, o host faz pool com limite, respeitando rate limit e orçamento (`SKILL.md:71-93`, `references/context-and-throughput.md:34-62`). Teto: listagem de **32k tokens** no OpenRouter, **64k** total na TypeSafe — manter conservador.

Validei o formato com um request real de faxina (2 docs, 3 perguntas, 2.992 bytes ≈ 750 tokens): `--dry-run` saiu **exit 0**, sem erro.

### Tipo de pergunta certo — e uma premissa furada

- **`choice`** é o certo pra manter/arquivar/duplicata: 2 a 255 opções nomeadas, resposta com `choice` + `probabilities` + `confidence` (`api.md:75`). Sempre incluir uma saída de abstenção (`incerto`, `insufficient_evidence`, `defer`) — o wrapper trata certos rótulos como revisão automática (`jev.py:16-17`).
- **`noul`** pra "a evidência basta?" (binário), **`score`** pra grau de confiança (2–10 níveis ordenados).

> [!WARNING] **`reason` não existe na resposta do Jev.**
> A resposta de um `choice` é `type`, `choice`, `probabilities`, `confidence` — e nada mais (`api.md:75-79`, `jev.py:161-172`). Não há campo de justificativa, e o Jev não gera prosa. O "parecer do Jev" que o Rica vai ler **não sai do Jev**: ou a Tara monta o texto a partir das probabilidades, ou entra uma segunda pergunta (`score`/`choice` sobre o motivo) — que também devolve rótulo, não frase. Campo `reason` só existe no modo `agent_simulation`, que é quando o próprio agente responde no lugar do Jev (`SKILL.md:44-48`).

### Custo

`typesafe/jev-1.13` (lançado 18/09/2026) custa **US$ 0,042 por milhão de tokens de entrada, saída grátis**, contexto listado de 32k (`api.md:94`). Uso real vem em `usage` (com `cost`) — preservar o número devolvido em vez de estimar.

Uma faxina de 30 docs com ~400 tokens de contexto cada ≈ 12k tokens de entrada ≈ **US$ 0,0005** por rodada semanal. Irrelevante. O gargalo não é preço, é o teto de contexto por request — daí lotear.

### Chave: existe, mas com outro nome

- **Não está em nenhum `.env`**: `grep -c OPENROUTER_API_KEY` deu 0 em `ze-shared/.env`, `pavan/.env`, `tara/.env`, `canario/.env` (arquivo nem existe) e `grupo_borges/apps/api/.env`. Também 0 no ambiente dos processos de agente, em `~/.bashrc`, `~/.profile`, `/etc/environment`, `~/.claude/settings.json`. O `subir-frota.sh` não exporta.
- **Está no vault.** `ze-shared/vault/vault.gpg` (aberto com `--passphrase-file .vault-key`, a receita do `subir-frota.sh:394`), **linha 986**, seção `OPENROUTER`:

```
OPENROUTER
────────────────────────────
  Modelo: qwen/qwen3.6-plus:free
  API Key: sk-or-«valor mascarado»
```

Uma única linha no vault inteiro (1.353 linhas) com prefixo `sk-or-`. **O rótulo é `OPENROUTER`, não `OPENROUTER_API_KEY`** — quem procurar pelo nome exato da variável conclui que a chave não existe, e conclui errado. O `jev.py` lê exatamente `OPENROUTER_API_KEY` do ambiente (`jev.py:101`), então o script da faxina precisa decifrar o vault e exportar com esse nome.

⚠️ **Risco não verificado:** a nota do vault associa essa chave ao modelo **gratuito** `qwen/qwen3.6-plus:free` — pode ser conta sem crédito. `typesafe/jev-1.13` é pago; sem saldo o erro é HTTP 402 (`jev.py:114-118`, sem retry). Não testei chamada paga pra não gastar sem autorização. Vale um teste de 1 pergunta antes de desenhar o fluxo em cima disso.

Há também `TYPESAFE_API_KEY` no vault (linha 1349, conta `ricardo.incasa@gmail.com`, criada 21/09/2026, uso anotado "plugin winnow"). A rota OpenRouter **não** precisa dela (`api.md:13`), e o `jev.py` rejeita qualquer endpoint que não seja os dois documentados (`jev.py:98-99`).

---

## 3. `git mv` + commit sem arrastar o índice de outro agente

**Testado de verdade**, não deduzido: repo temporário com um arquivo que "outro agente" tinha deixado staged, mais um `git mv`:

```
$ git status --short            # antes
R  docs/velho.md -> arquivo/novo.md
M  docs/decoy.md                # este é o de OUTRO agente

$ git commit -q -m "faxina: arquiva velho" -- docs/velho.md arquivo/novo.md

$ git show --name-status HEAD
R100    docs/velho.md   arquivo/novo.md

$ git status --short            # depois
M  docs/decoy.md                # segue staged, intacto
```

O commit registrou o rename como `R100` e **não tocou** no staged alheio, que continuou no índice pra quem o pôs lá.

Base oficial (doc oficial do git, [git-scm.com/docs/git-commit](https://git-scm.com/docs/git-commit), lido 23/09/2026):

> `--only` — Make a commit by taking the updated working tree contents of the paths specified on the command line, **disregarding any contents that have been staged for other paths**.

> When _&lt;pathspec&gt;_ is given on the command line, commit the contents of the files that match the pathspec **without recording the changes already added to the index**. The contents of these files are also staged for the next commit on top of what have been staged before.

Notas para o script:

- **A doc oficial NÃO documenta rename nem deleção sob pathspec** — o comportamento acima é medição, não citação. Antes de confiar em deleção pura (arquivar mexendo em `git rm`), repetir o teste.
- **Nada de `git add` no script.** Índice é um só, compartilhado pelas 7 sessões (`ze-shared/AGENTS.md`, seção Git). `git mv` já escreve a renomeação no índice, então nem `add` nem `-A` são necessários — e o pathspec no commit é a única trava que impede levar o staged alheio.
- Os caminhos precisam "já ser conhecidos do Git"; após `git mv` o caminho novo está no índice, então o requisito é atendido.
- Efeito colateral a lembrar: o pathspec toma o **conteúdo da árvore de trabalho** dos caminhos listados. Se outro agente editar o arquivo entre o `mv` e o commit, entra a versão de quem commitou — daí a janela curta e o `flock` do item 4.
- `git commit --dry-run` com os mesmos argumentos mostra o que entraria, antes de entrar.

---

## 4. Agendamento semanal

**A casa usa linha de crontab** (`ze-shared/.claude/skills/cron-best-practices/SKILL.md:6-38`), com o pacote de sempre: `flock` no topo, state e log em `~/.local/state/<nome>` (nunca `/tmp`, que é limpo no boot), write atômico via `tmp + mv`, `curl` com `--max-time`, rotação de log no topo.

Fuso vem de `CRON_TZ=America/Sao_Paulo` na própria crontab — já em uso hoje:

```
CRON_TZ=America/Sao_Paulo
57 8 28 9 * /home/clawd/repos/ze_claude/pavan/scripts/winnow_check_semana.sh
```

Sem essa linha, o agendador interpreta em UTC (a máquina é `Etc/UTC`) e "8h" dispara às 5h.

**`systemd-run --on-calendar` não serve aqui**: é pra disparo único, mora em `/run` (tmpfs) e **não sobrevive a reboot** (`SKILL.md:67-94`). O `at` não existe na Oracle e não vai ser instalado.

**Precedente direto e mais completo:** `miga_dani/scripts/faxina-caderno.sh` — faxina semanal que já roda segundas 8h com retry às 10h e 15h (`0 8,10,15 * * 1` no crontab), state `YYYY-Www` pra não rodar duas vezes na mesma semana, `flock`, state dir XDG e log truncado em 1MB. Copiar essa estrutura em vez de inventar.

E o detalhe que vale mais que o agendamento: **aquele script não faxina nada — ele acorda o agente.** O comentário no topo diz por quê: *"Julgamento (o que guardar, o que podar) é trabalho de agente, não de bash"*. A divisão certa pra Faxina é a mesma: cron + `flock` só disparam o pipeline; o Jev julga; o Rica decide na tela; o git executa.

---

## Premissas furadas e pontos cegos

1. **`reason` no Jev não existe** (item 2). O parecer que o Rica lê tem que ser montado fora do Jev.
2. **A chave existe no vault, com rótulo `OPENROUTER`** — buscar por `OPENROUTER_API_KEY` não acha. E pode não ter crédito pro modelo pago.
3. **O contador de leitura é cego em três frentes**: leitura via Bash (`cat`/`grep`, medido), leitura por `@include` do CLAUDE.md e por prompt de sistema (não passam por tool), e MCP resource read. "Ninguém leu em 20 dias" pode ser falso positivo de um doc que é lido toda semana por `grep`.
4. **Skill tem dois canais de leitura**: a tool `Skill` (dá `tool_input.skill`) e o `Read` direto no `SKILL.md` (dá `file_path`). O contador precisa somar os dois, senão a skill parece morta.
5. **Cobertura do hook**: global pega a frota inteira porque todo agente roda como `clawd` — mas **sessão em nuvem não lê o settings global**, só o do repo. Se a faxina contar só o global, ela lê "ninguém leu" de novo.
6. **Premissa que se confirmou**: hook **pega** Skill, sim (medido). O furo não era esse.

---

*Arquivo escrito a pedido do Pavan (ordem do Rica, 23/09/2026). Não commitado.*
