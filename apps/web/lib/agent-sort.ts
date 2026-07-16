import type { Agent, AgentStatus } from './cockpit-types';

const statusOrder: Record<AgentStatus, number> = {
  trabalhando: 0,
  aguardando: 1,
  ocioso: 2,
  offline: 3,
};

export function agentLastActivityAt(agent: Agent): number {
  return Math.max(
    agent.current_task_last_heartbeat ?? 0,
    agent.lifecycle_updated_at ?? 0,
    agent.last_seen ?? 0,
    agent.session_started_at ?? 0,
    agent.pane_session_started_at ?? 0,
    agent.updated_at ?? 0,
  );
}

export function compareAgentsByRecentActivity(a: Agent, b: Agent): number {
  const activityDelta = agentLastActivityAt(b) - agentLastActivityAt(a);
  if (activityDelta !== 0) return activityDelta;

  const statusDelta = statusOrder[a.status] - statusOrder[b.status];
  if (statusDelta !== 0) return statusDelta;

  return a.name.localeCompare(b.name);
}
