'use client';

import { AgentCards } from '../agent-card';
import { KanbanBoard } from '../kanban-board';
import { useFleet } from '../../lib/fleet-context';

export function CockpitLiveV2() {
  const { fleet, tasks } = useFleet();
  return (
    <div className="v2-shell">
      <aside className="v2-sidebar" aria-label="Frota de agentes">
        <div className="section-label" aria-hidden="true">
          <span className="num-tag">03</span>
          <span>FROTA · {String(fleet.agents.length).padStart(2, '0')}</span>
          <span className="rule" />
        </div>
        <AgentCards agents={fleet.agents} serverNow={fleet.health.server_now} />
      </aside>
      <main className="v2-main">
        <KanbanBoard tasks={tasks} />
      </main>
    </div>
  );
}
