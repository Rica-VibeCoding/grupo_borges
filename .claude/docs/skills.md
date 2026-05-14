# Skills system — Claude Code

> Síntese acionável em pt-BR. Fontes: [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) + [Anthropic Engineering — Equipping agents with Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) + [agentskills.io](https://agentskills.io). Última pesquisa: 2026-05-09.

## Resumo executivo

- **Skill = pasta com `SKILL.md`** (YAML frontmatter + corpo Markdown). Conforma ao padrão aberto [agentskills.io](https://agentskills.io), portátil entre Claude.ai, Claude Code, Claude Agent SDK e Claude Developer Platform.
- **Progressive disclosure**: nome + description sempre em contexto (Nível 1, ~1.536 chars cap por skill); corpo completo só carrega quando invocado (Nível 2); arquivos de referência (`reference.md`, `examples.md`) só carregam por demanda explícita (Nível 3).
- **Invocação dupla**: usuário com `/skill-name` ou Claude automaticamente quando o pedido bate com `description`. Controlado por `disable-model-invocation` (só user) e `user-invocable: false` (só Claude).
- **Live change detection** — Claude Code observa `~/.claude/skills/`, `.claude/skills/`, e `.claude/skills/` em `--add-dir`. Adicionar/editar/remover **toma efeito na sessão atual**. Só **criar pasta de nível raiz nova** exige restart.
- **Slash commands em `.claude/commands/` foram unificados em skills**. Arquivos antigos continuam funcionando, mas skill com mesmo nome tem precedência.

## Anatomia de uma SKILL.md

```yaml
---
description: Summarize uncommitted changes and flag risky things. Use when the user asks what changed or wants a commit message.
allowed-tools: Bash(git *) Read
---

## Current changes

!`git diff HEAD`

## Instructions

Summarize the changes above in 2-3 bullet points, then list risks
(missing error handling, hardcoded values, tests to update). If the
diff is empty, say there are no uncommitted changes.

## Additional resources

- For complete API details, see [reference.md](reference.md)
- For usage examples, see [examples.md](examples.md)
```

A sintaxe `` !`<command>` `` é **dynamic context injection** — Claude Code roda o comando *antes* de mostrar a skill pro modelo, e substitui pela saída. Pra blocos multi-linha, fenced block iniciado com ` ```! `.

## Frontmatter — campos suportados

| Campo | Descrição |
|---|---|
| `name` | Display name. Default: nome do diretório. Lowercase + hyphens, max 64 chars. |
| `description` | Recomendado. O que faz e quando usar — Claude usa pra decidir invocar. **Cap de 1.536 chars combinado com `when_to_use`**. |
| `when_to_use` | Trigger phrases extras. Append no `description` na listagem. |
| `argument-hint` | Hint no autocomplete (ex: `[issue-number] [filename]`). |
| `arguments` | Nomes posicionais pra `$name` substitution (lista YAML ou string separada por espaço). |
| `disable-model-invocation` | `true` = só usuário invoca. Pra workflows com side effects (deploy, commit, send-email). |
| `user-invocable` | `false` = só Claude invoca. Pra background knowledge (não aparece em `/`). |
| `allowed-tools` | Tools que skill pode usar **sem prompt de permissão** enquanto ativa. |
| `model` | Override de modelo durante o turno (não persiste). Aceita `sonnet`/`opus`/`haiku`/`inherit`/ID completo. |
| `effort` | `low`/`medium`/`high`/`xhigh`/`max`. Override do effort da sessão. |
| `context` | `fork` = roda em subagent forkado. |
| `agent` | Tipo de subagent quando `context: fork` (`Explore`/`Plan`/`general-purpose`/custom). |
| `hooks` | Hooks com lifecycle da skill. |
| `paths` | Glob patterns pra ativar só com arquivos matching. |
| `shell` | `bash` (default) ou `powershell`. PowerShell exige `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`. |

**String substitutions disponíveis** no corpo: `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N` (shorthand), `$name` (se declarado em `arguments`), `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SKILL_DIR}` (path da skill — usar pra referenciar `scripts/` independente do cwd) ([source](https://code.claude.com/docs/en/skills)).

## Como o CC decide invocar

1. **Linguagem natural** — se pedido bate com `description`, Claude carrega o corpo da skill no turno (matching semântico). Reforçar com keywords que usuário usaria naturalmente: "review my diff", "what changed".
2. **`/skill-name`** — invocação explícita do usuário. Sempre carrega.
3. **Skills com `disable-model-invocation: true`** ficam fora do contexto (Claude nem sabe que existem) — só `/skill-name` funciona.
4. **Argumentos** — `/skill-name foo bar` injeta em `$ARGUMENTS` (= "foo bar"), `$0`/`$1` (posicional), ou `$name` (se declarado).

**Lifecycle da skill**: ao invocar, o conteúdo renderizado entra na conversa como **uma única mensagem** e fica até o fim da sessão. CC não relê o arquivo em turnos seguintes. Auto-compaction reanexa as 5K tokens iniciais de cada skill recente após sumarização (budget combinado de 25K tokens, mais recentes primeiro).

## Escopo (user vs project vs plugin)

| Escopo | Path | Aplica a |
|---|---|---|
| Enterprise | Managed settings | Toda a org |
| Personal | `~/.claude/skills/<name>/SKILL.md` | Todos seus projetos |
| Project | `.claude/skills/<name>/SKILL.md` | Esse projeto |
| Plugin | `<plugin>/skills/<name>/SKILL.md` | Onde plugin habilitado |

**Precedência** quando colidem: enterprise > personal > project. Plugin usa namespace `plugin-name:skill-name` — não conflita.

**Discovery em monorepo**: `packages/frontend/.claude/skills/` é descoberto automaticamente quando trabalhando em arquivos dentro de `packages/frontend/`.

## Convenção de pasta

```
my-skill/
├── SKILL.md           ← obrigatório, entry point
├── reference.md       ← detalhes — carregar sob demanda
├── examples.md        ← exemplos
├── assets/
│   └── template.html
└── scripts/
    └── helper.py      ← executável (não carregado, só rodado)
```

**Tip oficial**: manter `SKILL.md` **abaixo de 500 linhas**. Mover detalhes pra arquivos separados e referenciá-los no `SKILL.md`. Scripts vão em `scripts/` — usar `${CLAUDE_SKILL_DIR}/scripts/foo.py` pra chamar sem depender de cwd.

## agentskills.io — o padrão aberto

- Padrão publicado pela Anthropic em **dezembro 2025**, código aberto, busca **portabilidade cross-platform**.
- Plataformas suportadas: Claude.ai, Claude Code, Claude Agent SDK, Claude Developer Platform.
- Estrutura mínima padronizada: `SKILL.md` + frontmatter `name`/`description` obrigatórios. Recursos extra (allowed-tools, context: fork, hooks) são extensões do Claude Code que outras plataformas podem ou não suportar.
- Princípio central: **progressive disclosure** — agente carrega só o que precisa, quando precisa, na granularidade adequada (metadata → corpo → arquivos referenciados).

## Instalação programática

**Criar pasta + escrever `SKILL.md` basta** — live change detection pega na hora:

```bash
mkdir -p ~/.claude/skills/my-skill
cat > ~/.claude/skills/my-skill/SKILL.md <<'EOF'
---
description: ...
---
...
EOF
# pronto, /my-skill já funciona na sessão ativa
```

**Quando precisa restart**: só ao criar **diretório de nível raiz que não existia** quando a sessão começou (CC não tava observando). Se `~/.claude/skills/` já existia, nova subpasta entra hot.

**Visibilidade via settings (sem editar SKILL.md)**: `skillOverrides` em `.claude/settings.local.json`:

```json
{
  "skillOverrides": {
    "legacy-context": "name-only",  // só nome, sem description
    "deploy": "off"                  // escondida totalmente
  }
}
```

Estados: `"on"` (default) / `"name-only"` / `"user-invocable-only"` / `"off"`.

## Aplicação no grupo_borges

- **Listar skills por agente** = `os.listdir(<workspace>/.claude/skills/)` + parsear frontmatter de cada `SKILL.md`. Vai direto na aba "Skills" do modal do agente. Indexar `description`, `disable-model-invocation`, `model`, `allowed-tools`.
- **Distinguir shared vs local** = path da skill: se resolve dentro de `ze-shared/.claude/skills/<name>` (via symlink ou direto), badge "shared". Se está em `<workspace>/.claude/skills/<name>` direto, badge "local". Convenção do monorepo nosso: shared = canônico em `ze-shared/`, workspaces symlinkam (regra dura em `ze-shared/AGENTS.md`).
- **"Instalar skill" no UI** = duas operações: (a) shared = criar symlink relativo `ln -s ../../../ze-shared/.claude/skills/<name> <workspace>/.claude/skills/<name>` (POSIX) ou junction (Windows); (b) local = abrir editor com template `SKILL.md` minimal pré-preenchido.
- **"Desinstalar"** = remover symlink (não tocar a fonte) ou apagar pasta local.
- **Hot reload no UI** = quando criamos/removemos skill via API do cockpit, o agente já vê na próxima invocação (live change detection). Não precisa ping pra restart.
- **Editor de SKILL.md** com preview lado-a-lado (markdown-it-py) — fluxo natural do "editor de docs" mencionado na Fase 4 do plano.
- **Skills shared como source of truth** — UI deve recusar `Edit` em arquivo que está dentro de `ze-shared/` quando aberto via symlink (alerta "edita pela fonte canônica"). Reforça regra dura existente.

## ❌ Anti-padrões

- ❌ **Editar skill via symlink** — diff fica confuso, perde noção de "dono". Editar **na fonte** (`ze-shared/.claude/skills/<name>/SKILL.md`).
- ❌ **Copiar skill em vez de symlinkar** quando shared — duplica código, divergência inevitável. Symlink/junction sempre.
- ❌ **`SKILL.md` monolítico** com 1000 linhas — split em `reference.md`/`examples.md` referenciados.
- ❌ **`description` vaga** ("Helper for code") — mata matching automático. Incluir keywords naturais do user ("when user asks to refactor X", "use after editing files").
- ❌ **Workflow com side effects sem `disable-model-invocation: true`** — Claude pode acionar deploy sozinho. Sempre proteger commit/deploy/send.
- ❌ **`allowed-tools` muito largo** — concede tools sem prompt enquanto skill ativa. Skill commitada em projeto compartilhado pode auto-conceder Bash inteiro. Auditar antes de aceitar trust dialog.
- ❌ **Confiar que skill re-carrega** — não recarrega no mesmo turno. Se editar SKILL.md, **invocar de novo** pra pegar versão nova.
- ❌ **Instalar skill de fonte não confiável sem audit** — scripts em `scripts/` rodam com permissões da sessão. `allowed-tools` pode escalar privilégios.
- ❌ **`context: fork` em skill sem instruções** — só guidelines ("use these conventions") cai no subagent sem task acionável e retorna vazio.
- ❌ **Path hardcoded pra `scripts/`** — usar `${CLAUDE_SKILL_DIR}/scripts/foo.py`, não `~/.claude/skills/my-skill/scripts/foo.py` (quebra em plugin/project install).
- ❌ **`disableSkillShellExecution: true` sem motivo** — desliga `` !`...` ``, mata feature de injeção dinâmica. Útil só em managed settings com paranoia justificada.

## Fontes

- [Skills oficial](https://code.claude.com/docs/en/skills) — referência completa de frontmatter, lifecycle, scope, troubleshooting
- [Anthropic — Equipping agents with Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — modelo conceitual de progressive disclosure, distribuição
- [agentskills.io](https://agentskills.io) — padrão aberto, dez/2025
- [Subagents — preload skills](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents) — injetar skill no contexto de subagent custom
- [Hooks in skills and agents](https://code.claude.com/docs/en/hooks) — hooks scopados ao lifecycle da skill
