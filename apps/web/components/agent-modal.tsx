'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { useFleet } from '../lib/fleet-context';
import { useSelectedAgent } from '../lib/selected-agent-context';
import type { Agent, AgentStatus } from '../lib/cockpit-types';
import { formatLastSeen } from '../lib/cockpit-types';

const STATUS_LABEL: Record<AgentStatus, string> = {
  running: 'RUNNING',
  idle: 'IDLE',
  blocked: 'BLOCKED',
  done: 'DONE',
  offline: 'OFFLINE',
};

function formatUnixDateTime(unixSec: number | null): string {
  if (unixSec === null) return '—';
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function AgentModal() {
  const { selectedSlug, close } = useSelectedAgent();
  const { fleet } = useFleet();
  const agent: Agent | null = selectedSlug
    ? fleet.agents.find((a) => a.slug === selectedSlug) ?? null
    : null;
  const open = agent !== null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="agent-modal-overlay" />
        <Dialog.Content className="agent-modal-frame mono" aria-describedby={undefined}>
          {agent && (
            <>
              <header className="agent-modal-head">
                <div className="head-left">
                  <Dialog.Title className="agent-modal-title">
                    {agent.name} <span className="muted">// {agent.slug}</span>
                  </Dialog.Title>
                  <span className="agent-modal-role">{agent.role}</span>
                </div>
                <div className="head-right">
                  <span className="status-bar" data-state={agent.status}>
                    <span className="sdot" />
                    {STATUS_LABEL[agent.status]}
                  </span>
                  <Dialog.Close asChild>
                    <button type="button" className="agent-modal-close" aria-label="Close modal">✕</button>
                  </Dialog.Close>
                </div>
              </header>
              <Tabs.Root defaultValue="missao" className="agent-modal-tabs">
                <Tabs.List className="agent-modal-tablist" aria-label="Agent detail tabs">
                  <Tabs.Trigger value="missao" className="agent-modal-tab">MISSÃO</Tabs.Trigger>
                  <Tabs.Trigger value="skills" className="agent-modal-tab">SKILLS</Tabs.Trigger>
                  <Tabs.Trigger value="docs" className="agent-modal-tab">DOCS</Tabs.Trigger>
                  <Tabs.Trigger value="tabelas" className="agent-modal-tab">TABELAS</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="missao" className="agent-modal-panel">
                  <MissaoPanel agent={agent} serverNow={fleet.health.server_now} />
                </Tabs.Content>
                <Tabs.Content value="skills" className="agent-modal-panel">
                  <Placeholder label="Skills do workspace serão listadas aqui via /api/agents/{slug}/skills (Fase 3)." />
                </Tabs.Content>
                <Tabs.Content value="docs" className="agent-modal-panel">
                  <Placeholder label="Docs do workspace via @include resolver — Fase 3." />
                </Tabs.Content>
                <Tabs.Content value="tabelas" className="agent-modal-panel">
                  <Placeholder label="Tabelas Supabase do domínio do agente — Fase 3." />
                </Tabs.Content>
              </Tabs.Root>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MissaoPanel({ agent, serverNow }: { agent: Agent; serverNow: number }) {
  const totalEvents = agent.sparkline.reduce((acc, b) => acc + b.count, 0);
  return (
    <div className="missao-grid">
      <KV k="WORKSPACE" v={agent.workspace_path} />
      <KV k="TMUX" v={agent.tmux_session} />
      <KV k="CLI" v={agent.state_cli ?? agent.cli_default} />
      <KV k="MODEL" v={agent.state_model ?? agent.model_default} />
      <KV k="STATUS" v={STATUS_LABEL[agent.status]} />
      <KV k="LAST SEEN" v={formatLastSeen(agent.last_seen, serverNow)} />
      <KV k="LAST SEEN ABS" v={formatUnixDateTime(agent.last_seen)} />
      <KV k="TASK" v={agent.current_task_id ?? '—'} />
      <KV k="INSTANCES" v={String(agent.instance_count)} />
      <KV k="EVENTS · 24H" v={String(totalEvents)} />
      <div className="missao-caps">
        <span className="missao-key">CAPABILITIES</span>
        {agent.capabilities.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <ul className="missao-caps-list">
            {agent.capabilities.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
      </div>
      <Sparkline buckets={agent.sparkline} />
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
    </div>
  );
}

function Sparkline({ buckets }: { buckets: { bucket: string; count: number }[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="sparkline" aria-label="Events last 24 hours">
      <span className="missao-key">SPARKLINE · 24H</span>
      <div className="sparkline-bars" role="img" aria-hidden="true">
        {buckets.map((b) => {
          const h = Math.max(2, Math.round((b.count / max) * 32));
          return (
            <span
              key={b.bucket}
              className="sb"
              data-zero={b.count === 0 ? 'true' : 'false'}
              style={{ height: `${h}px` }}
              title={`${b.bucket}: ${b.count}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return <p className="muted" style={{ padding: '12px 0' }}>{label}</p>;
}
