# grupo_borges API (FastAPI)

Backend do cockpit. Roda na VPS atrás de Tailscale Serve.

## Stack

- Python 3.11+ · FastAPI · sse-starlette · libtmux · watchfiles · markdown-it-py
- SQLite WAL local com write queue (1 thread escritor + leituras paralelas)
- Auth: Tailscale identity headers (sem senha custom)
- Gerenciador de pacotes: [`uv`](https://docs.astral.sh/uv/)

## Estrutura

```
apps/api/
├── main.py                 # entry FastAPI + middleware Tailscale
├── pyproject.toml
├── .env.example
├── db/
│   ├── schema.sql          # 7 tabelas (agents, agent_state, agent_instances, tasks, task_links, task_runs, task_events)
│   └── store.py            # SQLite WAL + write queue
├── orchestrator/
│   ├── tmux_driver.py      # libtmux wrapper
│   └── jsonl_watcher.py    # watchfiles em ~/.claude/projects/.../*.jsonl
└── routers/
    ├── agents.py           # GET /api/agents (read state)
    ├── hooks.py            # POST /hooks/* (receive Claude Code hook events)
    └── stream.py           # GET /api/stream (SSE)
```

## Rodar dev local

```bash
cd apps/api
uv sync                                                    # instala deps
cp .env.example .env                                       # ajusta GB_WORKSPACES_ROOT etc
GB_DEV_BYPASS_AUTH=1 uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Health check: `curl http://127.0.0.1:8000/health`

## Rodar prod (VPS)

```bash
# após git pull na VPS:
cd /home/clawd/repos/grupo_borges/apps/api
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8000

# expor via Tailscale Serve (HTTPS)
sudo tailscale serve --bg https / http://localhost:8000
```

systemd unit em `apps/api/deploy/grupo_borges_api.service` (a criar Fase 1.5).

## Hooks de Claude Code

Cada Zé deve ter no `~/.claude/settings.json` (template em `apps/api/deploy/claude-hook-template.json` — a criar):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [{
          "type": "http",
          "url": "https://srv1061129.tailfe77db.ts.net/hooks/post-tool-use"
        }]
      }
    ],
    "UserPromptSubmit": [...],
    "SubagentStart": [...],
    "SubagentStop": [...],
    "SessionStart": [...]
  }
}
```

Só dispara dentro da tailnet — fora dela, o backend recusa.
