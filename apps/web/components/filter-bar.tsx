export function FilterBar() {
  return (
    <div className="filterbar mono" role="search">
      <div className="fb-label" aria-hidden="true"><span className="num">02</span><span>FILTER</span></div>
      <div className="fb-search">
        <input id="fbSearch" type="text" placeholder="search agent · slug · task · path" autoComplete="off" aria-label="Search agents and tasks" />
        <span className="kbd" aria-hidden="true">/</span>
      </div>
      <div className="fb-drops">
        <button className="fb-drop" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Status filter: all"><span className="dk">STATUS</span><span className="dv">all</span><span className="caret">▾</span></button>
        <button className="fb-drop" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Model filter: all"><span className="dk">MDL</span><span className="dv">all</span><span className="caret">▾</span></button>
        <button className="fb-drop" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="CLI filter: all"><span className="dk">CLI</span><span className="dv">all</span><span className="caret">▾</span></button>
        <button className="fb-drop" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Window: 24h"><span className="dk">WIN</span><span className="dv">24h</span><span className="caret">▾</span></button>
      </div>
      <button className="fb-clear" type="button" disabled aria-label="Clear filters">RESET ✕</button>
    </div>
  );
}
