'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { useFleet } from '../lib/fleet-context';
import { useSelectedAgent } from '../lib/selected-agent-context';
import { useIsMobile } from '../lib/use-is-mobile';
import type {
  Agent,
  AgentDocMeta,
  AgentDocResolved,
  AgentSkill,
  AgentStatus,
  AgentTable,
  ActiveTaskStatus,
  Task,
} from '../lib/cockpit-types';
import { formatDuration, formatLastSeen, shortModelName } from '../lib/cockpit-types';
import { formatDateTime } from '../lib/format-time';
import {
  fetchAgentDoc,
  fetchAgentDocs,
  fetchAgentSkills,
  fetchAgentTables,
  listAgentTasks,
  postTaskHandoff,
} from '../lib/api';
import { SelectField } from './select-field';
import { ChatPanel } from './chat-panel';
import { Sparkline } from './sparkline';

const STATUS_LABEL: Record<AgentStatus, string> = {
  ocioso: 'Ocioso',
  trabalhando: 'Trabalhando',
  aguardando: 'Aguardando',
  offline: 'Offline',
};

const HANDOFF_STATUSES: ActiveTaskStatus[] = ['running', 'ready', 'backlog'];

function safeUUID(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatUnixDateTime(unixSec: number | null): string {
  if (unixSec === null) return '—';
  return formatDateTime(unixSec);
}

export function AgentModal() {
  const { selectedSlug, close } = useSelectedAgent();
  const { fleet } = useFleet();
  const isMobile = useIsMobile();
  const agent: Agent | null = selectedSlug
    ? fleet.agents.find((a) => a.slug === selectedSlug) ?? null
    : null;
  const open = agent !== null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="agent-modal-overlay" />
        <Dialog.Content className={`agent-modal-frame mono${isMobile ? ' agent-modal-frame-mobile' : ''}`} aria-describedby={undefined}>
          {agent && (
            <>
              <header className="agent-modal-head">
                <div className="head-left">
                  <img
                    className="modal-avatar"
                    src={`/avatars/${agent.slug}.png`}
                    alt=""
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="modal-head-text">
                    <Dialog.Title className="agent-modal-title">
                      {agent.name}
                    </Dialog.Title>
                    <span className="agent-modal-role">// {agent.slug}</span>
                  </div>
                </div>
                <div className="head-right">
                  <span className="status-bar" data-state={agent.status}>
                    <span className="sdot" />
                    {STATUS_LABEL[agent.status]}
                  </span>
                  <Dialog.Close asChild>
                    <button type="button" className="agent-modal-close" aria-label="Fechar modal">✕</button>
                  </Dialog.Close>
                </div>
              </header>
              <Tabs.Root defaultValue="chat" className="agent-modal-tabs">
                <Tabs.List className="agent-modal-tablist" aria-label="Abas de detalhes do agente">
                  <Tabs.Trigger value="chat" className="agent-modal-tab">CHAT</Tabs.Trigger>
                  <Tabs.Trigger value="inf" className="agent-modal-tab">INF.</Tabs.Trigger>
                  <Tabs.Trigger value="skills" className="agent-modal-tab">SKILLS</Tabs.Trigger>
                  <Tabs.Trigger value="docs" className="agent-modal-tab">DOCS</Tabs.Trigger>
                  <Tabs.Trigger value="tabelas" className="agent-modal-tab">TABELAS</Tabs.Trigger>
                  <Tabs.Trigger value="handoff" className="agent-modal-tab">HANDOFF</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="chat" className="agent-modal-panel">
                  <ChatPanel agent={agent} serverNow={fleet.health.server_now} />
                </Tabs.Content>
                <Tabs.Content value="inf" className="agent-modal-panel">
                  <MissaoPanel agent={agent} serverNow={fleet.health.server_now} />
                </Tabs.Content>
                <Tabs.Content value="skills" className="agent-modal-panel">
                  <SkillsPanel slug={agent.slug} />
                </Tabs.Content>
                <Tabs.Content value="docs" className="agent-modal-panel">
                  <DocsPanel slug={agent.slug} />
                </Tabs.Content>
                <Tabs.Content value="tabelas" className="agent-modal-panel">
                  <TablesPanel slug={agent.slug} />
                </Tabs.Content>
                <Tabs.Content value="handoff" className="agent-modal-panel">
                  <HandoffPanel agent={agent} />
                </Tabs.Content>
              </Tabs.Root>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HandoffPanel({ agent }: { agent: Agent }) {
  const { fleet, mutate } = useFleet();
  const otherAgents = useMemo(
    () => fleet.agents.filter((a) => a.slug !== agent.slug),
    [fleet.agents, agent.slug],
  );
  const firstOtherAgentSlug = otherAgents[0]?.slug;
  const [selectedTask, setSelectedTask] = useState<string>('');
  const [toAgent, setToAgent] = useState<string>(firstOtherAgentSlug ?? '');
  const [note, setNote] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [taskRefreshSeq, setTaskRefreshSeq] = useState(0);
  const tasksState = useAbortableFetch<Task[]>(
    (signal) => listAgentTasks(agent.slug, HANDOFF_STATUSES, signal),
    [agent.slug, taskRefreshSeq],
  );

  useEffect(() => {
    if (tasksState.kind === 'ready') setSelectedTask(tasksState.data[0]?.id ?? '');
  }, [tasksState]);

  useEffect(() => {
    setToAgent(firstOtherAgentSlug ?? '');
  }, [firstOtherAgentSlug]);

  if (otherAgents.length === 0) {
    return <div className="handoff-panel"><p className="muted">Sem agentes disponíveis pra handoff</p></div>;
  }

  if (tasksState.kind === 'loading') return <div className="handoff-panel">{muted('carregando missões…')}</div>;
  if (tasksState.kind === 'error') return <div className="handoff-panel">{muted(`erro: ${tasksState.message}`)}</div>;
  if (tasksState.data.length === 0) {
    return <div className="handoff-panel"><p className="muted">sem missões ativas pra encaminhar.</p></div>;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedTask || !toAgent) return;
    setSubmitState('saving');
    setMessage(null);
    try {
      const result = await postTaskHandoff(selectedTask, {
        to_agent: toAgent,
        note: note.trim() || null,
        idempotency_key: safeUUID(),
      });
      setTaskRefreshSeq((seq) => seq + 1);
      await mutate();
      setSubmitState('sent');
      setMessage(result.tmux_delivered ? 'handoff enviado.' : 'handoff criado; tmux não entregou.');
    } catch (err) {
      setSubmitState('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="handoff-panel" onSubmit={submit}>
      <SelectField<string>
        label="Missão"
        value={selectedTask}
        onValueChange={setSelectedTask}
        options={tasksState.data.map((task) => ({
          value: task.id,
          label: `${task.human_id ?? task.id.slice(0, 8)} · ${task.title}`,
        }))}
      />
      <SelectField<string>
        label="Destino"
        value={toAgent}
        onValueChange={setToAgent}
        options={otherAgents.map((a) => ({ value: a.slug, label: a.name }))}
      />
      <label className="handoff-note">
        <span>Nota</span>
        <textarea value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={1000} />
      </label>
      {message && <p className="form-note" data-kind={submitState === 'error' ? 'error' : 'info'}>{message}</p>}
      <button type="submit" className="form-submit" disabled={submitState === 'saving' || !toAgent}>
        {submitState === 'saving' ? 'ENVIANDO…' : 'ENVIAR'}
      </button>
    </form>
  );
}

/**
 * MissaoPanel (aba INF) — DS-58 polish + tighten.
 *
 * Reagrupado em blocos de sinergia: IDENTIDADE, INFRA, SESSÃO, TAREFA(opt),
 * CICLO(opt), ATIVIDADE. KVs com valor null/'—' são SUPRIMIDOS (não rendem
 * linha órfã no grid 2-col). STDOUT removido.
 *
 * Tighten: VISTO EM ABS fundido no title hover de VISTO EM (eliminou 1 KV);
 * EXECUTOR só aparece se ≠ 'claude_code' (default suprimido).
 */
function MissaoPanel({ agent, serverNow }: { agent: Agent; serverNow: number }) {
  const sessionStarted = agent.executor_kind === 'codex'
    ? (agent.session_started_at ?? agent.instances[0]?.started_at ?? null)
    : (agent.pane_session_started_at ?? agent.instances[0]?.started_at ?? null);
  const sessionSecs = sessionStarted !== null ? Math.max(0, serverNow - sessionStarted) : null;
  const isCodexExec = agent.executor_kind === 'codex';
  const seenAbs = formatUnixDateTime(agent.last_seen);

  const hasTaskInfo = Boolean(
    agent.current_task_id || agent.active_task_label || agent.current_task_last_heartbeat,
  );
  const hasLifecycle = Boolean(
    agent.lifecycle_status || agent.lifecycle_detail || agent.lifecycle_event,
  );

  return (
    <div className="missao-grid">
      <MissaoSection title="IDENTIDADE">
        <KV k="NOME" v={agent.name} />
        <KV k="PAPEL" v={agent.role} />
        <KV k="SLUG" v={agent.slug} />
        {agent.emoji && <KV k="EMOJI" v={agent.emoji} />}
        <div className="missao-caps">
          <span className="missao-key">CAPACIDADES</span>
          {agent.capabilities.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            <ul className="missao-caps-list">
              {agent.capabilities.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
        </div>
      </MissaoSection>

      <MissaoSection title="INFRA">
        <KV k="WORKSPACE" v={agent.workspace_path} />
        <KV k="TMUX" v={agent.tmux_session} />
        <KV k="CLI" v={agent.state_cli ?? agent.cli_default} />
        <KV k="MODELO" v={shortModelName(agent.state_model ?? agent.model_default)} />
        {isCodexExec && <KV k="EXECUTOR" v="codex" />}
      </MissaoSection>

      <MissaoSection title="SESSÃO">
        <KV k="STATUS" v={STATUS_LABEL[agent.status]} />
        {agent.context_pct !== null && <KV k="CONTEXTO" v={`${agent.context_pct}%`} />}
        {sessionSecs !== null && <KV k="DURAÇÃO" v={formatDuration(sessionSecs)} />}
        {sessionStarted !== null && <KV k="INÍCIO" v={formatUnixDateTime(sessionStarted)} />}
        <KV k="VISTO EM" v={formatLastSeen(agent.last_seen, serverNow)} title={seenAbs} />
        <KV k="INSTÂNCIAS" v={String(agent.instance_count)} />
      </MissaoSection>

      {hasTaskInfo && (
        <MissaoSection title="TAREFA">
          {agent.current_task_id && <KV k="ATUAL" v={agent.current_task_id} />}
          {agent.active_task_label && <KV k="RÓTULO" v={agent.active_task_label} />}
          {agent.current_task_last_heartbeat !== null && (
            <KV k="ÚLTIMO HEARTBEAT" v={formatLastSeen(agent.current_task_last_heartbeat, serverNow)} />
          )}
        </MissaoSection>
      )}

      {hasLifecycle && (
        <MissaoSection title="CICLO DE VIDA">
          {agent.lifecycle_status && <KV k="STATUS" v={STATUS_LABEL[agent.lifecycle_status]} />}
          {agent.lifecycle_detail && <KV k="DETALHE" v={agent.lifecycle_detail} />}
          {agent.lifecycle_event && <KV k="EVENTO" v={agent.lifecycle_event} />}
          {agent.lifecycle_updated_at !== null && (
            <KV k="ATUALIZADO" v={formatUnixDateTime(agent.lifecycle_updated_at)} />
          )}
        </MissaoSection>
      )}

      <MissaoSection title="ATIVIDADE">
        <Sparkline buckets={agent.sparkline} />
      </MissaoSection>
    </div>
  );
}

function MissaoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="missao-section">
      <header className="missao-section-head">{title}</header>
      <div className="missao-section-body">{children}</div>
    </section>
  );
}

function KV({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v" title={title}>{v}</span>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return <p className="muted" style={{ padding: '12px 0' }}>{label}</p>;
}

// ----- Skills / Docs / Tables panels --------------------------------------

type LoadState<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'error'; message: string };

function useAbortableFetch<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ kind: 'loading' });
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    fetcher(ctrl.signal)
      .then((data) => setState({ kind: 'ready', data }))
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function muted(text: string): ReactElement {
  return <p className="muted" style={{ padding: '12px 0' }}>{text}</p>;
}

function SkillsPanel({ slug }: { slug: string }) {
  const state = useAbortableFetch(
    (signal) => fetchAgentSkills(slug, signal).then((res) => res.skills),
    [slug],
  );

  if (state.kind === 'loading') return muted('carregando skills…');
  if (state.kind === 'error') return muted(`erro: ${state.message}`);
  if (state.data.length === 0) return muted('nenhuma skill instalada neste workspace.');

  return (
    <ul className="agent-modal-list">
      {state.data.map((s) => (
        <li key={s.name} className="agent-modal-item">
          <div className="agent-modal-item-head">
            <span className="agent-modal-item-name">{s.name}</span>
            {s.is_symlink && s.shared_from && (
              <span className="agent-modal-item-badge" title={`symlink → ${s.shared_from}`}>shared</span>
            )}
          </div>
          {s.description && <p className="agent-modal-item-desc">{s.description}</p>}
        </li>
      ))}
    </ul>
  );
}

function DocsPanel({ slug }: { slug: string }) {
  const listState = useAbortableFetch<AgentDocMeta[]>(
    (signal) => fetchAgentDocs(slug, signal).then((res) => res.docs),
    [slug],
  );
  const [selected, setSelected] = useState<string | null>(null);

  // Reset seleção + auto-seleciona primeiro doc quando a lista chega
  useEffect(() => {
    if (listState.kind === 'ready') {
      setSelected(listState.data[0]?.filename ?? null);
    } else {
      setSelected(null);
    }
  }, [listState]);

  const docState = useAbortableFetch<AgentDocResolved | null>(
    (signal) => (selected ? fetchAgentDoc(slug, selected, signal) : Promise.resolve(null)),
    [slug, selected],
  );

  if (listState.kind === 'loading') return muted('carregando docs…');
  if (listState.kind === 'error') return muted(`erro: ${listState.message}`);
  if (listState.data.length === 0) return muted('nenhum doc neste workspace.');

  return (
    <div className="agent-modal-docs">
      <nav className="agent-modal-docs-nav" aria-label="Arquivos de documentação do agente">
        {listState.data.map((d) => (
          <button
            key={d.filename}
            type="button"
            className={`agent-modal-docs-nav-btn${selected === d.filename ? ' is-active' : ''}`}
            onClick={() => setSelected(d.filename)}
          >
            {d.filename}
          </button>
        ))}
      </nav>
      <div className="agent-modal-docs-body">
        {docState.kind === 'loading' && <p className="muted">carregando…</p>}
        {docState.kind === 'error' && <p className="muted">erro: {docState.message}</p>}
        {docState.kind === 'ready' && docState.data && (
          <>
            {docState.data.truncated && (
              <p className="muted" style={{ marginBottom: 8 }}>⚠ resposta truncada em 256KB</p>
            )}
            <pre className="agent-modal-docs-pre"><code>{docState.data.content_md}</code></pre>
          </>
        )}
      </div>
    </div>
  );
}

function TablesPanel({ slug }: { slug: string }) {
  const state = useAbortableFetch(
    (signal) => fetchAgentTables(slug, signal).then((res) => res.tables),
    [slug],
  );

  if (state.kind === 'loading') return muted('carregando tabelas…');
  if (state.kind === 'error') return muted(`erro: ${state.message}`);
  if (state.data.length === 0) return muted('nenhuma tabela de domínio configurada no agents.yaml.');

  return (
    <ul className="agent-modal-list">
      {state.data.map((t) => (
        <li key={`${t.db}.${t.name}`} className="agent-modal-item">
          <div className="agent-modal-item-head">
            <span className="agent-modal-item-name">{t.name}</span>
            <span className="agent-modal-item-badge">{t.db}</span>
          </div>
          {t.description && <p className="agent-modal-item-desc">{t.description}</p>}
        </li>
      ))}
    </ul>
  );
}
