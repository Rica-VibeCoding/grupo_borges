'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Task, TaskEvent } from '../lib/cockpit-types';
import { dispatchTask, fetchTask, patchTaskStatus, type TaskPatchStatus } from '../lib/api';
import { useFleet } from '../lib/fleet-context';
import { useToast } from '../lib/toast-context';
import { SelectField } from './select-field';

const STATUS_OPTIONS: Array<{ value: TaskPatchStatus; label: string }> = [
  { value: 'backlog', label: 'FILA' },
  { value: 'ready', label: 'PRONTA' },
  { value: 'running', label: 'EXECUTANDO' },
  { value: 'review', label: 'REVISÃO' },
  { value: 'blocked', label: 'BLOQUEADO' },
  { value: 'done', label: 'CONCLUÍDO' },
];

function taskDisplayId(task: Task): string {
  return task.human_id || task.id.slice(0, 8);
}

function formatUnixDateTime(unixSec: number | null): string {
  if (unixSec === null) return '—';
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="task-detail-field">
      <span className="task-detail-key">{label}</span>
      <span className="task-detail-value">{value === null || value === '' ? '—' : value}</span>
    </div>
  );
}

function eventTitle(event: TaskEvent): string {
  if (event.kind === 'dispatch') return 'dispatch enviado';
  if (event.kind === 'status.changed') return 'status alterado';
  if (event.kind === 'handoff') return 'handoff criado';
  return event.kind;
}

function eventSummary(event: TaskEvent): string {
  const payload = event.payload ?? {};
  if (event.kind === 'dispatch') {
    const tmux = typeof payload.tmux_session === 'string' ? payload.tmux_session : 'tmux';
    const run = typeof payload.run_id === 'number' ? ` · run #${payload.run_id}` : '';
    return `${tmux}${run}`;
  }
  if (event.kind === 'status.changed') {
    const fromStatus = typeof payload.from_status === 'string' ? payload.from_status : '?';
    const toStatus = typeof payload.to_status === 'string' ? payload.to_status : '?';
    const closedRuns = typeof payload.closed_runs === 'number' ? ` · runs fechados: ${payload.closed_runs}` : '';
    return `${fromStatus} -> ${toStatus}${closedRuns}`;
  }
  if (event.kind === 'handoff') {
    const to = typeof payload.to === 'string' ? payload.to : 'agente';
    return `para ${to}`;
  }
  return event.agent_slug ?? 'evento';
}

