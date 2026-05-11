export type AgentStatus = 'running' | 'idle' | 'blocked' | 'done' | 'offline';

export type SparklineBucket = {
  bucket: string;
  count: number;
};

export type AgentInstance = {
  agent_slug: string;
  instance_num: number;
  tmux_session: string | null;
  cli: string | null;
  model: string | null;
  is_subagent: boolean;
  status: AgentStatus;
  created_at: number;
  updated_at: number;
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
  last_seen: number | null;
  pane_excerpt: string | null;
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
};

export type FleetResponse = {
  agents: Agent[];
  kpis: FleetKpis;
  health: FleetHealth;
};

export type TaskStatus = 'backlog' | 'running' | 'review' | 'blocked' | 'done' | 'archived';

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
