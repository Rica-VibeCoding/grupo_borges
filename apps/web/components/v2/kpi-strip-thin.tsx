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

const OFFLINE_STALE_SECONDS = 3600;

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
  const offlineAgents = agents.filter((agent) => agent.status === 'offline');
  const staleOffline = offlineAgents.filter((agent) => {
    if (agent.last_seen === null) return true;
    return now - agent.last_seen > OFFLINE_STALE_SECONDS;
  });
  const sseDown = sseStatus !== 'open';
  const noneActive = kpis.total > 0 && agentesAtivos === 0;
  const hasFailure = sseDown || noneActive;
  const hasAttention = blockedTasks.length > 0 || staleOffline.length > 0;
  const statusGeral: StatusGeral = hasFailure ? 'falha' : hasAttention ? 'atencao' : 'ok';
  const firstStale = staleOffline[0];
  const firstStaleElapsed = firstStale?.last_seen
    ? formatElapsed(now - firstStale.last_seen)
    : '—';
  const staleLabel = staleOffline.length > 0
    ? staleOffline.length === 1
      ? `${firstStale?.name} offline há ${firstStaleElapsed}`
      : `${firstStale?.name} offline há ${firstStaleElapsed} · +${staleOffline.length - 1} offline`
    : null;
  const lastSync = health.last_sync ? formatClock(health.last_sync) : '— —';
  const blockedLabel = tasksBlocked.length === 1
    ? `1 tarefa parada · ${tasksBlocked[0]}`
    : `${tasksBlocked.length} tarefas paradas · ${tasksBlocked.join(' ')}`;
  const failureLabel = sseDown ? 'Cockpit sem conexão ao vivo' : 'nenhum agente ativo agora';
  const mobilePrimary = statusGeral === 'falha'
    ? failureLabel
    : statusGeral === 'atencao'
      ? tasksBlocked.length > 0 ? blockedLabel : staleLabel
      : null;
  const mobileSecondary = [
    `${agentesAtivos}/${kpis.total} ativos`,
    offlineCount > 0 && statusGeral !== 'atencao' ? `${offlineCount} offline` : null,
    exec > 0 ? `${exec} trabalhando` : null,
    aguardando > 0 ? `${aguardando} aguardando` : null,
    sseDown && statusGeral !== 'falha' ? 'sem conexão ao vivo' : null,
    `visto ${lastSync}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="kpi-thin mono" data-state={statusGeral} role="group" aria-label="Status da frota">
      <span className="kt-dot" aria-hidden="true" />
      <span className="kt-main">{statusGeral === 'falha' ? 'EM FALHA' : statusGeral === 'atencao' ? 'ATENÇÃO' : 'OK'}</span>
      {statusGeral === 'falha' && (
        <span className="kt-meta kt-desktop-meta">
          <span className="kt-sep"> · </span>
          {failureLabel}
        </span>
      )}
      {statusGeral === 'atencao' && tasksBlocked.length > 0 && (
        <span className="kt-meta kt-desktop-meta">
          <span className="kt-sep"> · </span>
          {blockedLabel}
        </span>
      )}
      {statusGeral === 'atencao' && staleLabel && (
        <span className="kt-meta kt-desktop-meta">
          <span className="kt-sep"> · </span>
          {staleLabel}
        </span>
      )}
      {mobilePrimary && <span className="kt-mobile-meta kt-mobile-primary">{mobilePrimary}</span>}
      <span className="kt-mobile-meta kt-mobile-secondary">{mobileSecondary}</span>
      <span className="kt-meta kt-desktop-meta"><span className="kt-sep"> · </span>{agentesAtivos}/{kpis.total} ativos</span>
      {offlineCount > 0 && statusGeral !== 'atencao' && (
        <span className="kt-meta kt-desktop-meta"><span className="kt-sep"> · </span>{offlineCount} offline</span>
      )}
      {exec > 0 && <span className="kt-meta kt-desktop-meta"><span className="kt-sep"> · </span>{exec} trabalhando</span>}
      {aguardando > 0 && <span className="kt-meta kt-desktop-meta"><span className="kt-sep"> · </span>{aguardando} aguardando</span>}
      {sseDown && statusGeral !== 'falha' && <span className="kt-meta kt-desktop-meta"><span className="kt-sep"> · </span>sem conexão ao vivo</span>}
      <span className="kt-hb kt-desktop-meta"> · visto {lastSync}</span>
    </div>
  );
}
