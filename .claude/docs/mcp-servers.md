# MCP servers — Claude Code

> Síntese acionável em pt-BR. Fonte oficial: [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) + [modelcontextprotocol.io](https://modelcontextprotocol.io). Última pesquisa: 2026-05-09.

## Resumo executivo

- **MCP (Model Context Protocol)** é o padrão aberto da Anthropic pra plugar tools/dados externos no agente. Servers expõem tools, resources e prompts via stdio/HTTP/SSE — Claude Code conecta e os tools aparecem como `mcp__<server>__<tool>`.
- **3 transports**: `stdio` (processo local), `http` (recomendado pra remoto, alias `streamable-http`), `sse` (**deprecated**, ainda funciona).
- **3 escopos**: `local` (default, só seu projeto, gravado em `~/.claude.json`), `project` (compartilhado via `.mcp.json` no root do projeto, vai pro git), `user` (todos seus projetos, gravado em `~/.claude.json`).
- **Env var expansion** em `.mcp.json`: `${VAR}` e `${VAR:-default}` — permite commitar config sem secrets.
- **Channels**: MCP server pode **empurrar mensagens** pra sessão (capability `claude/channel`) — Claude reage a evento externo (Telegram, webhook). Inverte o padrão pull, é o canal que usamos hoje pro Telegram dos Zés.

## O que é MCP (visão CC)

MCP é especificação aberta de RPC entre cliente AI (Claude Code) e servidor de ferramentas. O servidor anuncia o que sabe fazer (tools, resources, prompts); o cliente chama. Comparado a slash command/skill: **MCP é stateful e conectado** — server roda em background (stdio process ou conexão HTTP), pode mudar tools dinamicamente (`list_changed`), pode empurrar eventos. Skills/commands são **estáticos e on-demand** (carregam Markdown quando invocados).

Use MCP quando: precisa expor sistema externo (DB, API, monitoring) ao Claude programaticamente, ou quando quer evento empurrado pra sessão (channel).

## Anatomia de um `.mcp.json`

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    },
    "supabase-ze": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "${SUPABASE_PAT}"],
      "env": {
        "SUPABASE_PROJECT_REF": "jjtfzteodsazbdkyubhr"
      }
    },
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

**Campos por tipo:**
- `stdio`: `command` (executável), `args` (lista), `env` (dict)
- `http`: `url`, `headers` (dict, geralmente Authorization)
- `sse`: idem `http` (deprecated)

`type` aceita `streamable-http` como alias de `http` (a spec do MCP usa esse nome — copiar config de docs externas funciona sem ajuste).

## Transport — stdio vs HTTP/SSE

| Característica | stdio | http | sse |
|---|---|---|---|
| Localização | Processo local | Remoto (URL) | Remoto (URL) |
| Quando usar | Tools que precisam do FS local, custom scripts, dev local | Cloud services, APIs hospedadas | **Não usar** (deprecated) |
| Auth | env vars no `env` | headers (Bearer/API-key) | headers |
| Reconnect automático | ❌ (processo local não reconecta) | ✅ exponential backoff (até 5x) | ✅ |
| Initial connection retry | — | 3x em erro transitório (5xx, refused, timeout) | idem |
| OAuth via `/mcp` | ❌ | ✅ | ✅ |

Recomendação oficial: **HTTP > SSE** sempre. Stdio só pra coisa local que precisa rodar como subprocesso.

## Namespace de tools

Tool aparece pro Claude como `mcp__<server-name>__<tool-name>`:

- Server `supabase-ze` com tool `execute_sql` → `mcp__supabase-ze__execute_sql`
- Server `playwright` com tool `browser_click` → `mcp__playwright__browser_click`

Usado em hooks (matcher `mcp__supabase-ze__.*` filtra todas as tools desse server) e em listas de `tools`/`disallowedTools` de subagent.

**Reserved**: nome `workspace` é reservado, CC ignora server com esse nome no load e mostra warning.

## Escopo — local vs project vs user

