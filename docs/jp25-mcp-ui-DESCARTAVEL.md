# JP-25 — UI nativa pra /mcp no cockpit (PLAYBOOK DESCARTÁVEL)

> ⚠️ **Arquivo descartável** — apagar ou mover pra histórico após JP-25 fechar. Nome com sufixo `-DESCARTAVEL` indica isso. Não tratar como doc perene.

> Pesquisa Tara (research read-only) consolidada + arquitetura + ordem de execução. Cockpit task: `cf66766e-3fc1-4210-8d74-a25990071cf4`. Research completo: `/tmp/tara-jp25-mcp-research.md`.

## TL;DR

`/mcp` do CC nativo abre modal interativo bloqueante. Vamos interceptar no input do cockpit, ler estado MCP do disco, mostrar painel inline com toggles, escrever direto no JSON e oferecer "/reload-plugins agora".

## Descobertas Tara (resumo)

### 2 categorias de MCP, gerenciamento DIFERENTE

| Categoria | Server def | Toggle (state owner) | ID | Exemplo |
|---|---|---|---|---|
| **Plugin** | `~/.claude/plugins/cache/<source>/<name>/<ver>/.mcp.json` | `~/.claude/settings.json > enabledPlugins[<id>]` | `<name>@<source>` | `telegram@claude-plugins-official`, `whatsapp-rica@local` |
| **Project `.mcp.json`** | `<cwd>/.mcp.json` | `~/.claude.json > projects["<cwd>"].enabledMcpjsonServers[] / disabledMcpjsonServers[]` | server name | `supabase-ze`, `supabase_geral` |

### CLI helpers úteis

- ✅ `claude plugin enable --scope user <id>` / `disable` — toggle programático de plugin
- ✅ `claude mcp add/add-json/remove --scope project ...` — criar/deletar definição `.mcp.json`
- ❌ **Não há CLI direta** pra toggle approve/reject de `.mcp.json` server existente. Backend edita `~/.claude.json` direto.
- ⚠️ `claude mcp list/get` e `claude doctor` **spawnam stdio servers** pra health check — NÃO usar em endpoint passivo

### Reload

- Edit de JSON sozinho NÃO aplica em sessão CC já rodando
- Tem que mandar `/reload-plugins` no tmux do CC OU relaunch da sessão
- Plugin update do CC instrui isso: "Run /reload-plugins to activate"

### Repo atual (grupo_borges)

- Zero `.mcp.json` local
- Estado em `~/.claude.json > projects["/home/clawd/repos/grupo_borges"]` existe mas vazio
- Os MCPs ativos hoje vêm de PLUGINS (telegram, whatsapp-rica) + globais

## Gotchas críticos (NÃO ignorar no código)

1. **Schema `.mcp.json` heterogêneo** — uns wrappados `{"mcpServers": {...}}`, outros flat `{"<server>": {...}}`. Parser duplo obrigatório.
2. **`enabledMcpjsonServers` polimorphic** — pode ser `[]`, `null` ou ausente. Normalizar antes de diffar.
3. **Secrets** — `.mcp.json` carrega `--access-token`, `Authorization`, env vars. UI redact agressivo (`args`, `headers`, `env`).
4. **Sem lockfile** — write-temp + rename atômico. Re-read antes do write pra evitar race com sessão CC ativa.
5. **Cache files** (`plugins/cache/<src>/<name>/<ver>/.mcp.json`) — NÃO editar; são reinstalados em plugin update. Toggle vai no `enabledPlugins`.

## Arquitetura

### Backend (apps/api)

#### `GET /api/agents/{slug}/mcp`

Lê e consolida:
- `~/.claude/settings.json > enabledPlugins`
- `~/.claude/plugins/installed_plugins.json`
- Pra cada plugin instalado: `<installPath>/.mcp.json` (server name + metadata)
- Se `<agent.workspace>/.mcp.json` existe: lê definições
- `~/.claude.json > projects[<workspace>].enabledMcpjsonServers/disabledMcpjsonServers`

Retorna:
```json
{
  "servers": [
    {
      "kind": "plugin",
      "id": "telegram@claude-plugins-official",
      "name": "telegram",
      "enabled": true,
      "transport": "stdio",
      "description": "Telegram channel..."
    },
    {
      "kind": "mcp_json",
      "id": "supabase-ze",
      "name": "supabase-ze",
      "enabled": true,
      "transport": "stdio",
      "command_redacted": "npx -y @supabase/mcp-server-supabase@latest <redacted>"
    }
  ]
}
```

