# MATRIZ DE ESFORÇO POR MOTOR — como cada plataforma da frota pensa "esforço" (09/08/2026)

> Pedido do Rica (09/08): levantar, com fonte, para cada motor da frota — Claude Code,
> Codex, Kimi K3 e DeepSeek via OpenCode Go — os níveis reais de esforço, como se aplica,
> se pega em sessão viva, onde persiste e como se lê o valor efetivo. A lista do §4 é o que
> vira a fase 2 da refatoração: **cada motor com níveis e mecanismo próprios**, em vez do
> tratamento desencontrado de hoje.
>
> Régua: fonte citada (doc oficial, código do produto, ou comando que eu rodei e o que ele
> respondeu) ou marcado como **não confirmado**. Nada inferido de graça.
>
> Frente do Daniel e da Tara ficam paradas aqui: este documento é pesquisa, sem mudança de
> código. Versões testadas: `claude` 2.1.226, `codex-cli` 0.146.0.

## 1. Em uma frase

O "seletor de esforço" do cockpit não é um knob único: **cada motor tem níveis, mecanismo de
aplicação e fonte de verdade próprios** — e hoje o cockpit trata três motores como se fossem
um (um arquivo `~/.claude/settings.json` compartilhado) e dois como "persistência de próxima
execução", sem nunca ler o valor que a sessão está usando de fato.

## 2. A matriz — as 5 perguntas do Rica, por motor

| Motor (agentes) | Níveis reais | Como se aplica | Sessão viva? | Onde persiste | Como se lê o efetivo |
|---|---|---|---|---|---|
| **Claude Code** (Daniel, Felipe, Barsi, Lucas, Vinicius, Pavan) | `low, medium, high, xhigh, max` por modelo; `auto` = reset pro default (não é nível de raciocínio) | `/effort <nível>` (aplica + grava default); `CLAUDE_CODE_EFFORT_LEVEL` no boot; `--effort`; `effortLevel` no settings.json | **Sim** — `/effort` aplica na hora (low/medium/high/xhigh) e persiste; `max` só na sessão | `effortLevel` no settings.json do escopo em que o `/effort` rodou. **Hoje: um único `~/.claude/settings.json`, `effortLevel: xhigh`, compartilhado por todos** | statusline → `/tmp/cc-status-<sid>.json` → `effort.level` (reflete a sessão viva, inclusive mudanças mid-session). O painel lê o settings.json, não isto |
| **Codex** (Tara, `gpt-5.6-*`) | `low, medium, high, xhigh, max` (model-dependent; docs também citam `none`/`minimal`) | `-c model_reasoning_effort=<v>` por invocação; `model_reasoning_effort` no `~/.codex/config.toml`. **Não há toggle em runtime** | N/A — `codex exec` é processo one-shot por delegação; a flag vale naquela execução ("próximo boot" = próxima delegação) | config.toml (default, hoje `max`); `agent_state.codex_reasoning_effort` (o pedido do cockpit); `threads.reasoning_effort` (o que a thread rodou) | `~/.codex/state_5.sqlite` → `threads.reasoning_effort` (já lido pelo `codex_reader`, mas o painel usa `agent_state`) |
| **Kimi K3** (Hiro) | canônico `low, high, max`; endpoint aceita aliases (`max/ultra/xhigh`→max, `high/medium`→high, `low/minimum/light`→low) | `CLAUDE_CODE_EFFORT_LEVEL` no boot (lido pelo CLI claude) → adaptive thinking `output_config.effort` no request. `/effort` em sessão viva também vale (mesmo CLI) | env var = só boot; `/effort` = viva (não é dirigido pelo cockpit hoje) | `agent_state.kimi_reasoning_effort` → `subir_hiro` exporta a env var no boot. Quando vazio, o CLI cai no `settings.json` global (vazamento) | statusline `effort.level` (o que o CLI enviou). Mapa Kimi: `xhigh`→max, `high`/`medium`→high, `low`→low |
| **DeepSeek V4-Flash via OpenCode Go** (Canário) | `low, high, xhigh, max` + `none` (off). Para o flash: `low`→low, `high`→high, `xhigh`→high, `max`→max. É **dica**, não knob exato | o CLI claude lê `effortLevel` do settings global no boot (xhigh) → `output_config.effort` → `https://opencode.ai/zen/go/v1/messages`. `CLAUDE_CODE_EFFORT_LEVEL` **não** é exportado no boot | igual CC (mesmo CLI) — `/effort` aplicaria; não é dirigido | **nada próprio** — herda o `settings.json` global (vazamento); `agent_state.canarinho` vazio | statusline `effort.level` (o que o CLI crê; hoje xhigh → DeepSeek aplica **high** no flash). Se o OpenCode Go repassa o campo: **não confirmado** |

