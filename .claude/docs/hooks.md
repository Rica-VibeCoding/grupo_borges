# Hooks lifecycle — Claude Code

> Síntese acionável em pt-BR. Fonte oficial: [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks). Última pesquisa: 2026-05-09.

## Resumo executivo

- **Hooks são determinísticos**, ao contrário de instruções em `CLAUDE.md` (advisory). Se algo *precisa* acontecer toda vez, é hook ([source](https://code.claude.com/docs/en/best-practices)).
- **Hoje são ~27 eventos** (não 12 — a doc cresceu). Cobrem desde startup (`SessionStart`) até cada tool call (`PreToolUse`/`PostToolUse`), prompts (`UserPromptSubmit`), subagents (`SubagentStart`/`SubagentStop`), compactação (`PreCompact`), config (`ConfigChange`), arquivos (`FileChanged`/`CwdChanged`), e fim de sessão (`SessionEnd`).
- **5 tipos de handler**: `command` (script local, JSON via stdin), `http` (POST com JSON body), `mcp_tool` (chama tool de servidor MCP), `prompt` (pergunta yes/no pra modelo barato), `agent` (subagent invocado como hook).
- **Bloqueio = exit code 2** (não 1!) ou JSON `{"decision":"block"}` / `{"hookSpecificOutput":{"permissionDecision":"deny"}}`. Stderr aparece pro Claude.
- **Configuração** em `~/.claude/settings.json` (user), `.claude/settings.json` (projeto, vai pro git), `.claude/settings.local.json` (gitignored), ou frontmatter de skill/agent (escopo do componente).

## Os principais eventos

| Evento | Quando dispara | Pode bloquear? | Matcher |
|---|---|---|---|
| `SessionStart` | Início ou retomada de sessão | ❌ | `startup`/`resume`/`clear`/`compact` |
| `Setup` | `--init-only` ou `-p --init` | ❌ | `init`/`maintenance` |
| `UserPromptSubmit` | Usuário envia prompt | ✅ | — |
| `UserPromptExpansion` | Slash command expandido | ✅ | nome do comando |
| `PreToolUse` | Antes de executar tool | ✅ (allow/deny/ask/defer) | `tool_name` (regex/lista) |
| `PostToolUse` | Após tool ter sucesso | ❌ (mas injeta contexto) | `tool_name` |
| `PostToolUseFailure` | Após tool falhar | ❌ | `tool_name` |
| `PostToolBatch` | Após batch paralelo de tools | ✅ (para o loop) | — |
| `PermissionRequest` | Diálogo de permissão | ✅ (allow/deny) | `tool_name` |
| `PermissionDenied` | Tool auto-negada | ❌ (sinaliza retry) | `tool_name` |
| `Stop` | Claude termina resposta | ✅ (força continuar) | — |
| `StopFailure` | Turno encerrou por erro de API | ❌ | `rate_limit`/`auth_failed`/etc |
| `SubagentStart` / `SubagentStop` | Subagent começa/termina | Stop ✅ | nome do agent |
| `TaskCreated` / `TaskCompleted` | Task criada/marcada done | ✅ | — |
| `InstructionsLoaded` | CLAUDE.md/skill carregado | ❌ (audit) | `session_start`/`include`/etc |
| `ConfigChange` | Settings/skills mudaram | ✅ | `user_settings`/`project_settings`/etc |
| `CwdChanged` / `FileChanged` | cwd mudou / arquivo observado mudou | ❌ | (`FileChanged` aceita lista literal) |
| `WorktreeCreate` / `WorktreeRemove` | Worktree criada/removida | Create ✅ | — |
| `Notification` | Notificação enviada | ❌ | `permission_prompt`/`idle_prompt`/etc |
| `PreCompact` / `PostCompact` | Antes/depois da compactação | Pre ✅ | `manual`/`auto` |
| `Elicitation` / `ElicitationResult` | MCP pede input do user | ✅ | nome do MCP server |
| `SessionEnd` | Sessão encerra | ❌ | `clear`/`logout`/`other`/etc |

Lista completa e matchers em [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks).

## Onde configurar

```json
// .claude/settings.json (projeto, vai pro git)
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/lint.sh",
            "timeout": 600,
            "shell": "bash"
          }
        ]
      }
    ]
  },
  "disableAllHooks": false
}
```

**Hierarquia de escopo** (alta → baixa precedência): managed (admin) > project (`.claude/settings.json`) > local (`.claude/settings.local.json`) > user (`~/.claude/settings.json`) > plugin (`hooks/hooks.json`) > skill/agent frontmatter.

`disableAllHooks: true` desliga tudo do nível pra baixo (managed sempre vence).

## Como o payload chega

**Comum a todos os eventos** (stdin JSON pra `command`, body POST pra `http`):

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/dir",
  "hook_event_name": "PreToolUse",
  "permission_mode": "default",
  "agent_id": "subagent-123",
  "agent_type": "Explore"
}
```

**Eventos de tool adicionam:**

```json
{
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "tool_use_id": "toolu_01abc"
}
```

**HTTP hook** — útil pra integrar com backend externo (caso direto do `grupo_borges`):

```json
{
  "type": "http",
  "url": "http://localhost:8080/hooks/post-tool-use",
  "headers": {"Authorization": "Bearer $TOKEN"},
  "allowedEnvVars": ["TOKEN"]
}
```

Resposta 2xx vazia = sucesso. 2xx com JSON = parsed como decisão. Non-2xx = erro não-bloqueante. **Importante**: HTTP hook **não bloqueia via status code** — pra bloquear, retornar 2xx com `{"decision":"block"}` ou `{"hookSpecificOutput":{"permissionDecision":"deny"}}` ([source](https://code.claude.com/docs/en/hooks)).

## Bloqueio vs observação

**Exit codes** (script `command`):

| Code | Significado |
|---|---|
| `0` | Sucesso. Stdout parseado como JSON pra controlar comportamento. |
| `2` | **Bloquear**. Stderr vai pro Claude/usuário. Stdout/JSON ignorado. |
| outro | Erro não-bloqueante. Stderr logado, primeira linha vai pro transcript. |

⚠️ **Pegadinha Unix**: exit 1 **não bloqueia**. Sempre `exit 2` pra barrar.

**Controle fino via JSON em stdout** (exit 0):

```json
{
  "continue": true,
  "systemMessage": "Aviso pro usuário",
  "decision": "block",
  "reason": "Test suite falhou",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask|defer",
    "updatedInput": { "command": "npm run safe" },
    "additionalContext": "Branch atual: dev"
  }
}
```

Precedência quando múltiplos hooks conflitam: `deny` > `defer` > `ask` > `allow`.

`additionalContext` é **injeção de contexto sem bloqueio** — escrever como fato neutro ("Current branch: dev"), nunca como comando ("Switch to dev") pra evitar detector de prompt-injection. Cap de 10.000 chars; excesso vai pra arquivo.

## Casos de uso (do grupo_borges)

1. **Backend observando agentes via HTTP hook** — `PostToolUse` com `type: http` → POST pro FastAPI em Tailscale (`http://100.107.56.38:PORT/hooks/post-tool-use`). Backend insere event em `task_events` SQLite. Cobre o requisito de "observabilidade sem polling do JSONL". Cada Zé configura no `~/.claude/settings.json` da sessão.
2. **Auto-load de contexto por sessão** — `SessionStart` com `command` que escreve em `$CLAUDE_ENV_FILE` vars como `GRUPO_BORGES_AGENT=daniel` e injeta `additionalContext` com missão ativa do agente (busca via API do cockpit).
3. **Validador read-only de Supabase** — `PreToolUse` matcher `mcp__supabase-ze__.*` com script que bloqueia operações `INSERT|UPDATE|DELETE` quando o agente está em modo "read-only" (CFO Barsi, por exemplo).
4. **Telemetria de modelo/turno** — `PostToolBatch` com `additionalContext` capturando custo estimado por turno; alimenta dashboard de custo do cockpit.
5. **Captura de UserPromptSubmit pra registrar missão** — quando o Rica manda novo pedido, hook POSTa `{agent, prompt, timestamp}` pro backend cockpit. Vira `task` automaticamente.
6. **Auto-commit de memória após Stop** — hook `Stop` com script que faz `git add memory/ && git commit -m "memory(<agente>): auto"` se houver mudanças. Garante que memória nunca fica não-commitada.