#### `PATCH /api/agents/{slug}/mcp/{kind}/{id}` body `{"enabled": bool}`

- `kind=plugin` → edita `~/.claude/settings.json > enabledPlugins[id]` (write-temp+rename)
- `kind=mcp_json` → edita `~/.claude.json > projects[<workspace>].enabledMcpjsonServers/disabledMcpjsonServers` (write-temp+rename, normaliza `null→[]`)

Resposta: `{"applied": true, "requires_reload": true}`

#### `POST /api/agents/{slug}/mcp/reload`

Envia `/reload-plugins` via `send_message` no tmux do agente. Opt-in pelo user no front.

### Frontend (apps/web)

1. **Interceptor no ChatInput**: detecta `/mcp` (sem args) + Enter → não envia pro tmux, dispara abertura de painel inline. Outros `/mcp <subcmd>` (se houver) vão normal pro CC.
2. **Painel inline** (acima do input, ou modal pequeno):
   - Header: "Servers MCP de `<agent>`"
   - Grupos: "Plugins" + "Project (`.mcp.json`)"
   - Cada item: nome + toggle + badge `kind:id` + tooltip do command (redacted)
   - Footer: "Precisa `/reload-plugins` pra aplicar mudanças" + botão "Aplicar agora"
3. **Toggle**: PATCH otimista (UI muda na hora; rollback em erro). Após primeiro toggle: footer destaca "reload pendente".
4. **Fechar**: clicar fora / Esc / botão X → volta pro chat normal.

## Ordem de execução

### Subsessão A — Backend (Tara, worktree isolado)

- Worktree: `~/.claude/worktrees/jp25-mcp-backend` (Agent View cria sozinho)
- Brief: implementar `GET /api/agents/{slug}/mcp`, `PATCH /api/agents/{slug}/mcp/{kind}/{id}`, `POST /api/agents/{slug}/mcp/reload`. Atomic write. Redact agressivo. Schema parser duplo (`mcpServers` wrapped vs flat). Tests:
  - GET retorna shape esperado lendo settings.json + .claude.json
  - PATCH plugin atualiza settings.json.enabledPlugins
  - PATCH mcp_json move entre enabled/disabled lists em .claude.json (normaliza null→[])
  - Redact não vaza tokens
  - Reload chama send_message com "/reload-plugins"
- Não tocar em frontend.

### Subsessão B — Frontend (Daniel-sub, worktree isolado)

- Worktree: `~/.claude/worktrees/jp25-mcp-frontend`
- Pré-req: subsessão A já mergeada na main
- Brief: interceptor `/mcp` em ChatInput + componente MCPPanel + integração api.ts (getAgentMcp, patchAgentMcp, postAgentMcpReload). Toggle otimista + rollback em erro. Footer com botão "aplicar reload".
- Não tocar em backend.

### Sessão atual (Daniel CC, esta) — orquestra

- Cria os 2 worktrees via skill `agent-view`
- Despacha as 2 subsessões com briefs ≤25 linhas
- Revisa diff de cada uma antes de mergear na main
- Validação final no cockpit local (porta 3007)

## Validação E2E

1. Refresh do cockpit
2. Digite `/mcp` + Enter no input do agente atual
3. Painel abre mostrando: telegram (on), whatsapp-rica (on) + qualquer mcp_json
4. Toggle off telegram → settings.json deve ter `enabledPlugins["telegram@claude-plugins-official"]: false`
5. Footer destaca "reload pendente"
6. Clicar "aplicar reload" → `/reload-plugins` no tmux → CC recarrega
7. Próxima mensagem pro CC já sem telegram

## Limpeza pós-fechamento

- Marcar JP-25 como `done` no cockpit
- **Apagar este arquivo** (`docs/jp25-mcp-ui-DESCARTAVEL.md`)
- Manter o código (backend + frontend) na main
- Documentação durável (se houver) entra em AGENTS.md ou docs/cockpit-design-reference/

## Referências

- Research bruto: `/tmp/tara-jp25-mcp-research.md` (347 linhas)
- Task cockpit: `cf66766e-3fc1-4210-8d74-a25990071cf4`
- Pattern de interceptor de slash: usar `parseInt` no `/<cmd>` no ChatInput antes de submitText
- Skill orquestração: `agent-view` (worktree isolado evita race no `.git/index`)
