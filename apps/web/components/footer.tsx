export function Footer() {
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
        <span className="sb-item sb-fastapi"><span className="heartbeat-dot" aria-hidden="true" /><span className="k">FASTAPI</span><span className="v ok" id="fbFastapi">200</span></span>
        <span className="sep" />
        <span className="sb-item"><span className="k">RUN</span><span className="v cy">03</span></span>
        <span className="sep" />
        <span className="sb-item"><span className="k">BLK</span><span className="v warn">01</span></span>
        <span className="sep" />
        <span className="sb-item"><span className="k">HB</span><span className="v" id="fbHb">1.2s</span></span>
      </div>
      <div className="demo-strip mono" role="group" aria-label="Polish demo controls">
        <span className="dlabel">demo</span>
        <button type="button" className="demo-btn" data-mode="live" aria-pressed="true" aria-label="Live mode"><span className="dd" />LIVE</button>
        <button type="button" className="demo-btn" data-mode="loading" aria-pressed="false" aria-label="Loading scan mode"><span className="dd" />LOADING</button>
        <button type="button" className="demo-btn" data-mode="sse-off" aria-pressed="false" aria-label="SSE disconnected mode"><span className="dd" />SSE OFF</button>
        <button type="button" className="demo-fire" id="fireToast" aria-label="Fire reconnect toast">FIRE TOAST</button>
        <span className="demo-prm" aria-live="polite"><span>reduced-motion:</span><span className="v" id="prmFlag">off</span></span>
      </div>
    </footer>
  );
}
