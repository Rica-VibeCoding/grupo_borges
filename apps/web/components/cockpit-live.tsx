'use client';

import { useEffect } from 'react';
import { AgentCards } from './agent-card';
import { KanbanBoard } from './kanban-board';
import { useFleetStream, type FleetState } from '../lib/use-fleet-stream';

export function CockpitLive({ initial }: { initial: FleetState }) {
  const { fleet, tasks, sseStatus } = useFleetStream(initial);

  useEffect(() => {
    document.body.dataset.sse = sseStatus === 'open' ? 'on' : 'off';
  }, [sseStatus]);

  return (
    <>
      <div className="section-label" aria-hidden="true">
        <span className="num-tag">03</span>
        <span>FLEET · {String(fleet.agents.length).padStart(2, '0')} AGENTS · LIVE</span>
        <span className="rule" />
        <span className="endcap">order: status · running first</span>
      </div>
      <AgentCards agents={fleet.agents} serverNow={fleet.health.server_now} />
      <div className="section-label" aria-hidden="true">
        <span className="num-tag">04</span>
        <span>KANBAN · TASK STREAM</span>
        <span className="rule" />
        <span className="endcap">aria-live: polite</span>
      </div>
      <KanbanBoard tasks={tasks} serverNow={fleet.health.server_now} />
    </>
  );
}
