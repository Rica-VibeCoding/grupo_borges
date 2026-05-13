'use client';

import { useFleet } from '../../lib/fleet-context';
import { formatClock } from '../../lib/format-time';

type StatusGeral = 'ok' | 'atencao' | 'falha';

function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
}

export function KpiStripThin() {
  const { fleet, tasks, sseStatus } = useFleet();
  const { agents, health, kpis } = fleet;
  const now = health.server_now || Math.floor(Date.now() / 1000);
  const threshold = health.offline_threshold_seconds;
  const staleOfflineAgents = agents.filter((agent) => {
    if (agent.status !== 'offline') return false;
    if (agent.last_seen === null) return true;
    return now - agent.last_seen > threshold;
  });
  const blockedTasks = tasks.filter((task) => task.status === 'blocked');
  const tasksBlocked = blockedTasks.map((task) => task.human_id);
  const hasFailure = sseStatus === 'closed' || staleOfflineAgents.length > 0;
  const statusGeral: StatusGeral = hasFailure ? 'falha' : blockedTasks.length > 0 ? 'atencao' : 'ok';
  const exec = kpis.running;
  const blocked = kpis.blocked;
  const agentesAtivos = kpis.running + kpis.idle + kpis.blocked + kpis.done;
  const falhaList = agents.filter((agent) => agent.status === 'offline').map((agent) => agent.name);
  const falhaNames = falhaList.slice(0, 2).join(' ');
  const falhaAgent = staleOfflineAgents[0] ?? agents.find((agent) => agent.status === 'offline');
  const falhaElapsed = falhaAgent?.last_seen === null || falhaAgent?.last_seen === undefined
    ? '—'
    : formatElapsed(now - falhaAgent.last_seen);
  const lastSync = health.last_sync ? formatClock(health.last_sync) : '— —';

  return (
    <div className="kpi-thin mono" data-state={statusGeral} role="group" aria-label="Status da frota">
      <span className="kt-dot" aria-hidden="true" />
      <span className="kt-main">{statusGeral === 'falha' ? 'EM FALHA' : statusGeral === 'atencao' ? 'ATENÇÃO' : 'OK'}</span>
      {statusGeral === 'falha' && (
        <span className="kt-meta">
          <span className="kt-sep"> · </span>
          {falhaAgent ? `${falhaNames} sem heartbeat há ${falhaElapsed}` : 'uplink sem heartbeat'}
        </span>
      )}
      {statusGeral === 'atencao' && (
        <span className="kt-meta">
          <span className="kt-sep"> · </span>
          {tasksBlocked.length} BLOQ{tasksBlocked.length > 0 ? ` · ${tasksBlocked.join(' ')}` : ''}
        </span>
      )}
      <span className="kt-meta"><span className="kt-sep"> · </span>{agentesAtivos}/{kpis.total} ativos</span>
      {exec > 0 && <span className="kt-meta"><span className="kt-sep"> · </span>exec {exec}</span>}
      {blocked > 0 && <span className="kt-meta"><span className="kt-sep"> · </span>ag bloq {blocked}</span>}
      {sseStatus !== 'open' && <span className="kt-meta"><span className="kt-sep"> · </span>uplink down</span>}
      <span className="kt-hb"> · hb {lastSync}</span>
    </div>
  );
}
