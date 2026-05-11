'use client';

import { ActivityFeed } from './activity-feed';
import { AgentCards } from './agent-card';
import { KanbanBoard } from './kanban-board';
import { useFleet } from '../lib/fleet-context';

export function CockpitLive() {
  const { fleet, tasks } = useFleet();
  return (
    <>
      <div className="section-label" aria-hidden="true">
        <span className="num-tag">03</span>
        <span>FROTA · {String(fleet.agents.length).padStart(2, '0')} AGENTES · AO VIVO</span>
        <span className="rule" />
        <span className="endcap">ordem: status · executando primeiro</span>
      </div>
      <AgentCards
        agents={fleet.agents}
        serverNow={fleet.health.server_now}
        staleThresholdSeconds={fleet.health.stale_threshold_seconds}
      />
      <div className="section-label" aria-hidden="true">
        <span className="num-tag">04</span>
        <span>KANBAN · FLUXO DE TAREFAS</span>
        <span className="rule" />
        <span className="endcap">aria-live: educado</span>
      </div>
      <KanbanBoard tasks={tasks} serverNow={fleet.health.server_now} />
      <div className="section-label" aria-hidden="true">
        <span className="num-tag">05</span>
        <span>ATIVIDADE · AO VIVO</span>
        <span className="rule" />
        <span className="endcap">últimos 40 eventos · SSE</span>
      </div>
      <ActivityFeed />
    </>
  );
}
