-- grupo_borges/apps/api/db/schema.sql
-- Schema SQLite do cockpit. Aplicar via store.GrupoBorgesDB.startup() (idempotente — CREATE TABLE IF NOT EXISTS).
-- Executar manualmente em dev: sqlite3 grupo_borges.db < schema.sql

PRAGMA journal_mode  = WAL;
PRAGMA synchronous   = NORMAL;
PRAGMA busy_timeout  = 5000;
PRAGMA foreign_keys  = ON;
PRAGMA temp_store    = MEMORY;

-- ============================================================
-- agents — 6 agentes da frota. Source of truth = agents.yaml.
-- Sincronizado em cada startup (UPSERT). Usado pra lookups rápidos.
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
    slug            TEXT PRIMARY KEY,                       -- pavan, daniel, lucas, vinicius, felipe, barsi
    name            TEXT NOT NULL,                          -- "José Pavan", "Daniel Singh", ...
    role            TEXT,
    emoji           TEXT,
    tmux_session    TEXT NOT NULL,
    workspace_path  TEXT NOT NULL,
    cli_default     TEXT NOT NULL DEFAULT 'claude_code',
    model_default   TEXT NOT NULL,
    capabilities    TEXT,                                   -- JSON array
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- ============================================================
-- agent_state — snapshot vivo (atualizado por hooks HTTP / heartbeats)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_state (
    slug              TEXT PRIMARY KEY REFERENCES agents(slug) ON DELETE CASCADE,
    cli               TEXT,                                 -- claude_code | codex | idle
    model             TEXT,                                 -- modelo em uso
    current_task_id   TEXT,                                 -- task ativa (NULL se idle)
    last_seen         INTEGER,                              -- unix timestamp do último heartbeat
    jsonl_path        TEXT,                                 -- arquivo JSONL ativo
    pane_excerpt      TEXT,                                 -- últimos N chars do tmux capture-pane
    lifecycle_status  TEXT,                                 -- microestado: session | prompt | tool | subagent | idle | error | event
    lifecycle_detail  TEXT,                                 -- detalhe curto pra UI (tool, subagent, outcome)
    lifecycle_event   TEXT,                                 -- último evento bruto que alimentou lifecycle
    lifecycle_updated_at INTEGER,                           -- unix timestamp do último microestado
    instance_count    INTEGER NOT NULL DEFAULT 0            -- nº de instâncias ativas (subagents incluídos)
);

-- ============================================================
-- agent_instances — paralelismo (3 Daniels = 3 rows; cada subagent é uma)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_instances (
    id                TEXT PRIMARY KEY,                     -- uuid
    agent_slug        TEXT NOT NULL REFERENCES agents(slug) ON DELETE CASCADE,
    instance_num      INTEGER NOT NULL,                     -- 1, 2, 3...
    tmux_session      TEXT,                                 -- daniel-1 | daniel-2 | NULL (subagent)
    cli               TEXT NOT NULL,                        -- claude_code | codex
    model             TEXT NOT NULL,
    is_subagent       INTEGER NOT NULL DEFAULT 0,           -- 0=sessão CC própria, 1=subagent
    parent_session_id TEXT,                                 -- session do agente pai (se subagent)
    status            TEXT NOT NULL,                        -- idle | running | blocked | done
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    UNIQUE (agent_slug, instance_num)
);

-- ============================================================
-- tasks — missões plantadas (1 missão pode virar várias tasks via decomposição)
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,                       -- uuid
    human_id        TEXT UNIQUE,                            -- "DS-12" — legível, gerado por agente (NULL em rows antigos)
    title           TEXT NOT NULL,
    body            TEXT,
    assignee        TEXT NOT NULL REFERENCES agents(slug),
    instance_id     TEXT REFERENCES agent_instances(id),
    origin_agent    TEXT REFERENCES agents(slug),           -- quem plantou (NULL = Rica direto)
    skill_hint      TEXT,                                   -- skill recomendada pelo originador
    status          TEXT NOT NULL,                          -- backlog | ready | running | review | blocked | done
    priority        INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    started_at      INTEGER,
    completed_at    INTEGER,
    idempotency_key TEXT UNIQUE                             -- evita duplicação cross-handoff
);

-- ============================================================
-- human_id_counters — sequência por agente pra gerar IDs humanos legíveis
-- prefix: 2 letras (iniciais do nome). next_seq: próximo número a usar.
-- ============================================================
CREATE TABLE IF NOT EXISTS human_id_counters (
    agent_slug TEXT PRIMARY KEY REFERENCES agents(slug) ON DELETE CASCADE,
    prefix     TEXT NOT NULL,                               -- "DS" pro Daniel, "JP" pro Pavan, etc
    next_seq   INTEGER NOT NULL DEFAULT 1
);

-- ============================================================
-- task_links — handoffs / decomposição (Lucas pingou Daniel = link)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_links (
    parent_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    child_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    link_kind  TEXT NOT NULL,                               -- handoff | subtask | reply
    created_at INTEGER NOT NULL,
    PRIMARY KEY (parent_id, child_id)
);

-- ============================================================
-- task_runs — cada execução com heartbeat (múltiplas se retry/crash/resume)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_runs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    instance_id       TEXT REFERENCES agent_instances(id),
    status            TEXT NOT NULL,                        -- running | done | blocked | crashed | timed_out
    last_heartbeat    INTEGER,
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    outcome           TEXT,
    output_excerpt    TEXT
);

-- ============================================================
-- task_events — log estruturado (1 hook event = 1 row + JSONL eventos selecionados)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    agent_slug  TEXT REFERENCES agents(slug),
    instance_id TEXT REFERENCES agent_instances(id),
    kind        TEXT NOT NULL,                              -- PostToolUse | UserPromptSubmit | SubagentStart | ...
    payload     TEXT,                                       -- JSON
    raw_jsonl   TEXT,                                       -- linha JSONL crua quando aplicável
    created_at  INTEGER NOT NULL
);

-- ============================================================
-- Indexes pra queries rápidas (kanban, dashboard, debug)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assignee, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status          ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_origin          ON tasks(origin_agent);
CREATE INDEX IF NOT EXISTS idx_links_child           ON task_links(child_id);
CREATE INDEX IF NOT EXISTS idx_runs_heartbeat        ON task_runs(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_runs_task             ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_events_task           ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_agent          ON task_events(agent_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_events_kind           ON task_events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_instances_agent       ON agent_instances(agent_slug, status);
