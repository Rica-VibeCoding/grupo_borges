import type {
  ActiveTaskStatus,
  AgentDocResolved,
  AgentDocsResponse,
  AgentInstanceCreate,
  AgentInstanceCreateResponse,
  AgentSkillsResponse,
  AgentTablesResponse,
  FleetResponse,
  Task,
  TaskHandoffResponse,
  TaskEvent,
  TaskStatus,
} from './cockpit-types';

const SERVER_API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

export type TaskPatchStatus = Exclude<TaskStatus, 'archived'>;

export type TaskCreatePayload = {
  title: string;
  assignee: string;
  body?: string | null;
  status?: TaskPatchStatus;
  priority?: number;
  idempotency_key?: string | null;
};

export type TaskDispatchResponse = {
  task: Task;
  run_id: number;
  event_id: number;
  tmux_delivered: boolean;
};

export async function fetchFleet(): Promise<FleetResponse> {
  const res = await fetch(`${SERVER_API_BASE}/api/fleet`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchFleet failed: ${res.status}`);
  return res.json();
}

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(`${SERVER_API_BASE}/api/tasks`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchTasks failed: ${res.status}`);
  return res.json();
}

export async function fetchTask(taskId: string, signal?: AbortSignal): Promise<Task> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchTask failed: ${res.status}`);
  return res.json();
}

export async function patchTaskStatus(taskId: string, status: TaskPatchStatus): Promise<Task> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`patchTaskStatus failed: ${res.status}`);
  return res.json();
}

export async function createTask(payload: TaskCreatePayload): Promise<Task> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status}`);
  return res.json();
}

export async function dispatchTask(taskId: string, note?: string | null): Promise<TaskDispatchResponse> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: note?.trim() || null }),
  });
  if (!res.ok) throw new Error(`dispatchTask failed: ${res.status}`);
  return res.json();
}

export async function fetchEvents(limit = 50): Promise<TaskEvent[]> {
  const res = await fetch(`${SERVER_API_BASE}/api/events?limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchEvents failed: ${res.status}`);
  return res.json();
}

// Client-side (modal): usa rewrite do next.config.ts pra /api/* → backend.
export async function fetchAgentSkills(slug: string, signal?: AbortSignal): Promise<AgentSkillsResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/skills`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchAgentSkills failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentDocs(slug: string, signal?: AbortSignal): Promise<AgentDocsResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/docs`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchAgentDocs failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentDoc(slug: string, filename: string, signal?: AbortSignal): Promise<AgentDocResolved> {
  const url = `/api/agents/${encodeURIComponent(slug)}/docs?filename=${encodeURIComponent(filename)}`;
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchAgentDoc failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentTables(slug: string, signal?: AbortSignal): Promise<AgentTablesResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/tables`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchAgentTables failed: ${res.status}`);
  return res.json();
}

export async function createAgentInstance(
  slug: string,
  payload: AgentInstanceCreate,
): Promise<AgentInstanceCreateResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createAgentInstance failed: ${res.status}`);
  return res.json();
}

export async function deleteAgentInstance(slug: string, instanceId: string): Promise<void> {
  const res = await fetch(
    `/api/agents/${encodeURIComponent(slug)}/instances/${encodeURIComponent(instanceId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`deleteAgentInstance failed: ${res.status}`);
}

export async function listAgentTasks(
  slug: string,
  statuses: ActiveTaskStatus[] = ['running', 'ready', 'backlog'],
  signal?: AbortSignal,
): Promise<Task[]> {
  const qs = new URLSearchParams({
    assignee: slug,
    status: statuses.join(','),
  });
  const res = await fetch(`/api/tasks?${qs.toString()}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`listAgentTasks failed: ${res.status}`);
  return res.json();
}

export async function postTaskHandoff(
  taskId: string,
  payload: { to_agent: string; note?: string | null; idempotency_key: string },
): Promise<TaskHandoffResponse> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`postTaskHandoff failed: ${res.status}`);
  return res.json();
}
