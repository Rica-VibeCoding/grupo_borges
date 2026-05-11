import type {
  AgentDocResolved,
  AgentDocsResponse,
  AgentSkillsResponse,
  AgentTablesResponse,
  FleetResponse,
  Task,
  TaskEvent,
} from './cockpit-types';

const SERVER_API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

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