| Scope | Loads em | Compartilha com time? | Gravado em |
|---|---|---|---|
| `local` (default) | Só projeto atual | ❌ | `~/.claude.json` (sob `projects.<path>.mcpServers`) |
| `project` | Só projeto atual | ✅ via git | `.mcp.json` no root do projeto |
| `user` | Todos seus projetos | ❌ | `~/.claude.json` (top-level) |

**Precedência** quando colidem por nome: local > project > user > plugin > claude.ai connector.

**Aprovação de project-scope**: Claude Code prompta antes de usar server vindo de `.mcp.json` (segurança). Reset com `claude mcp reset-project-choices`.

## Decision tree — MCP vs Slash command vs Skill

```
Preciso integrar com sistema externo (DB, API, browser, monitoring)?
├── Sim → MCP server
│    ├── Stateful (precisa conexão persistente, ou push) → MCP é único caminho
│    └── Stateless (só uma chamada e fim) → MCP ou Skill com Bash(curl/cli)
│
Preciso expor procedimento que Claude executa quando user invoca?
├── Sim, side-effects perigosos (deploy, send) → Skill com `disable-model-invocation: true`
├── Sim, sem side-effects → Skill (Claude pode auto-invocar) ou slash command
│
Quero injetar conhecimento de domínio que Claude aplica conforme conversa?
├── Sim → Skill (description faz matching automático)
│
Quero forçar comportamento determinístico em todo turn (lint, format, audit)?
└── Hook (PreToolUse/PostToolUse), não skill nem MCP
```

**Regra prática**:
- Tem CLI/REST exposta? → **Skill** com `Bash(cli ...)` é mais leve que MCP.
- Tem que ser tool de 1ª classe que Claude descobre via MCP discovery? → **MCP**.
- Quer empurrar evento pra sessão? → **MCP com channel capability**.

## Auth patterns

**Stdio** — env vars:
```json
{ "command": "...", "env": { "API_KEY": "${MY_KEY}" } }
```

**HTTP** — headers:
```json
{
  "type": "http",
  "url": "${API_BASE_URL:-https://api.example.com}/mcp",
  "headers": { "Authorization": "Bearer ${API_KEY}" }
}
```

**OAuth 2.0** — pra remote server que suporta, autenticar via `/mcp` dentro do CC. Token fica gerenciado pelo CC (não precisa no `.mcp.json`).

**Variable expansion**: `${VAR}` e `${VAR:-default}`. Funciona em `command`, `args`, `env`, `url`, `headers`. **Se var requerida não tá setada e não tem default, CC falha o parse** — segurança contra deploy sem secret.

## Debug

- `claude mcp list` — lista todos os servers configurados
- `claude mcp get <name>` — detalhes de um
- `/mcp` (dentro de uma sessão) — painel ao vivo: status (connected/pending/failed), contagem de tools, OAuth login. Marca server que advertise tools mas expõe 0 — sinal de conexão zumbi.
- `MCP_TIMEOUT=10000 claude` — aumenta timeout de startup pra 10s (default menor; útil pra stdio com cold start)
- `MAX_MCP_OUTPUT_TOKENS=50000` — eleva cap de output (warning padrão em 10K tokens)
- HTTP server falhou conexão inicial: CC tenta 3x em erro transitório (5xx, refused, timeout). Auth failure (401/403) e 404 **não** retentam.
- Mid-session disconnect: HTTP/SSE reconecta com exponential backoff (até 5x). Stdio não reconecta automaticamente — processo morto = server morto.
- `list_changed`: server pode notificar mudança dinâmica de tools sem reconnect — ver no `/mcp` se a contagem muda sozinha.

## Aplicação no grupo_borges

**Decisão preliminar**: o backend FastAPI do cockpit deve expor **REST + SSE pra UI**, e **NÃO um MCP server** pelos seguintes motivos:

