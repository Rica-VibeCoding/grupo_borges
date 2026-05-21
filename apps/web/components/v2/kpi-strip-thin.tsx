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
  const blockedTasks = tasks.filter((task) => task.status === 'blocked');
  const tasksBlocked = blockedTasks.map((task) => task.human_id);
  const exec = kpis.trabalhando;
  const aguardando = kpis.aguardando;
  const agentesAtivos = kpis.trabalhando + kpis.aguardando + kpis.ocioso;
  const offlineCount = kpis.offline;
  const sseDown = sseStatus !== 'open';
  const noneActive = kpis.total > 0 && agentesAtivos === 0;
  const hasFailure = sseDown || noneActive;
  const hasAttention = blockedTasks.length > 0 || offlineCount > 0;
  const statusGeral: StatusGeral = hasFailure ? 'falha' : hasAttention ? 'atencao' : 'ok';
  const offlineAgents = agents.filter((agent) => agent.status === 'offline');
  const firstOffline = offlineAgents[0];
  const firstOfflineElapsed = firstOffline?.last_seen
    ? formatElapsed(now - firstOffline.last_seen)
    : '—';
  const offlineLabel = offlineCount > 0
    ? offlineCount === 1
      ? `${firstOffline?.name} offline há ${firstOfflineElapsed}`
      : `${offlineCount} offline · ${firstOffline?.name} há ${firstOfflineElapsed}`
    : null;
  const lastSync = health.last_sync ? formatClock(health.last_sync) : '— —';

  return (
    <div className="kpi-thin mono" data-state={statusGeral} role="group" aria-label="Status da frota">
      <span className="kt-dot" aria-hidden="true" />
      <span className="kt-main">{statusGeral === 'falha' ? 'EM FALHA' : statusGeral === 'atencao' ? 'ATENÇÃO' : 'OK'}</span>
      {statusGeral === 'falha' && (
        <span className="kt-meta">
          <span className="kt-sep"> · </span>
          {sseDown ? 'uplink down' : 'sem zés ativos'}
        </span>
      )}
      {statusGeral === 'atencao' && tasksBlocked.length > 0 && (
        <span className="kt-meta">
          <span className="kt-sep"> · </span>
          {tasksBlocked.length} BLOQ · {tasksBlocked.join(' ')}
        </span>
      )}
      {statusGeral === 'atencao' && offlineLabel && (
        <span className="kt-meta">
          <span className="kt-sep"> · </span>
          {offlineLabel}
        </span>
      )}
      <span className="kt-meta"><span className="kt-sep"> · </span>{agentesAtivos}/{kpis.total} ativos</span>
      {exec > 0 && <span className="kt-meta"><span className="kt-sep"> · </span>exec {exec}</span>}
      {aguardando > 0 && <span className="kt-meta"><span className="kt-sep"> · </span>ag aguard {aguardando}</span>}
      {sseDown && statusGeral !== 'falha' && <span className="kt-meta"><span className="kt-sep"> · </span>uplink down</span>}
      <span className="kt-hb"> · hb {lastSync}</span>
    </div>
  );
}