export function TaskDetailModal({
  task,
  onOpenChange,
}: {
  task: Task | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { events, mutate } = useFleet();
  const { fire } = useToast();
  const [freshTask, setFreshTask] = useState<Task | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const effectiveTask = freshTask ?? task;
  const timeline = useMemo(
    () => events.filter((event) => event.task_id === effectiveTask?.id).slice(0, 12),
    [events, effectiveTask?.id],
  );
  const selectedStatus = useMemo<TaskPatchStatus>(
    () => (effectiveTask?.status === 'archived' ? 'done' : (effectiveTask?.status ?? 'backlog')),
    [effectiveTask?.status],
  );

  useEffect(() => {
    if (!task) {
      setFreshTask(null);
      setLoadState('idle');
      setMessage(null);
      setSaving(false);
      setDispatching(false);
      return;
    }

    const ctrl = new AbortController();
    setFreshTask(null);
    setLoadState('loading');
    setMessage(null);

    fetchTask(task.id, ctrl.signal)
      .then((data) => {
        setFreshTask(data);
        setLoadState('ready');
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setLoadState('error');
        setMessage(err instanceof Error ? err.message : String(err));
      });

    return () => ctrl.abort();
  }, [task]);

  async function changeStatus(next: TaskPatchStatus) {
    if (!effectiveTask || next === effectiveTask.status || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await patchTaskStatus(effectiveTask.id, next);
      setFreshTask(updated);
      await mutate();
      fire({
        kind: 'success',
        msg: `STATUS · ${taskDisplayId(updated)}`,
        sub: STATUS_OPTIONS.find((s) => s.value === updated.status)?.label ?? updated.status,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(msg);
      fire({ kind: 'warn', msg: 'STATUS NÃO ALTERADO', sub: msg });
    } finally {
      setSaving(false);
    }
  }

  async function dispatchToSession() {
    if (!effectiveTask || dispatching) return;
    if (effectiveTask.status === 'running') {
      fire({
        kind: 'warn',
        msg: `EM EXECUÇÃO · ${taskDisplayId(effectiveTask)}`,
        sub: 'REENVIO EXIGE CONFIRMAÇÃO',
      });
      return;
    }
    setDispatching(true);
    setMessage(null);
    try {
      const result = await dispatchTask(effectiveTask.id);
      setFreshTask(result.task);
      await mutate();
      fire({
        kind: 'success',
        msg: `ENVIADA · ${taskDisplayId(result.task)}`,
        sub: result.tmux_delivered ? 'TMUX OK' : 'TMUX SEM CONFIRMAÇÃO',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(msg);
      fire({ kind: 'warn', msg: 'ENVIO FALHOU', sub: msg });
    } finally {
      setDispatching(false);
    }
  }

  return (
    <Dialog.Root open={task !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="agent-modal-overlay" />
        <Dialog.Content className="agent-modal-frame task-detail-frame mono" aria-describedby={undefined}>
          {effectiveTask && (
            <>
              <header className="agent-modal-head">
                <div className="head-left">
                  <Dialog.Title className="agent-modal-title">
                    {taskDisplayId(effectiveTask)} <span className="muted">// {effectiveTask.title}</span>
                  </Dialog.Title>
                  <span className="agent-modal-role">DETALHE DA TAREFA</span>
                </div>
                <div className="head-right">
                  <span className="status-bar" data-state={selectedStatus === 'backlog' || selectedStatus === 'ready' ? 'idle' : selectedStatus}>
                    <span className="sdot" />
                    {STATUS_OPTIONS.find((s) => s.value === selectedStatus)?.label ?? selectedStatus}
                  </span>
                  <Dialog.Close asChild>
                    <button type="button" className="agent-modal-close" aria-label="Fechar detalhe">X</button>
                  </Dialog.Close>
                </div>
              </header>

              <div className="task-detail-body">
                <section className="task-detail-main">
                  <Field label="ID" value={effectiveTask.human_id || effectiveTask.id} />
                  <Field label="UUID" value={effectiveTask.id} />
                  <Field label="TÍTULO" value={effectiveTask.title} />
                  <div className="task-detail-field task-detail-body-field">
                    <span className="task-detail-key">BODY</span>
                    <p className="task-detail-value">{effectiveTask.body?.trim() || '—'}</p>
                  </div>
                </section>

                <aside className="task-detail-side">
                  <SelectField<TaskPatchStatus>
                    label="Status"
                    value={selectedStatus}
                    onValueChange={changeStatus}
                    options={STATUS_OPTIONS}
                    disabled={saving || loadState === 'loading'}
                  />
                  <Field label="RESPONSÁVEL" value={effectiveTask.assignee} />
                  <Field label="PRIORIDADE" value={effectiveTask.priority} />
                  <Field label="ORIGEM" value={effectiveTask.origin_agent} />
                  <Field label="INSTÂNCIA" value={effectiveTask.instance_id} />
                  <Field label="CRIADA" value={formatUnixDateTime(effectiveTask.created_at)} />
                  <Field label="INICIADA" value={formatUnixDateTime(effectiveTask.started_at)} />
                  <Field label="CONCLUÍDA" value={formatUnixDateTime(effectiveTask.completed_at)} />
                </aside>
              </div>

              <section className="task-timeline">
                <div className="task-timeline-head">
                  <span>TIMELINE</span>
                  <span>{timeline.length === 0 ? 'SEM EVENTOS NO BUFFER' : `${timeline.length} EVENTOS`}</span>
                </div>
                <ol>
                  <li>
                    <span className="task-timeline-at">{formatUnixDateTime(effectiveTask.created_at)}</span>
                    <span className="task-timeline-kind">criada</span>
                    <span className="task-timeline-summary">{effectiveTask.assignee ?? 'sem responsável'}</span>
                  </li>
                  {timeline.map((event) => (
                    <li key={event.id}>
                      <span className="task-timeline-at">{formatUnixDateTime(event.created_at)}</span>
                      <span className="task-timeline-kind">{eventTitle(event)}</span>
                      <span className="task-timeline-summary">{eventSummary(event)}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <footer className="agent-modal-footer task-detail-footer">
                <div className="task-detail-footer-info">
                  <span>{loadState === 'loading' ? 'carregando detalhe fresco...' : 'snapshot sincronizado'}</span>
                  {saving && <span>salvando status...</span>}
                  {dispatching && <span>enviando para sessão...</span>}
                  {message && <span className="task-detail-error">{message}</span>}
                </div>
                <button
                  type="button"
                  className="form-submit task-detail-dispatch"
                  disabled={dispatching || saving || effectiveTask.status === 'done' || effectiveTask.status === 'running'}
                  onClick={dispatchToSession}
                >
                  {dispatching ? 'ENVIANDO...' : effectiveTask.status === 'running' ? 'EM EXECUÇÃO' : 'ENVIAR SESSÃO'}
                </button>
              </footer>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
