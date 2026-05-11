export function CockpitHeader() {
  return (
    <header className="header mono" role="banner">
      <div className="h-brand">
        <span className="brand-glyph" aria-hidden="true">gb</span>
        <div className="brand-stack">
          <span className="brand-title">cockpit</span>
          <span className="brand-sub">grupo_borges · fleet ops</span>
        </div>
      </div>
      <div className="h-meta">
        <span className="item"><span className="k">VER</span><span className="v">v0.4.7</span></span>
        <span className="sep" />
        <span className="item"><span className="k">BUILD</span><span className="v">7543b3c</span></span>
        <span className="sep" />
        <span className="item uplink"><span className="k">UPLINK</span><span className="v">tailscale·serve</span></span>
        <span className="sep" />
        <span className="item"><span className="k">REGION</span><span className="v">sa-east-1</span></span>
      </div>
      <div className="h-right">
        <button className="h-cmd" id="cmdkOpen" type="button" aria-label="Open command palette"><span>search</span><span className="kbd">⌘K</span></button>
        <span className="h-clock"><span className="live" aria-hidden="true" /><span id="clock">T+ 14:22:01</span></span>
        <div className="theme-toggle" role="group" aria-label="Theme">
          <button type="button" data-theme-set="dark" aria-pressed="true" aria-label="Dark theme">DARK</button>
          <button type="button" data-theme-set="light" aria-pressed="false" aria-label="Light theme">LIGHT</button>
        </div>
        <button className="h-icon" type="button" aria-label="Settings">⚙</button>
      </div>
    </header>
  );
}
