'use client';

import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Agent, AgentCli, AgentModel, AgentStatus } from '../lib/cockpit-types';
import { deriveInitials, formatLastSeen } from '../lib/cockpit-types';
import { createAgentInstance } from '../lib/api';
import { useFleet } from '../lib/fleet-context';
import { useSelectedAgent } from '../lib/selected-agent-context';
import { SelectField } from './select-field';

const stateLabel: Record<AgentStatus, string> = {
  running: 'EXECUTANDO',
  idle: 'OCIOSO',
  blocked: 'BLOQUEADO',
  done: 'CONCLUÍDO',
  offline: 'OFFLINE',
};

const paneLabel: Record<AgentStatus, string> = {
  running: 'STDOUT // PANE.001',
  idle: 'STDOUT // ocioso',
  blocked: 'STDIN // AGUARDA.HUMANO',
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

export function AgentCard({ agent, serverNow }: { agent: Agent; serverNow: number }) {
  const { mutate } = useFleet();
  const [instanceDialogOpen, setInstanceDialogOpen] = useState(false);
  const [instanceFocus, setInstanceFocus] = useState(false);
  const initials = deriveInitials(agent.name);
  const lastSeenFmt = formatLastSeen(agent.last_seen, serverNow);
  const task = agent.current_task_id ?? null;
  const cli = agent.state_cli ?? agent.cli_default;
  const model = agent.state_model ?? agent.model_default;
  const label = `Agente ${agent.name}, ${stateLabel[agent.status]}${task ? `, tarefa ${task}` : ''}`;
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
          <span><span className="m-key">TAREFA</span><span className="m-val">{task ?? '—'}</span></span>
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
          <span>{agent.pane_excerpt ?? '— nenhuma saída capturada —'}</span>
        </div>
        <div className="card-foot">
          <span>VISTO·EM <span className="lseen-val">{lastSeenFmt}</span></span>
          <span className="card-actions">
            {agent.instances.length > 1 && (
              <button
                type="button"
                className="instance-pill"
                aria-pressed={instanceFocus}
                title="Destacar instâncias deste agente"
                onClick={(e) => {
                  e.stopPropagation();
                  setInstanceFocus((v) => !v);
                }}
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
                  <Dialog.Close asChild>
                    <button type="button" className="agent-modal-close instance-dialog-close" aria-label="Fechar">✕</button>
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <span>{cli.toUpperCase()} · {model}</span>
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
