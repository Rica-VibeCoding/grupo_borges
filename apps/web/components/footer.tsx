'use client';

import { useFleet } from '../lib/fleet-context';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function Footer() {
  const { fleet, sseStatus } = useFleet();
  const { kpis, health } = fleet;
  const offline = sseStatus === 'closed';
  const fastapiLabel = offline ? 'DROP' : '200';
  const fastapiClass = offline ? 'v danger' : 'v ok';
  const heartbeat = offline ? '— —' : `${health.offline_threshold_seconds}s`;

  return (
    <footer className="footer" role="contentinfo">
      <div className="grp">
        <span className="sb-item"><span className="k">WORKSPACE</span><span className="v">cockpit.grupo_borges.vps</span></span>
        <span className="sep" />
        <span className="sb-item"><span className="k">ENV</span><span className="v">prod</span></span>
        <span className="sep" />
        <span className="sb-item"><span className="k">USER</span><span className="v">@pavan</span></span>
      </div>
      <span className="spacer" />
      <div className="grp">
        <span className="sb-item sb-fastapi">
          <span className="heartbeat-dot" aria-hidden="true" />
          <span className="k">FASTAPI</span>
          <span className={fastapiClass}>{fastapiLabel}</span>
        </span>
        <span className="sep" />
        <span className="sb-item"><span className="k">RUN</span><span className="v cy">{pad2(kpis.tasks_running)}</span></span>
        <span className="sep" />
        <span className="sb-item"><span className="k">BLK</span><span className="v warn">{pad2(kpis.tasks_blocked)}</span></span>
        <span className="sep" />
        <span className="sb-item"><span className="k">HB</span><span className="v">{heartbeat}</span></span>
      </div>
    </footer>
  );
}
