import type { FleetResponse, Task } from './cockpit-types';

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
