# JSONL session format — Claude Code

> Síntese acionável em pt-BR. Fontes: [Inside Claude Code: Session File Format (databunny)](https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b) + inspeção direta de sessão real (PC do Rica, v2.1.138, 2026-05-09).

## Resumo executivo

- **Não há schema oficial publicado pela Anthropic** — o que se sabe vem de engenharia reversa da comunidade (databunny, claude-parser, claude-JSONL-browser) + inspeção direta. Schema **estável na prática mas não garantido entre versões**.
- **Caminho real (validado v2.1.138):** `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. Cada workspace tem uma pasta; cada sessão (mesmo retomada) gera novo arquivo `.jsonl`.
- **Append-only** — Claude Code só anexa linhas, nunca reescreve. Cada linha é um JSON completo (independente, parseável isolado).
- **Árvore de conversação via `parentUuid`** — toda linha tem `uuid` próprio e aponta pro `uuid` da linha-pai. Permite reconstruir branches (ex: subagent fork, rewind).
- **Tipos principais observados em sessão real**: `permission-mode`, `file-history-snapshot`, `user`, `assistant`, `attachment` (deferred_tools_delta, mcp_instructions_delta, skill_listing), `tool_use`/`tool_result` embutidos em `message.content`, `summary`, `system`.

## Localização dos arquivos

```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
~/.claude/projects/<encoded-cwd>/<session-uuid>/   ← pasta de tool-results e subagents
```

**Encoding do cwd**: o path do workspace é convertido substituindo separadores e caracteres especiais por `-`:

| Path original | Encoded |
|---|---|
| `/home/user/myapp` | `-home-user-myapp` |
| `C:\Users\Rica\Documents\dev\projetos\ze claude\daniel` | `C--Users-Rica-Documents-dev-projetos-ze-claude-daniel` |

Drive letter `C:` vira `C-`, `\` vira `-`, espaço vira `-`. Caractere `:` em `C:` vira `--` por dupla substituição. **Não confiar 100%** — quando precisar resolver, comparar com `os.listdir("~/.claude/projects/")` e match por prefixo do nome do projeto.

Outras pastas relacionadas (mencionadas em databunny):
- `~/.claude/tasks/` — JSON de tasks por sessão
- `~/.claude/plans/` — plans em Markdown
- `~/.claude/teams/` — config de agent teams
- `~/.claude/projects/<encoded>/<sessionId>/subagents/agent-{agentId}.jsonl` — transcripts de subagents (independentes do principal)

## Anatomia de uma linha (real, validada)

**User prompt** (primeira mensagem da sessão):

```json
{
  "parentUuid": null,
  "isSidechain": false,
  "promptId": "7a871ac3-9eee-489e-93d2-459eda7db908",
  "type": "user",
  "message": {
    "role": "user",
    "content": "vc tem o serviço que estamos fazendo aqui Dani..."
  },
  "uuid": "df9297f8-1703-4e2c-bd99-ceb3ebd597f1",
  "timestamp": "2026-05-09T18:51:25.968Z",
  "permissionMode": "bypassPermissions",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "C:\\Users\\RicardoBorges\\Documents\\dev\\projetos\\ze claude\\daniel",
  "sessionId": "23318f51-2ea6-4ec8-958b-9d4efb637513",
  "version": "2.1.138",
  "gitBranch": "main"
}
```

**Assistant** (resposta com thinking + tool_use, tipo Anthropic API):

```json
{
  "parentUuid": "5366804d-...",
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-7",
    "id": "msg_01LMpNUGFyYDTneNYRqWvi1f",
    "type": "message",
    "role": "assistant",
    "content": [
      {"type": "thinking", "thinking": "...", "signature": "..."},
      {"type": "tool_use", "id": "toolu_...", "name": "Read", "input": {...}}
    ],
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 6,
      "cache_creation_input_tokens": 41970,
      "cache_read_input_tokens": 26559,
      "output_tokens": 349,
      "service_tier": "standard"
    }
  },
  "requestId": "req_011CasVsWZcSand5LqRT7Q7k",
  "uuid": "1c72db08-...",
  "timestamp": "2026-05-09T18:51:30.231Z",
  "sessionId": "..."
}
```

**Envelope comum** em quase toda linha: `parentUuid`, `uuid`, `type`, `timestamp`, `sessionId`, `cwd`, `version`, `gitBranch`, `userType`, `entrypoint`, `isSidechain`.

## Tipos de evento

| `type` | Quando aparece | Campos relevantes |
|---|---|---|
| `permission-mode` | Setup inicial e mudanças de modo | `permissionMode` |
| `file-history-snapshot` | Início da sessão e edições | `snapshot.trackedFileBackups`, `messageId` |
| `user` | Prompt do user, hook results, command outputs | `message.role: "user"`, `promptId`, `content` |
| `assistant` | Resposta do Claude (texto/thinking/tool_use) | `message.content[]`, `usage`, `stop_reason`, `requestId` |
| `attachment` | Deltas de tools/MCPs/skills carregados em runtime | `attachment.type`: `deferred_tools_delta`, `mcp_instructions_delta`, `skill_listing` |
| `system` | Caveats, system reminders, contexto de boot | `subtype`, `content` |
| `summary` | Checkpoint de compactação | `compactMetadata.trigger` (`auto`/`manual`), `preTokens` |
| `result` | Marca fim de sessão | `outcome`, `cost_summary` |
| `tool_use` (dentro de `assistant.message.content`) | Claude chama tool | `id`, `name`, `input` |
| `tool_result` (dentro de `user.message.content`) | Tool retornou | `tool_use_id`, `content`, `is_error` |

`tool_use` e `tool_result` **não são linhas separadas** — vêm dentro do array `message.content` de uma linha `assistant` ou `user`. Correlação via `tool_use_id`.

## Linkagem por parentUuid

Toda linha (exceto a primeira da sessão, com `parentUuid: null`) aponta pro `uuid` da linha que a precede no fluxo lógico. Forma um **DAG dirigido**:

- **Linear**: pergunta → resposta → tool_use → tool_result → próxima resposta
- **Branch (rewind)**: usuário rebobinou e retomou de checkpoint X → novas linhas apontam pra X em vez do tip
- **Subagent fork**: subagent abre transcript próprio (`agent-{id}.jsonl`); a linha de spawn no transcript principal aponta pro `uuid` do agent

Pra reconstruir conversa: `BEGIN with parentUuid=null` → seguir pelo grafo (filhos = linhas onde `parentUuid == this.uuid`). Pra reconstruir um turno limpo, ignorar branches mortos (filhos do mesmo pai onde só um se estendeu).

## Append-only e atomicidade

- **Append-only confirmado**: Claude Code só faz `open(file, 'a')` + `write(line + '\n')`. Nunca reescreve.
- **Atomicidade por linha**: cada linha é JSON válido completo. Em crash de meio de write, a linha incompleta fica orfã (parser deve tolerar `JSONDecodeError` na última linha).
- **Retomada de sessão (`claude --resume`)**: gera **novo arquivo .jsonl com novo session_uuid**. As primeiras linhas referenciam o arquivo anterior via `summary` ou via metadados (não é continuação no mesmo arquivo). Pra rastrear sessões que retomam, agrupar por `cwd` + ordenar por `timestamp` da primeira linha.
- **Compactação**: gera linha `summary` com `compactMetadata.preTokens`. Conteúdo pré-compactação fica preservado no arquivo (append-only); a compactação só afeta o que vai pro próximo turno do modelo.

## Schema oficial vs comunidade

- **Não há schema oficial publicado** pela Anthropic (estado em 2026-05). Issue solicitando: [anthropics/claude-code#53516](https://github.com/anthropics/claude-code/issues/53516).
- **Fontes confiáveis pra schema**:
  - [databunny — Inside Claude Code](https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b) — referência mais detalhada disponível
  - [withLinda/claude-JSONL-browser](https://github.com/withLinda/claude-JSONL-browser) — parser open source com test fixtures
  - [alicoding/claude-parser](https://alicoding.github.io/claude-parser/anthropic/hook/) — parser com type definitions
  - **lm-assist** (`github.com/langmartai/lm-assist`) — indexador completo, parser de subagent trees
- **Risco de breakage**: Anthropic pode renomear campos/adicionar tipos a qualquer release. Parser tem que tolerar `type` desconhecido (skip + log).

## Aplicação no grupo_borges

`watchfiles` em `~/.claude/projects/` permite o backend FastAPI detectar tudo sem polling:

1. **Sessão iniciou** — diretório novo aparece em `~/.claude/projects/<encoded>/` ou novo arquivo `.jsonl` em pasta existente. Match com `agents.yaml` por encoded-cwd → identifica qual agente subiu.
2. **Tool em uso** — última linha tem `type: assistant` com `stop_reason: "tool_use"` e o `content[].name` é a tool ativa. Ideal pra mostrar "🔵 daniel-1: usando Bash" no card.
3. **Sessão idle** — sem evento há N minutos (timestamp da última linha vs now). Threshold de ~5min é razoável.
4. **Missão concluída** — última linha `type: assistant` com `stop_reason: "end_turn"` e sem tool_use no `content`. Correlacionar com last `user` prompt pra ver duração da missão.
5. **Custo por agente** — somar `usage.input_tokens` + `usage.output_tokens` (descontar `cache_read_input_tokens` * 0.1) de todas as linhas `assistant`. Por workspace = por agente.
6. **Subagent ativo** — aparece arquivo em `~/.claude/projects/<encoded>/<sessionId>/subagents/agent-{agentId}.jsonl`. Watcher pega e exibe como sub-card.

**Esquema sugerido pro `task_events` SQLite** (1 linha JSONL = 1 row):
- `agent_slug` (derivado do encoded-cwd)
- `session_id`, `event_uuid`, `parent_uuid`, `event_type`, `timestamp`
- `tool_name` (NULL se não for tool_use)
- `model`, `tokens_in`, `tokens_out` (NULL se não for assistant)
- `raw_json` (TEXT — o JSON inteiro, pra debug)

## ❌ Anti-padrões

- ❌ **Confiar em schema sem validar** — Anthropic não garante estabilidade. Sempre tratar `KeyError` e `JSONDecodeError`.
- ❌ **Parsear `cwd` pra inferir workspace sem validar contra `agents.yaml`** — encoded-cwd tem ambiguidade em paths com caracteres especiais.
- ❌ **Ler arquivo inteiro toda vez** — usar `tail -f`-style: guardar offset e ler só o novo. `watchfiles` reporta byte offsets; também dá pra usar `seek()` direto.
- ❌ **Assumir que retomada continua no mesmo arquivo** — não continua. Cada `claude --resume` gera novo `.jsonl`.
- ❌ **Tratar `tool_use`/`tool_result` como linhas separadas** — são content blocks dentro de linhas `assistant`/`user`.
- ❌ **Logar/salvar conteúdo sensível** — JSONL contém prompts completos, tool inputs (que podem ter senhas), secrets em ambiente. Tratar com mesmo cuidado de `.env`.
- ❌ **Bloquear no `watchfiles`** — usar handler async; sessões longas geram muitos eventos por segundo.
- ❌ **Confiar em encoded-cwd hardcoded** — Windows vs Linux geram encodings diferentes. Resolver via `pathlib.Path.resolve()` + transformação documentada por OS.

## Fontes

- [Inside Claude Code: The Session File Format and How to Inspect It (databunny)](https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b) — referência mais completa pra schema
- [withLinda/claude-JSONL-browser](https://github.com/withLinda/claude-JSONL-browser) — parser open source com test fixtures
- [alicoding/claude-parser](https://alicoding.github.io/claude-parser/anthropic/hook/) — type definitions pra eventos
- [Subagents — Manage subagent context](https://code.claude.com/docs/en/sub-agents#manage-subagent-context) — confirma path de subagent transcripts
- Inspeção direta: `~/.claude/projects/<encoded>/23318f51-...jsonl` (sessão atual, v2.1.138, 2026-05-09)
