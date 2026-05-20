import type {
  ActiveTaskStatus,
  AgentDocResolved,
  AgentDocsResponse,
  AgentPainelResponse,
  AgentSkillsResponse,
  AgentTablesResponse,
  FleetResponse,
  ReviewAction,
  ReviewActionPayload,
  ReviewActionResponse,
  ReviewEventsResponse,
  ReviewMode,
  SubagentEntry,
  Task,
  TaskHandoffResponse,
  TaskEvent,
  TaskStatus,
} from './cockpit-types';
import { safeUUID } from './ids';

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

export type TaskPatchPayload = {
  title?: string;
  body?: string | null;
  assignee?: string;
  status?: TaskPatchStatus;
  priority?: number;
  review_mode?: ReviewMode;
  reviewer_assignee?: string | null;
  tags?: string[] | null;
  instance_id?: string | null;
  skill_hint?: string | null;
};

export async function patchTask(taskId: string, fields: TaskPatchPayload): Promise<Task> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `patchTask failed: ${res.status}`));
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

export async function fetchAgentPainel(slug: string, signal?: AbortSignal): Promise<AgentPainelResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/painel`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(await errorDetail(res, `fetchAgentPainel failed: ${res.status}`));
  return res.json();
}

export async function patchAgentEffort(
  slug: string,
  effort: string,
): Promise<{ slug: string; effort: string; source: string; session_may_diverge: boolean; written: boolean }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/effort`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ effort }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `patchAgentEffort failed: ${res.status}`));
  return res.json();
}

// ----- DS-2: chat / model endpoints --------------------------------------

export type ChatModelSlug = 'opus' | 'sonnet' | 'haiku';

export type AgentInputResponse = {
  tmux_delivered: boolean;
  sent_at: number;
};

export type AgentModelChangeResponse = {
  tmux_delivered: boolean;
  state_persisted: boolean;
  confirmed: boolean;
  model: string;
};

export class AgentInputError extends Error {
  constructor(message: string, readonly status: number, readonly detail: string | null) {
    super(message);
    this.name = 'AgentInputError';
  }
}

export async function postAgentInput(
  slug: string,
  text: string,
): Promise<AgentInputResponse> {
  const idempotency_key = safeUUID();
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, idempotency_key }),
  });
  if (!res.ok) {
    const detail = await errorDetail(res, `postAgentInput failed: ${res.status}`);
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

export async function postAgentImage(
  slug: string,
  file: File,
  caption?: string,
): Promise<{ tmux_delivered: boolean }> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  if (caption?.trim()) fd.append('caption', caption.trim());
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/image`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const detail = await errorDetail(
      res,
      res.status === 404 || res.status === 501
        ? 'endpoint de imagem não disponível ainda (back-end pendente)'
        : `postAgentImage failed: ${res.status}`,
    );
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

export async function postAgentDestrava(
  slug: string,
): Promise<{ tmux_delivered: boolean; sent_at: number }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/destrava`, {
    method: 'POST',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`postAgentDestrava ${res.status}: ${txt}`);
  }
  return res.json();
}

export async function postAgentVoice(
  slug: string,
  audioBlob: Blob,
): Promise<{ transcribed: string; tmux_delivered: boolean; duration_ms: number }> {
  const fd = new FormData();
  // Extensão segue o mime real do blob. Server confia no Content-Type, mas
  // filename correto ajuda em debug/log.
  const ext = audioBlob.type.includes('mp4')
    ? 'mp4'
    : audioBlob.type.includes('ogg')
      ? 'ogg'
      : 'webm';
  fd.append('audio', audioBlob, `voice.${ext}`);
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/voice`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`postAgentVoice ${res.status}: ${txt}`);
  }
  return res.json();
}

export async function postAgentModel(
  slug: string,
  model: ChatModelSlug,
  options?: { force?: boolean },
): Promise<AgentModelChangeResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, force: options?.force ?? false }),
  });
  if (!res.ok) {
    const detail = await errorDetail(res, `postAgentModel failed: ${res.status}`);
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

// Mapeia state_model/model_default longo (claude-opus-4-7, etc) pro slug curto
// aceito pelo POST /model (whitelist opus|sonnet|haiku). Codex retorna null —
// caller decide se renderiza dropdown (não renderiza pra Codex).
export function toShortModelSlug(model: string | null | undefined): ChatModelSlug | null {
  if (!model) return null;
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';
  return null;
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

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await errorDetail(res, `deleteTask failed: ${res.status}`));
}

export type SubsessionSpawnPayload = {
  task_id: string;
  prompt: string;
  visibility: boolean;
  skill?: string;
};

export type SubsessionSpawnResult = {
  subsession_id: string;
  session_name: string;
  status: string;
};

export async function spawnSubsession(
  agentSlug: string,
  payload: SubsessionSpawnPayload,
): Promise<SubsessionSpawnResult> {
  const body = { ...payload, agent_slug: agentSlug };
  const res = await fetch(`/api/agents/${encodeURIComponent(agentSlug)}/subagents/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `spawnSubsession failed: ${res.status}`));
  return res.json();
}

// ----- JP-25: MCP painel inline -----------------------------------------

export type McpServerKind = 'plugin' | 'mcp_json' | 'remote' | 'user_scope' | 'agent_user';

export type McpProvides = 'skill' | 'mcp' | 'subagent' | 'hook' | 'lsp';

export type McpServer = {
  kind: McpServerKind;
  id: string;
  name: string;
  enabled: boolean;
  transport?: string | null;
  description?: string | null;
  command_redacted?: string | null;
  provides?: McpProvides[] | null;
};

export type AgentMcpResponse = { servers: McpServer[] };

export type AgentMcpPatchResponse = { applied: boolean; requires_reload: boolean };

export type AgentMcpReloadResponse = { tmux_delivered: boolean };

export async function getAgentMcp(slug: string, signal?: AbortSignal): Promise<AgentMcpResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/mcp`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(await errorDetail(res, `getAgentMcp failed: ${res.status}`));
  return res.json();
}

export async function patchAgentMcp(
  slug: string,
  kind: McpServerKind,
  id: string,
  enabled: boolean,
): Promise<AgentMcpPatchResponse> {
  const res = await fetch(
    `/api/agents/${encodeURIComponent(slug)}/mcp/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!res.ok) throw new Error(await errorDetail(res, `patchAgentMcp failed: ${res.status}`));
  return res.json();
}

export async function postAgentMcpReload(slug: string): Promise<AgentMcpReloadResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/mcp/reload`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await errorDetail(res, `postAgentMcpReload failed: ${res.status}`));
  return res.json();
}

export async function fetchTaskSubsessions(
  agentSlug: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<SubagentEntry[]> {
  const url = `/api/agents/${encodeURIComponent(agentSlug)}/subagents?task_id=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchTaskSubsessions failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.subagents ?? []);
}
