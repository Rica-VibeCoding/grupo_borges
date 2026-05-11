'use client';

import { useCallback } from 'react';
import type { Agent, AgentStatus } from '../lib/cockpit-types';
import { deriveInitials, formatLastSeen } from '../lib/cockpit-types';
import { useSelectedAgent } from '../lib/selected-agent-context';

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

const STATUS_ORDER: Record<AgentStatus, number> = {
  running: 0,
  blocked: 1,
  done: 2,
  idle: 3,
  offline: 4,
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

export function AgentCard({ agent, serverNow }: { agent: Agent; serverNow: number }) {
  const initials = deriveInitials(agent.name);
  const lastSeenFmt = formatLastSeen(agent.last_seen, serverNow);
  const task = agent.current_task_id ?? null;
  const cli = agent.state_cli ?? agent.cli_default;
  const model = agent.state_model ?? agent.model_default;
  const label = `Agent ${agent.name}, ${stateLabel[agent.status]}${task ? `, task ${task}` : ''}`;
  const { select } = useSelectedAgent();
  const open = useCallback(() => select(agent.slug), [select, agent.slug]);
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
    [open],
  );

  return (
    <article
      className="agent-card scan-host"
      data-state={agent.status}
      data-slug={agent.slug}
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
      aria-label={label}
      onClick={open}
      onKeyDown={onKey}
    >
      <div className="scan" aria-hidden="true" />
      <div className="card-skel">
        <span className="lbl">CONNECTING</span>
        <span className="ph">▸ no data // fetching</span>
      </div>
      <div className="rail" aria-hidden="true" />
      <div className="card-body">
        <div className="card-head">
          <div className="avatar" aria-hidden="true">{initials}</div>
          <div className="head-text">
            <div className="head-toprow">
              <span className="agent-name">
                {agent.name}
                <span className="wifi-off" title="SSE disconnected" aria-hidden="true">
                  <WifiOffIcon />
                </span>
              </span>
            </div>
            <span className="agent-slug">{agent.slug}</span>
            <span className="agent-role">{agent.role}</span>
          </div>
          <span className="status-bar" aria-hidden="true">
            <span className="sdot" />
            {stateLabel[agent.status]}
          </span>
        </div>
        <div className="meta-strip" aria-hidden="true">
          <span><span className="m-key">MDL</span><span className="m-val">{model}</span></span>
          <span><span className="m-key">CLI</span><span className="m-val">{cli}</span></span>
          <span><span className="m-key">TASK</span><span className="m-val">{task ?? '—'}</span></span>
        </div>
        <div className="pane">
          <div
            style={{
              opacity: 0.55,
              fontSize: '9px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              marginBottom: '3px',
            }}
          >
            {paneLabel[agent.status]}
          </div>
          <span>{agent.pane_excerpt ?? '— no output captured —'}</span>
        </div>
        <div className="card-foot">
          <span>LAST·SEEN <span className="lseen-val">{lastSeenFmt}</span></span>
          <span>{cli.toUpperCase()} · {model}</span>
        </div>
      </div>
    </article>
  );
}

export function AgentCards({ agents, serverNow }: { agents: Agent[]; serverNow: number }) {
  const sorted = [...agents].sort((a, b) => {
    const da = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return da !== 0 ? da : a.name.localeCompare(b.name);
  });
  return (
    <div className="grid" id="cards" role="list" aria-label="Agents">
      {sorted.map((agent) => (
        <AgentCard key={agent.slug} agent={agent} serverNow={serverNow} />
      ))}
    </div>
  );
}
