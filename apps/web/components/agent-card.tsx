'use client';

import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Agent, AgentActivityState, AgentCli, AgentModel, AgentStatus } from '../lib/cockpit-types';
import { deriveInitials, formatDuration, formatLastSeen, parseContextPct, parseModelFromPane, shortModelName } from '../lib/cockpit-types';
import { createAgentInstance } from '../lib/api';
import { useFleet } from '../lib/fleet-context';
import { useSelectedAgent } from '../lib/selected-agent-context';
import { formatRelativeShort, summarize } from './activity-feed';
import { SelectField } from './select-field';

// V2.4 — 4 estados, textos pt-BR próprios. Glow na borda; ocioso estático,
// trabalhando pulsa devagar (~2s), aguardando pulsa intenso (~1s), offline opaco.
const stateLabel: Record<AgentStatus, string> = {
  ocioso: 'Ocioso',
  trabalhando: 'Trabalhando',
  aguardando: 'Aguardando',
  offline: 'Offline',
};

const STATUS_ORDER: Record<AgentStatus, number> = {
  trabalhando: 0,
  aguardando: 1,
  ocioso: 2,
  offline: 3,
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

const CLI_OPTIONS: Array<{ value: AgentCli; label: string }> = [
  { value: 'claude_code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
];

const MODELS_BY_CLI: Record<AgentCli, AgentModel[]> = {
  claude_code: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  codex: [
    'codex-gpt-5-5',
    'codex-gpt-5-4',
    'codex-gpt-5-4-mini',
    'codex-gpt-5-3-codex',
    'codex-gpt-5-2',
  ],
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

export function AgentCard({
  agent,
  serverNow,
}: {
  agent: Agent;
  serverNow: number;
}) {
  const { activityOverrides, events, mutate } = useFleet();
  const [instanceDialogOpen, setInstanceDialogOpen] = useState(false);
  const [instanceFocus, setInstanceFocus] = useState(false);
  const initials = deriveInitials(agent.name);
  const lastSeenFmt = formatLastSeen(agent.last_seen, serverNow);
  const task = agent.current_task_id ?? null;
  const cli = agent.state_cli ?? agent.cli_default;
  const model = agent.state_model ?? agent.model_default;
  const isCodexExecutor = agent.executor_kind === 'codex';
  // sessionStarted: Codex usa session_started_at (do evento); CC usa pane_session_started_at
  const sessionStarted = isCodexExecutor
    ? (agent.session_started_at ?? agent.instances[0]?.started_at ?? null)
    : (agent.instances[0]?.started_at ?? agent.pane_session_started_at ?? null);
  const sessionSecs = sessionStarted !== null ? Math.max(0, serverNow - sessionStarted) : null;
  // contextPct: Codex recebe campo direto do backend; CC faz parse do pane_excerpt
  const contextPct = isCodexExecutor
    ? (agent.context_pct ?? null)
    : parseContextPct(agent.pane_excerpt);
  // paneModel: CC extrai do statusline do pane; Codex usa null (cai no shortModelName(model))
  const paneModel = isCodexExecutor ? null : parseModelFromPane(agent.pane_excerpt);
  const lifecycle = formatLifecycle(agent);
  const activityOverride = activityOverrides[agent.slug];
  const activityState = activityOverride?.state ?? deriveActivityState(agent);
  let lastEvent: typeof events[number] | null = null;
  let lastEventSummary: string | null = null;
  for (const e of events) {
    if (e.agent_slug !== agent.slug) continue;
    const s = summarize(e);
    if (s !== null) { lastEvent = e; lastEventSummary = s; break; }
  }
  const lastEventDelta = lastEvent ? Math.max(0, serverNow - lastEvent.created_at) : null;
  const label = `Agente ${agent.name}, ${activityLabel[activityState]}, macro ${stateLabel[agent.status]}${task ? `, tarefa ${task}` : ''}`;
  const { select } = useSelectedAgent();
  const open = useCallback(() => select(agent.slug), [select, agent.slug]);
  useEffect(() => {
    if (agent.instances.length <= 1) setInstanceFocus(false);
  }, [agent.instances.length]);
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
      data-slug={agent.slug}
      data-instance-focus={instanceFocus ? 'true' : 'false'}
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
          <div className="avatar" aria-hidden="true">{initials}</div>
          <div className="head-text">
            <div className="head-toprow">
              <span className="agent-name">
                {agent.name}
                <span className="wifi-off" title="SSE desconectado" aria-hidden="true">
                  <WifiOffIcon />
                </span>
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
        <div className="meta-strip" aria-hidden="true">
          <span className="m-val lseen-val">{lastSeenFmt}</span>
          <span><span className="m-key">TAREFA</span><span className="m-val">{task ?? '—'}</span></span>
          <span className="card-actions" onClick={(e) => e.stopPropagation()}>
            {agent.instances.length > 1 && (
              <button
                type="button"
                className="instance-pill"
                aria-pressed={instanceFocus}
                title="Destacar instâncias deste agente"
                onClick={(e) => { e.stopPropagation(); setInstanceFocus((v) => !v); }}
              >
                +{agent.instances.length}
              </button>
            )}
            <Dialog.Root open={instanceDialogOpen} onOpenChange={setInstanceDialogOpen}>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  className="instance-add"
                  aria-label={`Criar nova instância de ${agent.name}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  ＋
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="agent-modal-overlay" />
                <Dialog.Content
                  className="instance-dialog mono"
                  onClick={(e) => e.stopPropagation()}
                  aria-describedby={undefined}
                >
                  <Dialog.Title className="instance-dialog-title">Nova instância</Dialog.Title>
                  <NewInstanceForm
                    agent={agent}
                    onCreated={mutate}
                    onClose={() => setInstanceDialogOpen(false)}
                  />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </span>
        </div>
        <div className="last-action mono" aria-hidden="true">
          {isCodexExecutor && agent.active_task_label ? (
            <>
              <span className="la-spark" aria-hidden>▸</span>
              <span className="la-text">{agent.active_task_label}</span>
            </>
          ) : lastEvent && lastEventSummary ? (
            <>
              <span className="la-spark" aria-hidden>•</span>
              <span className="la-text">{lastEventSummary}</span>
              <span className="la-sep">·</span>
              <span className="la-time num" suppressHydrationWarning>há {formatRelativeShort(lastEventDelta!)}</span>
            </>
          ) : (
            <span className="la-text la-empty">— sem atividade recente</span>
          )}
        </div>
        <div className="pane pane-session" aria-hidden="true">
          <span className="ps-model">{paneModel ?? shortModelName(model)}</span>
          <span className="ps-sep">·</span>
          <span className="ps-time">{sessionSecs !== null ? formatDuration(sessionSecs) : '—'}</span>
          <span className="ps-sep">·</span>
          <span className="ps-ctx">
            {contextPct !== null ? (
              <>
                <span className="ps-bar" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, i) => (
                    <span
                      key={i}
                      className="psb-cell"
                      data-on={i < Math.round(contextPct / 10) ? '1' : '0'}
                    />
                  ))}
                </span>
                {' '}{contextPct}%
              </>
            ) : '— %'}
          </span>
        </div>
      </div>
    </article>
  );
}

function NewInstanceForm({
  agent,
  onCreated,
  onClose,
}: {
  agent: Agent;
  onCreated: () => Promise<void>;
  onClose: () => void;
}) {
  const [cli, setCli] = useState<AgentCli>((agent.cli_default as AgentCli) || 'claude_code');
  const [model, setModel] = useState<AgentModel>(
    () => {
      const def = (agent.model_default as AgentModel) || 'claude-haiku-4-5';
      const initialCli = (agent.cli_default as AgentCli) || 'claude_code';
      return MODELS_BY_CLI[initialCli].includes(def) ? def : MODELS_BY_CLI[initialCli][0];
    },
  );
  const [isSubagent, setIsSubagent] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const availableModels = MODELS_BY_CLI[cli];
  function onCliChange(next: AgentCli) {
    setCli(next);
    if (!MODELS_BY_CLI[next].includes(model)) setModel(MODELS_BY_CLI[next][0]);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState('saving');
    setMessage(null);
    try {
      const result = await createAgentInstance(agent.slug, { cli, model, is_subagent: isSubagent });
      await onCreated();
      if (result.session_error) {
        setMessage(`instância criada; tmux falhou: ${result.session_error}`);
      } else {
        onClose();
      }
      setState('idle');
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="instance-form" onSubmit={submit}>
      <SelectField<AgentCli> label="CLI" value={cli} onValueChange={onCliChange} options={CLI_OPTIONS} />
      <SelectField<AgentModel>
        label="Modelo"
        value={model}
        onValueChange={setModel}
        options={availableModels.map((v) => ({ value: v, label: v }))}
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={isSubagent}
          onChange={(e) => setIsSubagent(e.currentTarget.checked)}
        />
        <span>is_subagent</span>
      </label>
      {message && <p className="form-note" data-kind={state === 'error' ? 'error' : 'info'}>{message}</p>}
      <button type="submit" className="form-submit" disabled={state === 'saving'}>
        {state === 'saving' ? 'CRIANDO…' : 'CRIAR'}
      </button>
      <button type="button" className="form-cancel" onClick={onClose} disabled={state === 'saving'}>
        FECHAR
      </button>
    </form>
  );
}

export function AgentCards({ agents, serverNow }: { agents: Agent[]; serverNow: number }) {
  const sorted = [...agents].sort((a, b) => {
    const da = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return da !== 0 ? da : a.name.localeCompare(b.name);
  });
  return (
    <div className="grid" id="cards" role="list" aria-label="Agentes">
      {sorted.map((agent) => (
        <AgentCard key={agent.slug} agent={agent} serverNow={serverNow} />
      ))}
    </div>
  );
}
