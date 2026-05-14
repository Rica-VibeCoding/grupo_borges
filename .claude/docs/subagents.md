# Subagents (Agent tool) — Claude Code

> Síntese acionável em pt-BR. Fonte oficial: [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents). Última pesquisa: 2026-05-09.

## Resumo executivo

- **Subagent = janela de contexto isolada** com system prompt próprio, tools próprias e (opcional) modelo próprio. Volta só o resumo final pra conversa principal — economia de contexto é o ganho número 1.
- **Definição declarativa**: arquivo `.md` com YAML frontmatter em `.claude/agents/` (projeto) ou `~/.claude/agents/` (user). Formato simples — `name`, `description`, `tools`, `model` + corpo Markdown como system prompt.
- **Modelo por subagent**: dá pra rodar Opus principal e delegar pra Haiku (ex: `Explore` built-in já é Haiku). Resolução: env `CLAUDE_CODE_SUBAGENT_MODEL` > parâmetro de invocação > frontmatter > sessão pai.
- **Paralelismo**: múltiplas chamadas `Agent` no mesmo turno rodam concorrentemente. Foreground bloqueia conversa; background roda concorrente (precisa pré-aprovar permissões).
- **Limite duro**: subagent **não pode spawnar outro subagent**. Pra delegação aninhada, encadear da conversa principal ou usar [agent teams](https://code.claude.com/docs/en/agent-teams).

## O que é

Subagent é um worker especializado que o Claude principal delega quando o pedido bate com a `description` dele. Roda em **contexto isolado** — não vê histórico do pai, não polui o contexto do pai. Quando termina, devolve só um sumário ([source](https://code.claude.com/docs/en/sub-agents)).

Built-in disponíveis: **Explore** (Haiku, read-only, busca em código), **Plan** (read-only durante plan mode), **general-purpose** (todas as tools, multi-step), **statusline-setup**, **claude-code-guide**. Built-ins são chamados automaticamente pelo Claude conforme o pedido.

Útil pra: (a) operações verbosas — rodar testes, ler logs, varrer 50 arquivos —, (b) restringir tools por segurança (ex: read-only validator), (c) rotear pra modelo barato (Haiku pra pesquisa), (d) reusar prompt especializado entre projetos.

## Anatomia de um subagent custom

Arquivo em `.claude/agents/<nome>.md` (escopo projeto, vai pro git) ou `~/.claude/agents/<nome>.md` (user-level):

```markdown
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code for quality, security, maintainability. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a senior code reviewer. When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Provide feedback by priority (Critical / Warning / Suggestion)
```

**Invocação** (3 padrões, do mais flexível pro mais rígido):
- **Linguagem natural** — "Use the code-reviewer agent to..." (Claude decide)
- **@-mention** — `@"code-reviewer (agent)" review auth changes` (garantido)
- **Sessão inteira** — `claude --agent code-reviewer` (system prompt do subagent vira o da sessão)

Após editar arquivo no disco: **reiniciar sessão** pra carregar (a interface `/agents` aplica imediato) ([source](https://code.claude.com/docs/en/sub-agents)).

## Override de modelo

Campo `model` no frontmatter aceita: `sonnet`, `opus`, `haiku`, ID completo (ex: `claude-haiku-4-5-20251001`), ou `inherit`. Default é `inherit` — segue o modelo da sessão pai.

```yaml
---
name: cheap-researcher
description: Pesquisa documentação e retorna resumo
model: haiku
tools: WebFetch, WebSearch, Read
---
```

Resolução em ordem: env `CLAUDE_CODE_SUBAGENT_MODEL` → parâmetro de invocação → frontmatter → modelo da sessão pai ([source](https://code.claude.com/docs/en/sub-agents#choose-a-model)).

## Paralelismo

Pra disparar N subagents em paralelo, fazer N chamadas `Agent` **no mesmo turno** (mesmo bloco de tool calls). O Claude principal aguarda todos e sintetiza. Exemplo de prompt: `Research the auth, db, and API modules in parallel using separate subagents` ([source](https://code.claude.com/docs/en/sub-agents#run-parallel-research)).

**Foreground vs background**: foreground bloqueia a conversa principal e passa permission prompts pro usuário. Background roda concorrente — exige **pré-aprovação de tools** antes de spawnar; se precisar de tool não pré-aprovada, falha em silêncio. Ctrl+B faz background em runtime, ou setar `background: true` no frontmatter.

## Isolamento de contexto

- **Subagent não vê histórico do pai**. Recebe só o system prompt definido no corpo do `.md` + ambiente básico (cwd).
- **Pai não vê tool calls do subagent**. Recebe só o resultado final que o subagent devolver.
- **Transcript persistente** em `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl` — sobrevive a compactação do pai.
- **`isolation: worktree`** no frontmatter cria git worktree temporário pro subagent — edits ficam isolados, deletado se subagent não modificou nada ([source](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields)).

**Fork** (experimental, `CLAUDE_CODE_FORK_SUBAGENT=1`) — exceção: herda o contexto inteiro do pai (system prompt + history). Reusa prompt cache do pai → mais barato. Útil quando o subagent precisaria de muito briefing pra ser útil ([source](https://code.claude.com/docs/en/sub-agents#fork-the-current-conversation)).

## Quando usar (e quando NÃO usar)

**Usar subagent quando:**
- Output verboso (testes, logs, varredura) que não precisa virar contexto principal
- Restrição dura de tools (ex: read-only validator com `tools: Read, Grep, Glob`)
- Roteamento pra modelo barato (Haiku pra pesquisa repetitiva)
- Tarefa auto-contida com retorno = sumário
- Operação paralela em N fontes independentes

**Manter na conversa principal quando:**
- Iteração frequente / refinamento back-and-forth
- Múltiplas fases compartilham contexto (planning → impl → testes)
- Mudança rápida e direta (latência importa — subagent sobe do zero)
- A resposta vai informar a próxima decisão imediata

Pra perguntas curtas que não precisam ficar no histórico, usar `/btw` (overlay descartável, sem tools).

## ❌ Anti-padrões

- ❌ **Subagent spawnando subagent** — proibido. Usar [agent teams](https://code.claude.com/docs/en/agent-teams) ou encadear da principal.
- ❌ **Description vaga** — Claude usa `description` pra decidir delegar. "Code helper" perde pra "Reviews code immediately after edits, focusing on security and quality".
- ❌ **Editar arquivo no disco e esperar load automático** — só `/agents` aplica imediato; edição manual exige restart.
- ❌ **`bypassPermissions` sem necessidade** — pula tudo, inclusive writes em `.git`/`.claude`. Reservar pra automação controlada.
- ❌ **Background sem pré-aprovar permissões** — qualquer tool não pré-aprovada falha em silêncio e quebra o fluxo.
- ❌ **Plugin subagents com `hooks`/`mcpServers`/`permissionMode`** — esses campos são **ignorados** em subagents vindos de plugin (segurança).
- ❌ **Listar `Skill` em `tools` pra preload** — usar campo `skills:` que injeta o conteúdo da skill, não o tool descriptor.
- ❌ **Despejar muitos resultados detalhados de N subagents paralelos no pai** — cada retorno vira contexto. Pedir explicitamente "report only X" ([source](https://code.claude.com/docs/en/sub-agents#run-parallel-research)).

## Aplicação no grupo_borges

- **Daniel-research (esta sessão)** já é caso de uso clássico: paralelo ao Daniel principal, modelo Haiku, escopo restrito, retorna doc curado. Justifica formalizar como subagent custom em `.claude/agents/daniel-research.md` com `tools: WebFetch, WebSearch, Read, Write, Bash, Grep, Glob` e `model: haiku` — assim qualquer Zé pode invocar com `@daniel-research`.
- **Mapping pra arquitetura do cockpit**: cada "instância" da UI (`daniel-1`, `daniel-2`) pode na prática ser uma sessão Claude Code separada com `--agent <slug>` apontando pro arquivo do agente. Memória dividida via `memory: project` (ler/escrever em `.claude/agent-memory/<slug>/`) — bate com a regra "só instância principal escreve memória persistente".
- **Validators read-only** (ex: linter de SQL antes de qualquer query no Supabase ze) cabem perfeitamente como subagent com `tools: Bash` + `PreToolUse` hook bloqueando `INSERT|UPDATE|DELETE`. Padrão pra qualquer agente que precisa rodar query mas não pode escrever.

## Fontes

- [Create custom subagents (oficial)](https://code.claude.com/docs/en/sub-agents) — referência completa de frontmatter, modelo, tools, hooks, fork
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — quando delegar pra subagent vs main, fan-out, parallel sessions
- [Agent teams](https://code.claude.com/docs/en/agent-teams) — alternativa quando precisa N agentes coordenados em sessões separadas (caso o cockpit cresça além do single-session)
- [Permission modes](https://code.claude.com/docs/en/permission-modes) — referência pro campo `permissionMode` (default, acceptEdits, auto, dontAsk, bypassPermissions, plan)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference#agents) — distribuição via plugin (com restrições de segurança)
