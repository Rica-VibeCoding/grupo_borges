'use client';

import { useFleet } from '../lib/fleet-context';
import type { Agent, AgentStatus } from '../lib/cockpit-types';

function formatClock(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} -03:00`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const FLEET_BAR_ORDER: AgentStatus[] = ['running', 'blocked', 'done', 'idle', 'offline'];

const STATUS_BAR_CLASS: Record<AgentStatus, string> = {
  running: 'f-running',
  blocked: 'f-blocked',
  done: 'f-done',
  idle: 'f-idle',
  offline: 'f-offline',
};

function fleetBars(agents: Agent[]): AgentStatus[] {
  return FLEET_BAR_ORDER.flatMap((s) => agents.filter((a) => a.status === s).map(() => s));
}

export function KpiStrip() {
  const { fleet, sseStatus } = useFleet();
  const { kpis, health, agents } = fleet;
  const active = kpis.running + kpis.blocked + kpis.done + kpis.idle;
  const offline = sseStatus === 'closed';
  const bars = fleetBars(agents);

  const sysBadge = offline ? 'DOWN' : 'OK';
  const sysSub = offline ? 'FASTAPI · SSE · DROP' : 'FASTAPI · SSE · 200';
  const lastSync = health.last_sync ? formatClock(health.last_sync) : '— —';
  const heartbeatLabel = offline ? '— —' : `${health.offline_threshold_seconds}s`;

  return (
    <div className="kpi-strip" role="group" aria-label="Fleet KPIs">
      <div className="kpi-tile scan-host" data-state="ok">
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING</span></div>
        <div className="kpi-head"><span className="tag">FLEET</span><span>AGENTS ACTIVE</span></div>
        <div className="kpi-num"><span>{pad2(active)}</span><span className="total">/ {pad2(kpis.total)}</span></div>
        <div className="kpi-bars" aria-hidden="true">
          {bars.map((status, i) => (
            <div key={i} className={`b ${STATUS_BAR_CLASS[status]}`} />
          ))}
        </div>
      </div>
      <div className="kpi-tile scan-host" data-state="ok">
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING</span></div>
        <div className="kpi-head"><span className="tag">EXEC</span><span>NOW</span></div>
        <div className="kpi-num"><span>{pad2(kpis.tasks_running)}</span></div>
        <div className="kpi-sub">TASKS · RUNNING</div>
      </div>
      <div className="kpi-tile scan-host" data-state={kpis.tasks_blocked > 0 ? 'alert' : 'ok'}>
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING</span></div>
        <div className="kpi-head">
          <span className="tag" style={{ color: 'var(--status-blocked)' }}>HOLD</span>
          <span>AWAITING</span>
        </div>
        <div className="kpi-num"><span>{pad2(kpis.tasks_blocked)}</span></div>
        <div className="kpi-sub"><span className="warn">TASKS · BLOCKED</span></div>
      </div>
      <div className="kpi-tile scan-host" data-state={kpis.offline > 0 ? 'alert' : 'ok'}>
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING</span></div>
        <div className="kpi-head">
          <span className="tag" style={{ color: 'var(--status-blocked)' }}>FAULT</span>
          <span>OFFLINE</span>
        </div>
        <div className="kpi-num"><span>{pad2(kpis.offline)}</span><span className="unit">agt</span></div>
        <div className="kpi-sub"><span className="warn">▸ no heartbeat &gt; {health.offline_threshold_seconds}s</span></div>
      </div>
      <div className="kpi-tile scan-host" data-state={offline ? 'alert' : 'ok'}>
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING UPLINK</span></div>
        <div className="kpi-head"><span className="tag">UPLINK</span><span>SYSTEM HEALTH</span></div>
        <div className="kpi-sys">
          <div className="kpi-sys-left">
            <span className="kpi-sys-badge">{sysBadge}</span>
            <span className="kpi-sub">{sysSub}</span>
          </div>
          <div className="divider" />
          <div className="kpi-sys-right">
            <div className="row"><span className="k">LAST SYNC</span><span className={offline ? 'v warn' : 'v ok'}>{lastSync}</span></div>
            <div className="row"><span className="k">HEARTBEAT</span><span className="v">{heartbeatLabel}</span></div>
            <div className="row"><span className="k">AGENTS</span><span className="v">{pad2(kpis.total)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
