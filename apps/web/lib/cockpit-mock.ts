import type { FleetResponse, Task, TaskEvent } from './cockpit-types';

export const EMPTY_FLEET: FleetResponse = {
  agents: [],
  kpis: {
    total: 0,
    running: 0,
    blocked: 0,
    idle: 0,
    done: 0,
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
  },
};

export const EMPTY_TASKS: Task[] = [];

export const EMPTY_EVENTS: TaskEvent[] = [];
