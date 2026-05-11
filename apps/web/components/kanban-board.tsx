type KanbanRow = {
  id: string;
  owner: string;
  time: string;
  st: string;
};

type KanbanColumn = {
  id: string;
  name: string;
  rows: KanbanRow[];
};

const columns: KanbanColumn[] = [
  {
    id: 'queue',
    name: 'QUEUE',
    rows: [
      { id: 'RN-2185', owner: 'pavan', time: '+12s', st: 'queue' },
      { id: 'RN-2184', owner: 'daniel', time: '+38s', st: 'queue' },
      { id: 'RN-2183', owner: 'lucas', time: '+1m', st: 'queue' },
      { id: 'DN-2170', owner: 'felipe', time: '+2m', st: 'queue' },
    ],
  },
  {
    id: 'running',
    name: 'RUNNING',
    rows: [
      { id: 'RN-2182', owner: 'daniel', time: '12s', st: 'running' },
      { id: 'RN-2180', owner: 'pavan', time: '45s', st: 'running' },
      { id: 'RN-2181', owner: 'daniel', time: '3m18', st: 'running' },
    ],
  },
  {
    id: 'blocked',
    name: 'BLOCKED',
    rows: [
      { id: 'RN-2177', owner: 'lucas', time: '30m', st: 'blocked' },
    ],
  },
  { id: 'review', name: 'REVIEW', rows: [] },
  {
    id: 'done',
    name: 'DONE',
    rows: [
      { id: 'DN-2169', owner: 'felipe', time: '10m', st: 'done' },
      { id: 'DN-2168', owner: 'felipe', time: '1h02', st: 'done' },
      { id: 'DN-2167', owner: 'pavan', time: '1h44', st: 'done' },
      { id: 'RN-2166', owner: 'daniel', time: '2h10', st: 'done' },
    ],
  },
];

function KanbanColumnView({ column }: { column: KanbanColumn }) {
  return (
    <div className="kcol scan-host" data-col={column.id} tabIndex={0} role="group" aria-label={`${column.name} column, ${column.rows.length} tasks`}>
      <div className="scan" aria-hidden="true" />
      <div className="kcol-skel"><span className="lbl">CONNECTING</span></div>
      <div className="kcol-head">
        <span className="name"><span className="dot" aria-hidden="true" />{column.name}</span>
        <span className="cnt"><span className="num">{String(column.rows.length).padStart(2, '0')}</span> / ∞</span>
      </div>
      <div className="kcol-body">
        {column.rows.length === 0 ? (
          <div className="kcol-empty"><span className="hint">// review · queue desde 03:14</span></div>
        ) : (
          column.rows.map((row) => (
            <div key={row.id} className="krow" data-st={row.st} tabIndex={0} role="button" aria-label={`Task ${row.id}, owner ${row.owner}, ${row.time}`}>
              <span className="sdot" aria-hidden="true" />
              <span className="id mono">{row.id}</span>
              <span className="owner mono">@{row.owner}</span>
              <span className="time mono">{row.time}</span>
              <span className="caret" aria-hidden="true">›</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function KanbanBoard() {
  return (
    <div className="kanban-wrap scan-host" aria-label="Task kanban" role="region" aria-live="polite">
      <div className="scan" aria-hidden="true" />
      <div className="kanban-topline">
        <div className="lead">
          <span className="num-tag">04</span>
          <span>KANBAN · TASK STREAM</span>
          <span className="live" id="kbLive">LIVE · SSE</span>
        </div>
        <div className="right">
          <span className="it"><span className="k">QUEUE</span><span className="v">04</span></span>
          <span className="it"><span className="k">RUN</span><span className="v cy">03</span></span>
          <span className="it"><span className="k">BLK</span><span className="v" style={{ color: 'var(--status-blocked)' }}>01</span></span>
          <span className="it"><span className="k">DONE</span><span className="v">14</span></span>
        </div>
      </div>
      <div className="kanban-cols" id="kbcols">
        {columns.map((column) => <KanbanColumnView key={column.id} column={column} />)}
      </div>
    </div>
  );
}
