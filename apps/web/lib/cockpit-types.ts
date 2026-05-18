// V2.4 — 4 estados reduzidos. Backend retorna esses valores no /api/fleet
// e armazena no agent_state.lifecycle_status. Detail rico continua livre.
export type AgentStatus = 'ocioso' | 'trabalhando' | 'aguardando' | 'offline';

export type AgentActivityState = AgentStatus;

export type AgentActivityOverride = {
  state: AgentActivityState;
  visible_until_ms: number;
  detail: string | null;
};

export type AgentLifecycleStatus = AgentStatus;

export type SparklineBucket = {
  bucket: string;
  count: number;
  /** DS-58: SUM(input+output tokens) da hora. Sparkline plota tokens pra altura,
   *  count fica pro tooltip (msgs trocadas). Backend gap-fill com 0 garante valor. */
  tokens: number;
};

export type AgentInstance = {
  id: string;
  agent_slug: string;
  instance_num: number;
  tmux_session: string | null;
  cli: string | null;
  model: string | null;
  is_subagent: boolean;
  parent_session_id: string | null;
  status: AgentStatus;
  started_at: number;
  ended_at: number | null;
};

export type AgentCli = 'claude_code' | 'codex';

export type AgentModel =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5'
  | 'codex-gpt-5-5'
  | 'codex-gpt-5-4'
  | 'codex-gpt-5-4-mini'
  | 'codex-gpt-5-3-codex'
  | 'codex-gpt-5-2';

export type AgentInstanceCreate = {
  cli: AgentCli;
  model: AgentModel;
  is_subagent: boolean;
};

export type AgentInstanceCreateResponse = {
  instance: AgentInstance;
  tmux_created: boolean;
  session_error?: string;
};

export type Agent = {
  slug: string;
  name: string;
  role: string;
  emoji: string | null;
  tmux_session: string;
  workspace_path: string;
  cli_default: string;
  model_default: string;
  capabilities: string[];
  created_at: number;
  updated_at: number;
  state_cli: string | null;
  state_model: string | null;
  current_task_id: string | null;
  current_task_last_heartbeat: number | null;
  last_seen: number | null;
  pane_excerpt: string | null;
  executor_kind: string | null;
  status_line: string | null;
  active_task_label: string | null;
  context_pct: number | null;
  session_started_at: number | null;
  last_assistant_message: string | null;
  token_usage_json: string | null;
  lifecycle_status: AgentLifecycleStatus | null;
  lifecycle_detail: string | null;
  lifecycle_event: string | null;
  lifecycle_updated_at: number | null;
  pane_session_started_at: number | null;
  instance_count: number;
  status: AgentStatus;
  instances: AgentInstance[];
  sparkline: SparklineBucket[];
};

export type FleetKpis = {
  total: number;
  running: number;
  blocked: number;
  idle: number;
  done: number;
  offline: number;
  tasks_active: number;
  tasks_running: number;
  tasks_blocked: number;
  tasks_done: number;
};

export type FleetHealth = {
  last_sync: number | null;
  server_now: number;
  offline_threshold_seconds: number;
  stale_threshold_seconds: number;
};

export type FleetResponse = {
  agents: Agent[];
  kpis: FleetKpis;
  health: FleetHealth;
};

export type TaskStatus = 'backlog' | 'ready' | 'running' | 'review' | 'blocked' | 'done' | 'archived';

export type ActiveTaskStatus = 'backlog' | 'ready' | 'running';

export type Task = {
  id: string;
  human_id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  instance_id: string | null;
  origin_agent: string | null;
  skill_hint: string | null;
  status: TaskStatus;
  priority: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  idempotency_key: string | null;
  current_run_id: number | null;
  current_run_status: string | null;
  current_run_last_heartbeat: number | null;
  current_run_started_at: number | null;
  current_run_ended_at: number | null;
  current_run_outcome: string | null;
  review_mode?: ReviewMode;
  reviewer_assignee?: string | null;
  tags?: string[] | null;
  image_urls?: string[] | null;
};

export type ReviewMode = 'human' | 'agent_advisory' | 'agent_autonomous';

export const REVIEW_MODE_OPTIONS: Array<{ value: ReviewMode; label: string; desc: string }> = [
  { value: 'human',            label: 'HUMANA',     desc: 'default — Rica revisa manualmente' },
  { value: 'agent_advisory',   label: 'ADVISORY',   desc: 'agente dá parecer, Rica confirma' },
  { value: 'agent_autonomous', label: 'AUTONOMOUS', desc: 'agente decide e segue (exige Success Criteria + evidence_refs)' },
];