## 3. Detalhe por motor

### 3.1 Claude Code

- **Níveis.** A doc de model-config lista por modelo: Fable 5 / Opus 5 / Sonnet 5 / Opus 4.8 /
  Opus 4.7 → `low, medium, high, xhigh, max` (a frota usa Opus 4.8/5). Default da API: `high`
  ("produces exactly the same behavior as omitting the effort parameter"). `auto` é **sentinela
  de reset pro default do modelo** (válido em `/effort auto` e em `CLAUDE_CODE_EFFORT_LEVEL=auto`),
  **não** é nível de raciocínio. `ultracode` é modo do CC (envia `xhigh` + orquestração),
  session-only. Fonte: https://code.claude.com/docs/en/model-config.md
- **Aplicar.** `/effort <low|medium|high|xhigh>` muda a sessão na hora **e** grava
  `effortLevel` como default das próximas. Provado na sessão `lucas` (respondeu "Set effort
  level to high (saved as your default for new sessions)" e a statusline mudou). `/effort max`
  vale só na sessão atual. Precedência documentada: `CLAUDE_CODE_EFFORT_LEVEL` (env) >
  `/effort`/settings > default do modelo. Fonte: https://code.claude.com/docs/en/settings.md
- **Sessão viva?** Sim para `/effort`. Env var e settings só no boot.
- **Onde persiste.** `effortLevel` em qualquer escopo de settings (local > projeto > user).
  **Verificado na máquina:** nenhum projeto da frota tem `effortLevel`; o único é o global
  `~/.claude/settings.json` → `effortLevel: xhigh`. Ou seja, o seletor de um agente hoje
  escreve **o mesmo arquivo que todos os 6 leem** — e o Canário também.
- **Ler o efetivo.** A statusline do CC expõe `effort.level` = **valor da sessão viva, incluindo
  mudanças mid-session** ("Absent when the current model does not support the effort
  parameter"). O cockpit **já lê** esse arquivo (`_load_cc_status`, `agents.py:697`) para
  contexto/quotas — mas para effort lê o `settings.json` global (`_read_agent_effort`,
  `agents.py:776`). Fonte: https://code.claude.com/docs/en/statusline.md
- **Transmissão ao modelo.** Vira `output_config.effort` no corpo Anthropic Messages. Com
  `ANTHROPIC_BASE_URL` customizado, o CC só envia se reconhecer o model ID como effort-capable
  (padrões conhecidos) — para IDs custom, a doc aponta `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1`
  para forçar. A statusline do k3 e do deepseek-reporta effort, então o CLI os trata como
  capazes. Fonte: https://code.claude.com/docs/en/env-vars.md e llm-gateway-protocol.md

**Snapshot real (09/08 15:33, statusline das sessões vivas):** 6× `claude-opus-5` em `xhigh`,
1× `claude-opus-5` em `max`, `k3` (Hiro) em `xhigh`, `deepseek-v4-flash[1m]` (Canário) em
`xhigh`. O painel mostra `xhigh` para todos (o settings global) — o agente em `max` fica
invisível.

### 3.2 Codex (Tara)

- **Níveis.** A doc oficial da API aceita, por modelo, `none, minimal, low, medium, high,
  xhigh, max` (default `medium` quando omitido, em gpt-5.5/5.6). O CLI/API da OpenAI mapeia
  `model_reasoning_effort` pro parâmetro por-requisição. Fonte:
  https://developers.openai.com/api/docs/guides/reasoning
- **Aplicar.** `-c model_reasoning_effort=<v>` por invocação (o `tara-codex` injeta isso na
  próxima exec, `scripts/tara-codex:161-168`) ou `model_reasoning_effort` no `~/.codex/config.toml`.
  **Verificado no disco:** o config global está em `model_reasoning_effort = "max"`.
- **Sessão viva?** N/A. `codex exec` é um processo one-shot por delegação; não existe toggle
  em runtime. O painel persiste para a próxima execução — conceito certo para Codex, ao
  contrário dos CLIs claude.
- **Onde persiste.** Três lugares distintos: (a) config.toml (default global), (b)
  `agent_state.codex_reasoning_effort` (o pedido do cockpit), (c) `threads.reasoning_effort`
  em `~/.codex/state_5.sqlite` (o que a thread de fato rodou). **Verificado no DB:** threads
  reais com `max` (gpt-5.6-terra/luna), `high`, `low`, `medium`, `xhigh` (gpt-5.3-codex) e vazio
  (sem flag). **Prova de divergência:** `agent_state.tara.codex_reasoning_effort = high`, mas
  as threads atuais rodam `max` — o painel mostra `high`, a Tara pensa em `max`.
- **Ler o efetivo.** `state_5.sqlite → threads.reasoning_effort` da última thread. O
  `codex_reader` já expõe isso (`CodexThread.reasoning_effort`, `codex_reader.py:59`) e o
  `_build_codex_painel_contexto` usa `thread.model` — mas o **effort** do painel vem de
  `agent_state` (`_build_codex_painel_effort`, `agents.py:655`), ignorando o efetivo que já
  está na mão.

### 3.3 Kimi K3 (Hiro)

- **Níveis.** Canônico `low, high, max` (assinatura Kimi Code). O endpoint aceita aliases:
  `max`/`ultra`/`xhigh`→max, `high`/`medium`→high, `low`/`minimum`/`light`→low; desconhecido
  retorna 400. Default: `high` (managed). O comentário do código valida `low/high/max` via
  `GET api.kimi.com/coding/v1/models` (19/07, `agents.py:79-82`). K3 pensa sempre (não há modo
  sem thinking). Fonte: https://platform.kimi.ai/docs/guide/use-thinking-models
- **Aplicar.** `CLAUDE_CODE_EFFORT_LEVEL` no boot — o `subir_hiro` lê
  `kimi_reasoning_effort` do cockpit e exporta a env var antes de subir o CLI
  (`ze-shared/scripts/subir-frota.sh:141-153`). O CLI claude traduz em adaptive thinking
  (`thinking.type=adaptive` + `output_config.effort`) no request ao endpoint
  `api.kimi.com/coding/`.
- **Sessão viva?** A env var é de boot. Mas o `/effort` em sessão viva funciona no mesmo CLI —
  "vale no próximo boot" é **escolha de implementação do cockpit** (ele não dirige `/effort`),
  não limite do motor.
- **Onde persiste.** `agent_state.kimi_reasoning_effort`. **Vazamento verificado:** quando a
  env var não é setada (ou o valor persistido é inválido), o CLI cai no `settings.json` global
  (`effortLevel: xhigh`) — o `unset CLAUDE_CODE_EFFORT_LEVEL` do `subir_hiro` protege contra env
  var herdada, **não** contra o default do arquivo. **Prova:** `agent_state.hiro.kimi_reasoning_effort
  = high`, mas a sessão viva do k3 reporta `xhigh` na statusline → Kimi mapeia `xhigh`→max.
- **Ler o efetivo.** statusline `effort.level` (o que o CLI enviou). O mapa Kimi (xhigh→max,
  medium/high→high, low→low) é o que o endpoint aplica.

### 3.4 DeepSeek V4-Flash via OpenCode Go (Canário)

- **Níveis.** Doc oficial DeepSeek: `low, high, xhigh, max` + `none` (off, via Anthropic
  `reasoning.effort`); default thinking on, esforço default `high`. Para `deepseek-v4-flash`
  (o modelo do Canário): `low`→low, `high`→high, `xhigh`→**high**, `max`→max. **Effort é dica
  mapeada pelo modelo**, não knob exato. Fonte: https://api-docs.deepseek.com/guides/thinking_mode
- **Aplicar.** O `subir_canario` sobe o CLI claude com `ANTHROPIC_BASE_URL=https://opencode.ai/zen/go`
  e `ANTHROPIC_MODEL=deepseek-v4-flash[1m]`, **sem** `CLAUDE_CODE_EFFORT_LEVEL`
  (`subir-frota.sh:170-205`). O CLI lê o `effortLevel` do settings global (xhigh) no boot e
  envia `output_config.effort`. Statusline da sessão atual reporta `effort.level: xhigh`.
- **Sessão viva?** Igual CC (mesmo CLI) — `/effort` aplicaria; não é dirigido.
- **Onde persiste.** Nada próprio. Herda o settings global (mesmo vazamento dos 6 CC).
  `agent_state.canarinho` está vazio e o `agents.yaml:185-193` registra que o canarinho **não
  tem `model_family`** — o backend o trata como Anthropic (mesmo gotcha que o Kimi teve antes
  do DS-69).
- **Ler o efetivo.** statusline `effort.level` diz o que o CLI crê (xhigh). O que o DeepSeek
  aplica no flash: `xhigh`→**high** — ou seja, o "extra alto" que o painel mostraria é
  efetivamente `high` no modelo. Para esforço `max` real seria preciso `max`.
- **Não confirmado:** se o endpoint OpenCode Go repassa/mapeia o `output_config.effort` pro
  `reasoning_effort` do DeepSeek. A doc oficial de providers do OpenCode Zen não menciona
  `/v1/messages` nem effort; a evidência de mapeamento vem de bridges da comunidade e relato
  de fórum. Também não confirmado: o plano "Go" aplica os mesmos níveis da doc DeepSeek direct.

## 4. Onde o cockpit assume errado hoje (a lista da fase 2)

1. **Um knob para todos.** `PATCH /{slug}/effort` escreve `effortLevel` no `~/.claude/settings.json`
   global (`_write_agent_effort`, `agents.py:789`) — muda o default de **todos** os CLIs claude
   da máquina (6 CC + Canário + fallback do Hiro). Não há escopo por agente.
2. **Lê o pedido, não o valor.** Para CC lê o settings (default); para Codex/Kimi lê o
   `agent_state` (o que foi pedido). O efetivo vivo existe e está à mão: `cc-status*.json`
   `effort.level` (CC/Kimi/Canário) e `threads.reasoning_effort` (Codex). `session_may_diverge`
   é admitido na resposta mas o painel **nem tenta** a fonte viva.
3. **Não dirige `/effort` ao vivo.** O cockpit já dirige `/model` via tmux para CC
   (`agents.py:3109`); o mesmo mecanismo serviria para `/effort <v>` (aplica na hora + persiste
   por sessão, sem tocar no arquivo global). Em vez disso escreve o arquivo boot-only e vazado.
4. **Codex: permite `xhigh` que o wrapper ignora.** `_CODEX_PAINEL_ALLOWED_EFFORTS` tem `xhigh`
   (`agents.py:78`), mas o `tara-codex` só injeta `^(low|medium|high)$`
   (`scripts/tara-codex:164`). Persistir `xhigh` → o painel mostra, a próxima exec **não recebe
   flag nenhuma** (no-op silencioso).
5. **Codex: proíbe `max` que é o real.** O default do config.toml é `max` e as threads rodam
   `max`; o painel rejeita `max` (422) e não exibe o efetivo. A Tara pensa em `max` enquanto o
   card diz `high` (ou nada).
6. **Kimi: efetivo pode divergir do persistido.** `kimi_reasoning_effort=high` persistido, sessão
   viva a `xhigh` (→ Kimi max). O painel não representa `xhigh`/`max` para Kimi (allowed só
   `low/high/max`) e ignora o vazamento do settings global como fallback quando a env var não é
   setada.
7. **"Vale no próximo boot" é limitação do cockpit, não do motor.** O CLI claude lê env var no
   boot, mas `/effort` em sessão viva funciona (aplica + persiste). O cockpit poderia dirigir
   `/effort` por tmux para Hiro/Canário como faz `/model`; "só boot" é escolha de implementação.
8. **`auto` não representável.** É um estado real do CLI (`/effort auto`, env var), mas não está
   no `AgentPainelEffortValue` (`agents.py:104`), nem no `_AGENT_PAINEL_ALLOWED_EFFORTS`, nem no
   mapa `ESFORCO` do front (`motor.ts:84`). Um agente em `auto` não tem como aparecer no painel.
9. **`max` gravado no settings é questionável.** A doc do CC diz que o schema do `settings.json`
   aceita só `low|medium|high|xhigh` (issue anthropics/claude-code#50670); `max` é session-only
   (ou via env var). `_AGENT_PAINEL_ALLOWED_EFFORTS` inclui `max` e `_write_agent_effort` o grava
   no arquivo — persistência não confirmada pelo motor.
10. **Canário sem `model_family`.** `agents.yaml:185-193` marca o canarinho sem família; o backend
    o trata como Anthropic (escala de 5 níveis + escrita no settings global). O gotcha que o Kimi
    já teve (DS-69) está aberto para o canarinho.
11. **Codex não é "sessão viva".** O `session_may_diverge` para Codex diz respeito à **thread**
    (efetivo em `threads.reasoning_effort`), não a uma sessão tmux; o conceito de "mudar em
    runtime" não se aplica igual. A fase 2 não pode tratar os 4 motores com a mesma UX.

## 5. Não consegui confirmar

- **OpenCode Zen/Go repassando o effort ao DeepSeek.** Doc oficial de providers não menciona
  `/v1/messages` nem effort; o mapeamento `output_config.effort`→`reasoning_effort` é inferido de
  bridges da comunidade e relato de fórum. Não testei o wire do canário.
- **`ultra` como nível de Codex.** Aparece em docs de terceiros para `sol`/`terra`; a doc oficial
  da OpenAI (`reasoning` guide) não o lista. Não confirmado.
- **`/effort` em sessão viva não-Anthropic.** Não testei numa sessão Kimi/DeepSeek (não mexi na
  sessão do Hiro nem na minha). O mecanismo do CLI é o mesmo, então é hipótese com fundamento,
  não prova.
- **Origem da env var `CLAUDE_EFFORT=xhigh`** observada no env do canário (não é a
  `CLAUDE_CODE_EFFORT_LEVEL`). Aparenta ser exposição interna do CLI a shells filhos; não
  documentada — não confiar como fonte de leitura.

## 6. Método e fontes

**Comandos que rodei e o que responderam:**
- `cat ~/.codex/config.toml` → `model = "gpt-5.6-luna"`, `model_reasoning_effort = "max"`.
- `sqlite3 "file:$HOME/.codex/state_5.sqlite?mode=ro" "SELECT ... FROM threads ..."` → valores
  `low/medium/high/xhigh/max` e vazio em threads reais; a thread ativa de hoje
  (`019fe7c0`, gpt-5.6-luna) com `reasoning_effort=high`.
- `sqlite3 grupo_borges.db "SELECT slug, codex_reasoning_effort, kimi_reasoning_effort FROM agent_state"`
  → `tara|high|`, `hiro||high`, CC agents e canarinho vazios.
- `cat ~/.claude/settings.json` → `effortLevel: "xhigh"` (única fonte dos 6 CC + Canário).
- `grep effortLevel <projetos>/ze_claude/*/.claude/settings*.json` → nenhum projeto tem.
- `/tmp/cc-status-<sid>.json` das sessões vivas → 6× opus-5 xhigh, 1× opus-5 max, k3 xhigh,
  deepseek xhigh (15:33).
- `claude --version` → 2.1.226 · `codex --version` → codex-cli 0.146.0.
- `env | grep ...` no canário → `ANTHROPIC_BASE_URL=https://opencode.ai/zen/go`,
  `ANTHROPIC_MODEL=deepseek-v4-flash[1m]`, sem `CLAUDE_CODE_EFFORT_LEVEL`.

**Docs oficiais:** CC model-config / settings / statusline / env-vars
(code.claude.com/docs), OpenAI reasoning guide (developers.openai.com), Kimi thinking models
(platform.kimi.ai), DeepSeek thinking mode (api-docs.deepseek.com).

**Código do produto:** `apps/api/routers/agents.py` (allowed lists, read/write, PATCHs),
`scripts/tara-codex` (injeção do effort), `apps/api/services/codex_reader.py`
(`CodexThread.reasoning_effort`), `apps/api/services/tmux_driver.py` (mapa de modelos),
`ze-shared/scripts/subir-frota.sh` (`subir_hiro`/`subir_canario`), `agents.yaml`
(canarinho sem model_family), `apps/cockpit/components/shell/motor.ts` (escala do front).

**Fonte empírica de sessão viva:** prova do `/effort high` na sessão `lucas` (feita pelo Rica
antes desta pesquisa — "Set effort level to high (saved as your default for new sessions)" +
statusline mudou na hora).
