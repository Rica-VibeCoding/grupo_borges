export function KpiStrip() {
  return (
    <div className="kpi-strip" role="group" aria-label="Fleet KPIs">
      <div className="kpi-tile scan-host" data-state="ok">
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING</span></div>
        <div className="kpi-head"><span className="tag">FLEET</span><span>AGENTS ACTIVE</span></div>
        <div className="kpi-num"><span>04</span><span className="total">/ 06</span></div>
        <div className="kpi-bars" aria-hidden="true">
          <div className="b f-running" /><div className="b f-running" />
          <div className="b f-blocked" /><div className="b f-idle" />
          <div className="b f-done" /><div className="b f-offline" />
        </div>
      </div>
      <div className="kpi-tile scan-host" data-state="ok">
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING</span></div>
        <div className="kpi-head"><span className="tag">EXEC</span><span>▲ 24H</span></div>
        <div className="kpi-num"><span>03</span></div>
        <div className="kpi-sub">TASKS · RUNNING</div>
      </div>
      <div className="kpi-tile scan-host" data-state="alert">
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING</span></div>
        <div className="kpi-head"><span className="tag" style={{ color: 'var(--status-blocked)' }}>HOLD</span><span>AWAITING</span></div>
        <div className="kpi-num"><span>01</span></div>
        <div className="kpi-sub"><span className="warn">TASKS · BLOCKED</span></div>
      </div>
      <div className="kpi-tile scan-host" data-state="alert">
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING</span></div>
        <div className="kpi-head"><span className="tag" style={{ color: 'var(--status-blocked)' }}>FAULT</span><span>LAST 24H</span></div>
        <div className="kpi-num"><span>03</span><span className="unit">err</span></div>
        <div className="kpi-sub"><span className="warn">▸ 2 unhandled · 1 retried</span></div>
      </div>
      <div className="kpi-tile scan-host" data-state="ok">
        <div className="scan" aria-hidden="true" />
        <div className="kpi-skel"><span className="lbl">CONNECTING UPLINK</span></div>
        <div className="kpi-head"><span className="tag">UPLINK</span><span>SYSTEM HEALTH</span></div>
        <div className="kpi-sys">
          <div className="kpi-sys-left">
            <span className="kpi-sys-badge" id="sysBadge">OK</span>
            <span className="kpi-sub" id="sysSub">FASTAPI · SSE · 200</span>
          </div>
          <div className="divider" />
          <div className="kpi-sys-right">
            <div className="row"><span className="k">LAST SYNC</span><span className="v ok" id="sysSync">14:22:01 -03:00</span></div>
            <div className="row"><span className="k">HEARTBEAT</span><span className="v" id="sysHb">1.2s</span></div>
            <div className="row"><span className="k">RTT</span><span className="v" id="sysRtt">24ms</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