## Debugging

- `/hooks` — menu read-only mostra todos os hooks configurados, source file, escopo (`[User]`/`[Project]`/`[Plugin]`/`[Built-in]`).
- Stderr de hook **não-bloqueante** aparece no debug log (`claude --debug` ou `--verbose`).
- HTTP hook que não dispara: testar manualmente com `curl -X POST -d '{}' http://localhost:8080/...` — Claude Code não reporta erro de conexão, só "non-blocking error".
- `hook_event_name` no payload sempre confirma qual evento disparou — útil quando o mesmo handler atende múltiplos eventos.
- Shell profile que printa em stdout quebra parsing JSON. Usar `bash --noprofile --norc` em scripts críticos.

## ❌ Anti-padrões

- ❌ **Exit 1 pra bloquear** — não funciona, é não-bloqueante. Usar **exit 2**.
- ❌ **JSON em stdout junto com exit 2** — ignorado. Se for bloquear, vai por stderr e código 2.
- ❌ **HTTP hook tentando bloquear via status 4xx/5xx** — não bloqueia. Retornar 2xx + JSON `{"decision":"block"}`.
- ❌ **Shell profile poluindo stdout** — qualquer print em `.bashrc`/`.zshrc` quebra parsing. Suprimir com `--noprofile --norc`.
- ❌ **`additionalContext` redigido como comando** — "Switch to main branch" dispara filtro de prompt-injection. Escrever como fato: "Current branch: main".
- ❌ **`if` em hooks de evento não-tool** — campo `if` (filtro de permission rule) só funciona em `PreToolUse`/`PostToolUse`/`PermissionRequest`/`PermissionDenied`. Em outros eventos é silenciosamente ignorado.
- ❌ **Esperar MCP conectado em `SessionStart`** — `SessionStart`/`Setup` rodam **antes** dos MCPs conectarem. Hook que chama MCP nessas fases falha no primeiro run.
- ❌ **Confiar que `stopReason` chega pro Claude** — `continue: false` + `stopReason` mostra reason pro **usuário**, não pro Claude. Pra Claude ver, usar `additionalContext`.
- ❌ **Hook `defer` em turno com múltiplas tools paralelas** — silenciosamente ignorado.
- ❌ **Plugin tentando definir hooks/permissionMode em subagent** — campos `hooks`, `mcpServers`, `permissionMode` são ignorados em subagents que vêm de plugin (segurança).

## Fontes

- [Hooks reference oficial](https://code.claude.com/docs/en/hooks) — lista completa de eventos, JSON schema, exit codes
- [Subagents — define hooks](https://code.claude.com/docs/en/sub-agents#define-hooks-for-subagents) — hooks no frontmatter de subagent
- [Best practices — Set up hooks](https://code.claude.com/docs/en/best-practices) — quando preferir hook a CLAUDE.md
- [Permission modes](https://code.claude.com/docs/en/permission-modes) — interação entre hooks e permission system
- [Settings reference](https://code.claude.com/docs/en/settings) — hierarquia de settings.json e managed settings
