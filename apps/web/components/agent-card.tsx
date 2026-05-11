type AgentStatus = 'running' | 'idle' | 'blocked' | 'done' | 'offline';

type Agent = {
  slug: string;
  name: string;
  role: string;
  model: string;
  cli: string;
  status: AgentStatus;
  task: string | null;
  last: string;
  initials: string;
  pane: string;
};

const agents: Agent[] = [
  {
    slug: 'pavan',
    name: 'José Pavan',
    role: 'Consigliere',
    model: 'opus-4.7',
    cli: 'cc',
    status: 'running',
    task: 'RN-2180',
    last: 'há 45s',
    initials: 'JP',
    pane: '<span class="prompt">›</span> <span class="dim">cc.dev</span> handoff <span class="hi">pavan→daniel</span> <span class="dim">--phase 2</span>\n<span class="dim">› assembling context bundle · 14 files · 2.1k tokens</span>\n<span class="dim">›</span> <span class="ok">bundle ready</span>',
  },
  {
    slug: 'daniel',
    name: 'Daniel Singh',
    role: 'Dev sênior — líder de área',
    model: 'opus-4.7',
    cli: 'cc',
    status: 'running',
    task: 'RN-2182',
    last: 'há 12s',
    initials: 'DS',
    pane: '<span class="prompt">$</span> <span class="dim">cc.dev</span> refactor <span class="hi">connection-per-call</span>\n<span class="dim">› patching</span> services/runner/queue.py <span class="dim">· 14 hunks staged</span>\n<span class="dim">›</span> <span class="ok">✓ smoke test</span>',
  },
  {
    slug: 'lucas',
    name: 'Lucas Marchetti',
    role: 'Diretor de marketing',
    model: 'sonnet-4.6',
    cli: 'cc',
    status: 'blocked',
    task: 'RN-2177',
    last: 'há 30min',
    initials: 'LM',
    pane: '<span class="prompt">›</span> <span class="warn">awaiting human</span> · approve copy post Instagram?\n<span class="prompt">›</span> <span class="dim">draft em</span> memory/2026-05-09-post.md\n<span class="dim">› elapsed 30:14 since prompt</span>',
  },
  {
    slug: 'vinicius',
    name: 'Vinicius Zanella',
    role: 'Especialista — lojistas',
    model: 'haiku-4.5',
    cli: 'cc',
    status: 'idle',
    task: null,
    last: 'há 2h',
    initials: 'VZ',
    pane: '<span class="dim">›</span> <span class="dim">STANDBY · conversation compacted at 14:22</span>\n<span class="dim">› context flushed · 18.2k → 1.4k tokens</span>\n<span class="dim">› watching inbox/lojistas/</span>',
  },
  {
    slug: 'felipe',
    name: 'Felipe Conti',
    role: 'Especialista — comercial',
    model: 'opus-4.7',
    cli: 'codex',
    status: 'done',
    task: 'DN-2169',
    last: 'há 10min',
    initials: 'FC',
    pane: '<span class="prompt">✓</span> <span class="ok">complete</span> · campanha pré-aprovação\n<span class="dim">› 14 lojistas notified · template v3 · 100% delivery</span>\n<span class="dim">› artifact pushed → DN-2169 closed</span>',
  },
  {
    slug: 'barsi',
    name: 'Luiz Barsi',
    role: 'CFO read-only',
    model: 'haiku-4.5',
    cli: 'cc',
    status: 'offline',
    task: null,
    last: 'há 2h20',
    initials: 'LB',
    pane: '<span class="dim">› NO HEARTBEAT · daemon unreachable</span>\n<span class="dim">› last seen 2026-05-10 12:02:14 -03:00</span>\n<span class="dim">› vps.cockpit / agents/barsi · pid 8421 SIGTERM</span>',
  },
];

const stateLabel: Record<AgentStatus, string> = {
  running: 'RUNNING',
  idle: 'IDLE',
  blocked: 'BLOCKED',
  done: 'DONE',
  offline: 'OFFLINE',
};

const paneLabel: Record<AgentStatus, string> = {
  running: 'STDOUT // PANE.001',
  idle: 'STDOUT // idle',
  blocked: 'STDIN // AWAIT.HUMAN',
  done: 'STDOUT // EXIT.0',
  offline: 'STDOUT // OFFLINE',
};

function WifiOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

export function AgentCard({ agent }: { agent: Agent }) {
  const label = `Agent ${agent.name}, ${stateLabel[agent.status]}${agent.task ? `, task ${agent.task}` : ''}`;

  return (
    <article className="agent-card scan-host" data-state={agent.status} data-slug={agent.slug} tabIndex={0} role="listitem" aria-label={label}>
      <div className="scan" aria-hidden="true" />
      <div className="card-skel"><span className="lbl">CONNECTING</span><span className="ph">▸ no data // fetching</span></div>
      <div className="rail" aria-hidden="true" />
      <div className="card-body">
        <div className="card-head">
          <div className="avatar" aria-hidden="true">{agent.initials}</div>
          <div className="head-text">
            <div className="head-toprow">
              <span className="agent-name">{agent.name}<span className="wifi-off" title="SSE disconnected" aria-hidden="true"><WifiOffIcon /></span></span>
            </div>
            <span className="agent-slug">{agent.slug}</span>
            <span className="agent-role">{agent.role}</span>
          </div>
          <span className="status-bar" aria-hidden="true"><span className="sdot" />{stateLabel[agent.status]}</span>
        </div>
        <div className="meta-strip" aria-hidden="true">
          <span><span className="m-key">MDL</span><span className="m-val">{agent.model}</span></span>
          <span><span className="m-key">CLI</span><span className="m-val">{agent.cli}</span></span>
          <span><span className="m-key">TASK</span><span className="m-val">{agent.task || '—'}</span></span>
        </div>
        <div className="pane">
          <div style={{ opacity: 0.55, fontSize: '9px', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: '3px' }}>{paneLabel[agent.status]}</div>
          <span dangerouslySetInnerHTML={{ __html: agent.pane }} />
        </div>
        <div className="card-foot">
          <span>LAST·SEEN <span className="lseen-val">{agent.last}</span></span>
          <span>{agent.cli.toUpperCase()} · {agent.model}</span>
        </div>
      </div>
    </article>
  );
}

export function AgentCards() {
  return (
    <div className="grid" id="cards" role="list" aria-label="Agents">
      {agents.map((agent) => <AgentCard key={agent.slug} agent={agent} />)}
    </div>
  );
}
