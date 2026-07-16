'use client';

import { useCallback } from 'react';
import type { Agent, AgentActivityState, AgentStatus } from '../lib/cockpit-types';
import { deriveInitials } from '../lib/cockpit-types';
import { compareAgentsByRecentActivity } from '../lib/agent-sort';
import { useAskUserPending } from '../lib/ask-user-pending-context';
import { useFleet } from '../lib/fleet-context';
import { useSelectedAgent } from '../lib/selected-agent-context';
import { useSubagentActiveCount } from '../lib/subagent-activity-context';
import { AgentStatusline } from './agent-statusline';

// V2.4 — 4 estados, textos pt-BR próprios. Glow na borda; ocioso estático,
// trabalhando pulsa devagar (~2s), aguardando pulsa intenso (~1s), offline opaco.
const stateLabel: Record<AgentStatus, string> = {
  ocioso: 'Ocioso',
  trabalhando: 'Trabalhando',
  aguardando: 'Aguardando',
  offline: 'Offline',
};

const activityLabel: Record<AgentActivityState, string> = stateLabel;

function deriveActivityState(agent: Agent): AgentActivityState {
  // Backend já entrega `status` reduzido pros 4 valores; UI apenas reflete.
  return agent.status;
}

function formatLifecycle(agent: Agent): string {
  if (agent.executor_kind === 'codex') {
    return agent.status_line ?? agent.lifecycle_detail ?? agent.lifecycle_status ?? '—';
  }
  if (!agent.lifecycle_status && !agent.lifecycle_detail) return '—';
  return agent.lifecycle_detail ? agent.lifecycle_detail : (agent.lifecycle_status ?? '—');
}

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

export function AgentCard({
  agent,
  serverNow,
}: {
  agent: Agent;
  serverNow: number;
}) {
  const { activityOverrides } = useFleet();
  const initials = deriveInitials(agent.name);
  const subagentActiveCount = useSubagentActiveCount(agent.slug);
  const isAskingUser = useAskUserPending(agent.slug);
  const task = agent.current_task_id ?? null;
  const cli = agent.state_cli ?? agent.cli_default;
  const isCodexExecutor = agent.executor_kind === 'codex';
  const lifecycle = formatLifecycle(agent);
  const activityOverride = activityOverrides[agent.slug];
  const activityState = activityOverride?.state ?? deriveActivityState(agent);
  const label = `Agente ${agent.name}, ${activityLabel[activityState]}, macro ${stateLabel[agent.status]}${task ? `, tarefa ${task}` : ''}`;
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
      data-activity-state={activityState}
      data-asking-user={isAskingUser ? 'true' : undefined}
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
        <span className="lbl">CONECTANDO</span>
        <span className="ph">▸ sem dados // buscando</span>
      </div>
      <div className="rail" aria-hidden="true" />
      <div className="card-body">
        <div className="card-head">
          <div className="avatar" aria-hidden="true">
            {initials}
            <img
              src={`/avatars/${agent.slug}.png`}
              alt=""
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          <div className="head-text">
            <div className="head-toprow">
              <span className="agent-name">
                {agent.name}
                <span className="wifi-off" title="SSE desconectado" aria-hidden="true">
                  <WifiOffIcon />
                </span>
                {subagentActiveCount > 0 && (
                  <span
                    className="subagent-badge"
                    title={`${subagentActiveCount} subagent${subagentActiveCount === 1 ? '' : 's'} rodando`}
                    aria-label={`${subagentActiveCount} subagent${subagentActiveCount === 1 ? '' : 's'} ativo${subagentActiveCount === 1 ? '' : 's'}`}
                  >
                    <span className="subagent-badge-dot" aria-hidden="true" />
                    <span className="subagent-badge-num mono">{subagentActiveCount}</span>
                  </span>
                )}
              </span>
            </div>
            <span className="agent-role">
              <span className="agent-slug">{agent.slug}</span>
              <span aria-hidden="true"> | </span>
              <span>{lifecycle}</span>
            </span>
          </div>
          <span className="status-bar" aria-hidden="true">
            <span className="sdot" />
            {activityLabel[activityState]}
          </span>
        </div>
        {agent.status !== 'offline' && (
          <div className="card-strip" aria-hidden="true">
            <span className="card-task">
              <span className="m-key">TAREFA</span>
              <span className="m-val">{(isCodexExecutor && agent.active_task_label) || task || '—'}</span>
            </span>
            <AgentStatusline agent={agent} serverNow={serverNow} variant="inline" />
            <span className="card-actions" onClick={(e) => e.stopPropagation()} />
          </div>
        )}

      </div>
    </article>
  );
}

export function AgentCards({ agents, serverNow }: { agents: Agent[]; serverNow: number }) {
  const sorted = [...agents].sort(compareAgentsByRecentActivity);
  return (
    <div className="grid" id="cards" role="list" aria-label="Agentes">
      {sorted.map((agent) => (
        <AgentCard key={agent.slug} agent={agent} serverNow={serverNow} />
      ))}
    </div>
  );
}
