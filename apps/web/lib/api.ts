import type {
  ActiveTaskStatus,
  AgentDocResolved,
  AgentDocsResponse,
  AgentInstanceCreate,
  AgentInstanceCreateResponse,
  AgentSkillsResponse,
  AgentTablesResponse,
  FleetResponse,
  ReviewAction,
  ReviewActionPayload,
  ReviewActionResponse,
  ReviewEventsResponse,
  ReviewMode,
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
  review_mode?: ReviewMode;
  reviewer_assignee?: string | null;
  tags?: string[] | null;
};

export type TaskDispatchResponse = {
  task: Task;
  run_id: number;
  event_id: number;
  tmux_delivered: boolean;
};

async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') return body.detail;
  } catch {
    // Keep the original fallback when the backend did not return JSON.
  }
  return fallback;
}

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
  if (!res.ok) throw new Error(await errorDetail(res, `dispatchTask failed: ${res.status}`));
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

export async function reviewTask(
  taskId: string,
  payload: ReviewActionPayload,
  reviewerSlug?: string | null,
): Promise<ReviewActionResponse>;
export async function reviewTask(
  taskId: string,
  action: ReviewAction,
  body?: Omit<ReviewActionPayload, 'action'>,
  reviewerSlug?: string | null,
): Promise<ReviewActionResponse>;
export async function reviewTask(
  taskId: string,
  actionOrPayload: ReviewAction | ReviewActionPayload,
  bodyOrReviewer?: Omit<ReviewActionPayload, 'action'> | string | null,
  reviewerMaybe?: string | null,
): Promise<ReviewActionResponse> {
  const payload: ReviewActionPayload =
    typeof actionOrPayload === 'string'
      ? {
          action: actionOrPayload,
          ...((bodyOrReviewer as Omit<ReviewActionPayload, 'action'> | undefined) ?? {}),
        }
      : actionOrPayload;
  const reviewerSlug =
    typeof actionOrPayload === 'string'
      ? reviewerMaybe
      : (bodyOrReviewer as string | null | undefined);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (reviewerSlug) headers['X-Reviewer-Slug'] = reviewerSlug;
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `reviewTask failed: ${res.status}`));
  return res.json();
}

export async function fetchReviews(
  filters: { reviewer?: string | null; since_id?: number | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<ReviewEventsResponse> {
  const qs = new URLSearchParams();
  if (filters.reviewer) qs.set('reviewer', filters.reviewer);
  if (filters.since_id !== null && filters.since_id !== undefined) {
    qs.set('since_id', String(filters.since_id));
  }
  qs.set('limit', String(filters.limit ?? 50));
  const res = await fetch(`/api/reviews?${qs.toString()}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(await errorDetail(res, `fetchReviews failed: ${res.status}`));
  return res.json();
}
