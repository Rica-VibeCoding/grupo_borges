# Claude Code — Acervo de Best Practices

> Acervo curado de padrões, schemas e boas práticas oficiais do Claude Code. Cresce conforme pesquisas vão sendo concluídas.

## Por que esta pasta existe

Vários projetos do Rica dependem de **orquestrar Claude Code profundamente** — começando pelo `grupo_borges` (cockpit multi-agente). Pra escalar com segurança, precisamos dominar: subagents, hooks, JSONL session format, skills, MCP servers, context files, permissions.

Em vez de ler doc Anthropic toda vez do zero, acumulamos aqui síntese acionável em português, com fontes citadas.

## Origem das pesquisas

Briefings vivem em `_research-briefings/`. Cada briefing é executado por uma **segunda sessão Daniel rodando em Haiku** (barato, paraleliza com sessão principal).

## Acervo (atualizar conforme briefings ficam `done`)

| # | Tema | Doc | Status |
|---|---|---|---|
| 001 | Subagents (Agent tool) | `subagents.md` | ✅ pronto |
| 002 | Hooks lifecycle | `hooks.md` | ✅ pronto |
| 003 | JSONL session format | `jsonl-format.md` | ✅ pronto |
| 004 | Skills system | `skills.md` | ✅ pronto |
| 005 | MCP servers | `mcp-servers.md` | ✅ pronto |
| 006 | Stack API (FastAPI/sse-starlette/libtmux/watchfiles/pydantic-settings) | `stack-api-signatures.md` | ✅ pronto |

## Como usar

Antes de codar feature de `grupo_borges` que toca um desses temas, ler o doc correspondente. Se ainda for `⏳ pendente`, abrir briefing pra Daniel-research.
