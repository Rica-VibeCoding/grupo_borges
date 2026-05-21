import type { FleetResponse, Task, TaskEvent } from './cockpit-types';

export const EMPTY_FLEET: FleetResponse = {
  agents: [],
  kpis: {
    total: 0,
    trabalhando: 0,
    aguardando: 0,
    ocioso: 0,
    offline: 0,
    tasks_active: 0,
    tasks_running: 0,
    tasks_blocked: 0,
    tasks_done: 0,
  },
  health: {
    last_sync: null,
    server_now: Math.floor(Date.now() / 1000),
    offline_threshold_seconds: 300,
    stale_threshold_seconds: 600,
  },
};

export const EMPTY_TASKS: Task[] = [];

export const EMPTY_EVENTS: TaskEvent[] = [];