1. UI do cockpit é frontend web (Next.js), não cliente MCP. SSE simples + REST é o caminho natural.
2. **Os agentes em si** (Daniel-CC, Pavan-CC, etc) são **clientes** Claude Code que **podem ter MCP server custom** apontando pro cockpit — mas só faz sentido se quisermos que o Claude **lê estado do cockpit pra agir** (ex: Pavan consulta task queue do cockpit pra decidir handoff). Pra UI-only, é desperdício.
3. **Onde MCP custom faz sentido pro grupo_borges**:
   - **MCP server "cockpit"** (HTTP, na VPS via Tailscale) expondo tools `get_active_missions`, `assign_task(agent, prompt)`, `record_handoff(from, to, payload)`. Cada Zé adiciona via `claude mcp add --transport http cockpit https://cockpit.tailfe77db.ts.net/mcp --header "Authorization: Bearer ${COCKPIT_TOKEN}"`. Daí o Pavan pode pingar outros via tool em vez de tmux send-keys.
   - **MCP channel pra notificações** — quando UI cria nova missão, o backend empurra `claude/channel` message pro CC do agente alvo. Sem polling, sem tmux, sem fragilidade.

**Hooks vs MCP pra observabilidade**: hook HTTP em `PostToolUse` é mais simples pra mandar evento pro backend (one-way fire-and-forget). MCP só ganha se quisermos bidirecional (cockpit também responde com instrução pro agente).

**Auth**: o cockpit roda Tailscale-only (regra dura), então identity headers do Tailscale fazem auth — `header X-Tailscale-User`. Não precisa OAuth nem bearer dedicado se o ambiente todo é tailnet.

**`.mcp.json` em cada workspace** — checkar `<agente>/.mcp.json` no git, com `${COCKPIT_TOKEN}` em var de ambiente (nunca commitar token literal).

## ❌ Anti-padrões

- ❌ **API key literal em `.mcp.json`** — sempre `${VAR}` com var em `.env` local. `.mcp.json` vai pro git.
- ❌ **Usar SSE em integração nova** — deprecated. HTTP (`streamable-http`) é o padrão.
- ❌ **Misturar MCP local-scope com user-scope sem entender precedência** — duplicate por nome resolve pelo escopo mais alto. Confunde quando user testa server "novo" mas vê o antigo persistir.
- ❌ **Confiar que stdio reconecta** — não reconecta. Se processo morre, manualmente kill+restart ou reload do CC.
- ❌ **Output do MCP > 10K tokens sem subir cap** — warning, e CC pode truncar. `MAX_MCP_OUTPUT_TOKENS` resolve.
- ❌ **Server name `workspace`** — reservado, ignorado silenciosamente (com warning). Nomear `workspace_x` ou outro prefixo.
- ❌ **MCP custom só pra evitar slash command** — se o caso é "user manda invoke", skill com `disable-model-invocation` é 10x mais simples.
- ❌ **MCP server público sem auth** — qualquer cliente MCP do mundo pode bater. Sempre Tailscale, OAuth, ou bearer.
- ❌ **Passar tool de MCP de teste pra produção sem `disallowedTools` em subagents** — subagent inherita todas as tools, incluindo MCPs perigosos. Restringir explícito.
- ❌ **Confiar em ordering de flags `claude mcp add`** — todas as opções vêm **antes** do nome; `--` separa nome de comando+args. `claude mcp add --transport stdio --env KEY=v myserver -- npx server.py --port 8080`.
- ❌ **Plugin definindo MCP server inline com `permissionMode`/`hooks`** — campos ignorados em subagents vindos de plugin (segurança).

## Fontes

- [MCP em Claude Code (oficial)](https://code.claude.com/docs/en/mcp) — config, scopes, transports, channels, plugin MCP
- [modelcontextprotocol.io](https://modelcontextprotocol.io) — spec do protocolo, SDK references
- [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) — catálogo de servers oficiais e da comunidade
- [Channels reference](https://code.claude.com/docs/en/channels-reference) — como server empurra mensagem pra sessão (`claude/channel`)
- [Subagents — Scope MCP servers to a subagent](https://code.claude.com/docs/en/sub-agents#scope-mcp-servers-to-a-subagent) — campo `mcpServers` no frontmatter de subagent (inline ou referência)
- [FastMCP (Python helper)](https://github.com/jlowin/fastmcp) — biblioteca pra construir MCP server em Python rápido