export type ReviewAction = 'accept' | 'reject' | 'requeue';

export type ReviewActionPayload = {
  action: ReviewAction;
  note?: string | null;
  criteria_results?: Record<string, unknown> | null;
  evidence_refs?: string[] | null;
  content_hash?: string | null;
};

export type ReviewActionResponse = {
  event_id: number;
  new_status: TaskStatus;
  content_hash: string | null;
};

export type ReviewEvent = {
  id: number;
  task_id: string;
  agent_slug: string | null;
  instance_id: string | null;
  kind: 'review.accepted' | 'review.rejected' | 'review.requeued';
  payload: Record<string, unknown> | null;
  created_at: number;
  human_id: string | null;
  title: string | null;
  status: TaskStatus | null;
  assignee: string | null;
  reviewer_assignee: string | null;
  review_mode: ReviewMode | null;
  tags: string[] | null;
};

export type ReviewEventsResponse = {
  events: ReviewEvent[];
  next_since_id: number | null;
};

export type KanbanColumnId = 'queue' | 'running' | 'blocked' | 'review' | 'done';

export type KanbanColumn = {
  id: KanbanColumnId;
  name: string;
  tasks: Task[];
};

export type TaskEvent = {
  id: number;
  task_id: string | null;
  agent_slug: string | null;
  instance_id: string | null;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: number;
};

export type TaskHandoffResponse = {
  parent_id: string;
  child_id: string;
  tmux_delivered: boolean;
};

// ----- Agent modal (Fase 3): skills / docs / tables ------------------------

export type AgentSkill = {
  name: string;
  description: string;
  path: string;
  is_symlink: boolean;
  shared_from: string | null;
  size_bytes: number;
  updated_at: number;
};

export type AgentSkillsResponse = {
  slug: string;
  skills: AgentSkill[];
  count: number;
};

export type AgentDocMeta = {
  filename: string;
  title: string | null;
  size_bytes: number;
  updated_at: number;
};

export type AgentDocsResponse = {
  slug: string;
  docs: AgentDocMeta[];
  count: number;
};

export type AgentDocResolved = {
  slug: string;
  filename: string;
  content_md: string;
  truncated: boolean;
};

export type AgentTable = {
  name: string;
  db: string;
  description?: string;
};

export type AgentTablesResponse = {
  slug: string;
  tables: AgentTable[];
  count: number;
};

export type SubagentEntry = {
  subsession_id: string;
  agent_slug: string;
  task_id: string | null;
  visibility: boolean;
  status: string;
  session_name: string;
  started_at: number;
  spawned_by_tool: boolean;
};

export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function formatLastSeen(lastSeen: number | null, serverNow: number): string {
  if (lastSeen === null) return '—';
  const deltaSec = Math.max(0, serverNow - lastSeen);
  if (deltaSec < 60) return `há ${deltaSec}s`;
  const m = Math.floor(deltaSec / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `há ${h}h` : `há ${h}h${String(rem).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function shortModelName(model: string): string {
  const map: Record<string, string> = {
    'claude-opus-4-7':    'Opus 4.7',
    'claude-opus-4-5':    'Opus 4.5',
    'claude-sonnet-4-6':  'Sonnet 4.6',
    'claude-haiku-4-5':   'Haiku 4.5',
    'codex-gpt-5-5':      'GPT-5.5',
    'codex-gpt-5-4':      'GPT-5.4',
    'codex-gpt-5-4-mini': 'GPT-5.4m',
  };
  return map[model] ?? model;
}

export function parseContextPct(excerpt: string | null): number | null {
  if (!excerpt) return null;
  const m = excerpt.match(/(\d+)%/);
  return m ? parseInt(m[1]!, 10) : null;
}

export function parseModelFromPane(excerpt: string | null): string | null {
  if (!excerpt) return null;
  // CC statusline aparece em dois formatos:
  //   "Sonnet 4.6 - 40:26:47 - [███░] 32%"
  //   "Sonnet 4.6 (200k context) - [███░] 81%"
  // Pega o último match — statusline fica no fim do pane.
  const re = /\b(Opus|Sonnet|Haiku)\s+(\d+\.\d+)\b/g;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(excerpt); m !== null; m = re.exec(excerpt)) {
    last = m;
  }
  return last ? `${last[1]} ${last[2]}` : null;
}
