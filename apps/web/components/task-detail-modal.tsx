'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ReviewAction, Task, TaskEvent } from '../lib/cockpit-types';
import { deleteTask, dispatchTask, fetchTask, patchTaskStatus, type TaskPatchStatus } from '../lib/api';
import { useFleet } from '../lib/fleet-context';
import { useToast } from '../lib/toast-context';
import { SelectField } from './select-field';
import { TaskEditForm } from './task-edit-form';
import { TaskCommitsList } from './task-commits-list';
import { TaskReviewActions } from './task-review-actions';
import { SubsessionPopover } from './subsession-popover';
import { formatDateTime } from '../lib/format-time';

type UiTaskStatus = Exclude<TaskPatchStatus, 'ready'>;

const STATUS_OPTIONS: Array<{ value: UiTaskStatus; label: string }> = [
  { value: 'backlog', label: 'BACKLOG' },
  { value: 'running', label: 'EXECUTANDO' },
  { value: 'review', label: 'REVISÃO' },
  { value: 'blocked', label: 'BLOQUEADO' },
  { value: 'done', label: 'CONCLUÍDO' },
];

const REVIEW_ACTION_TOAST_LABEL: Record<ReviewAction, string> = {
  accept: 'ACEITA',
  reject: 'REJEITADA',
  requeue: 'REENFILEIRADA',
};

function uiStatus(status: TaskPatchStatus | 'archived' | undefined): UiTaskStatus {
  if (status === 'archived' || status === 'done') return 'done';
  if (status === 'ready' || status === undefined) return 'backlog';
  return status;
}

function taskDisplayId(task: Task): string {
  return task.human_id || task.id.slice(0, 8);
}

function formatUnixDateTime(unixSec: number | null): string {
  if (unixSec === null) return '—';
  return formatDateTime(unixSec);
}

const TIMELINE_FMT = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Sao_Paulo',
});

function formatTimelineTime(unixSec: number): string {
  return TIMELINE_FMT.format(new Date(unixSec * 1000));
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
  if (event.kind === 'dispatch') return 'dispatch';
  if (event.kind === 'dispatch.failed') return 'dispatch falhou';
  if (event.kind === 'run.stale') return 'run sem sinal';
  if (event.kind === 'status.changed') {
    const to = event.payload?.to_status;
    return typeof to === 'string' ? to : 'status';
  }
  if (event.kind === 'handoff') return 'handoff';
  return event.kind;
}

function eventSummary(event: TaskEvent): string {
  const payload = event.payload ?? {};
  if (event.kind === 'dispatch') {
    const tmux = typeof payload.tmux_session === 'string' ? payload.tmux_session : 'tmux';
    const run = typeof payload.run_id === 'number' ? ` · run #${payload.run_id}` : '';
    return `${tmux}${run}`;
  }
  if (event.kind === 'dispatch.failed') {
    const reason = typeof payload.reason === 'string' ? payload.reason : 'falha desconhecida';
    const run = typeof payload.run_id === 'number' ? ` · run #${payload.run_id}` : '';
    return `${reason}${run}`;
  }
  if (event.kind === 'run.stale') {
    const threshold = typeof payload.threshold_seconds === 'number' ? ` · limite ${payload.threshold_seconds}s` : '';
    const run = typeof payload.run_id === 'number' ? `run #${payload.run_id}` : 'run';
    return `${run} · heartbeat expirado${threshold}`;
  }
  if (event.kind === 'status.changed') {
    return event.agent_slug ?? '—';
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
  const { events, fleet, mutate } = useFleet();
  const { fire } = useToast();
  const [freshTask, setFreshTask] = useState<Task | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const agentOptions = useMemo(
    () => fleet.agents.map((a) => ({ value: a.slug, label: `${a.name} · ${a.slug}` })),
    [fleet.agents],
  );
  const effectiveTask = freshTask ?? task;
  const timeline = useMemo(
    () => events.filter((event) => event.task_id === effectiveTask?.id).slice(0, 12),
    [events, effectiveTask?.id],
  );
  const timelineEntries = useMemo<
    Array<{ id: string; at: number; kind: string; summary: string }>
  >(() => {
    if (!effectiveTask) return [];
    const out: Array<{ id: string; at: number; kind: string; summary: string }> = [];
    const assignee = effectiveTask.assignee ?? 'sem responsável';
    out.push({ id: 'syn-created', at: effectiveTask.created_at, kind: 'criada', summary: assignee });
    if (effectiveTask.started_at && effectiveTask.started_at > effectiveTask.created_at) {
      out.push({ id: 'syn-started', at: effectiveTask.started_at, kind: 'iniciada', summary: assignee });
    }
    if (
      effectiveTask.completed_at &&
      effectiveTask.completed_at > (effectiveTask.started_at ?? effectiveTask.created_at)
    ) {
      const kind =
        effectiveTask.status === 'done' || effectiveTask.status === 'archived'
          ? 'concluída'
          : 'finalizada';
      out.push({ id: 'syn-completed', at: effectiveTask.completed_at, kind, summary: assignee });
    }
    for (const e of timeline) {
      out.push({ id: `evt-${e.id}`, at: e.created_at, kind: eventTitle(e), summary: eventSummary(e) });
    }
    out.sort((a, b) => a.at - b.at);
    return out;
  }, [effectiveTask, timeline]);
  const selectedStatus = useMemo<UiTaskStatus>(
    () => uiStatus(effectiveTask?.status),
    [effectiveTask?.status],
  );
  const runHeartbeatAge = effectiveTask?.current_run_last_heartbeat
    ? fleet.health.server_now - effectiveTask.current_run_last_heartbeat
    : null;
  const runHeartbeatStale = runHeartbeatAge !== null && runHeartbeatAge > fleet.health.stale_threshold_seconds;
  const tagsList = useMemo<string[]>(() => {
    const raw = effectiveTask?.tags;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw) {
      try {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) return p;
      } catch {
        // ignore
      }
    }
    return [];
  }, [effectiveTask?.tags]);
  const reviewModeLabel = (effectiveTask?.review_mode ?? 'human').toUpperCase();
  const metaSummaryChips = [reviewModeLabel, ...tagsList.map((t) => t.toUpperCase())];

  useEffect(() => {
    if (!task) {
      setFreshTask(null);
      setLoadState('idle');
      setMessage(null);
      setSaving(false);
      setDispatching(false);
      setEditing(false);
      setConfirmDelete(false);
      setDeleting(false);
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

  async function changeStatus(next: UiTaskStatus) {
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

  async function handleDelete() {
    if (!effectiveTask || deleting) return;
    setDeleting(true);
    setMessage(null);
    try {
      await deleteTask(effectiveTask.id);
      await mutate();
      fire({ kind: 'success', msg: `EXCLUÍDA · ${taskDisplayId(effectiveTask)}` });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(msg);
      fire({ kind: 'warn', msg: 'ERRO AO EXCLUIR', sub: msg });
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
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
                </div>
                <div className="head-right">
                  <span className="status-bar" data-state={selectedStatus === 'backlog' ? 'idle' : selectedStatus}>
                    <span className="sdot" />
                    {STATUS_OPTIONS.find((s) => s.value === selectedStatus)?.label ?? selectedStatus}
                  </span>
                  <Dialog.Close asChild>
                    <button type="button" className="agent-modal-close" aria-label="Fechar detalhe">✕</button>
                  </Dialog.Close>
                </div>
              </header>

              <div className="task-detail-body">
                <section className="task-detail-main">
                  {editing && (effectiveTask.status === 'backlog' || effectiveTask.status === 'ready') ? (
                    <TaskEditForm
                      task={effectiveTask}
                      mode="full"
                      agentOptions={agentOptions}
                      onSaved={(updated) => {
                        setFreshTask(updated);
                        void mutate();
                        setEditing(false);
                        fire({
                          kind: 'success',
                          msg: `EDITADA · ${taskDisplayId(updated)}`,
                          sub: 'CAMPOS ATUALIZADOS',
                        });
                      }}
                      onError={(msg) => {
                        setMessage(msg);
                        fire({ kind: 'warn', msg: 'EDIÇÃO FALHOU', sub: msg });
                      }}
                      onCancel={() => setEditing(false)}
                    />
                  ) : (
                    <>
                      <div className="task-detail-field task-detail-body-field">
                        <span className="task-detail-key">BODY</span>
                        <p className="task-detail-value">{effectiveTask.body?.trim() || '—'}</p>
                      </div>
                    </>
                  )}
                </section>

                <TaskCommitsList taskId={effectiveTask.id} />
              </div>

              {effectiveTask.status === 'review' && (
                <TaskReviewActions
                  task={effectiveTask}
                  reviewerSlug={effectiveTask.reviewer_assignee}
                  onResolved={(newStatus) => {
                    setFreshTask((prev) => (prev ? { ...prev, status: newStatus } : prev));
                    void mutate();
                  }}
                  onError={(msg) => {
                    setMessage(msg);
                    fire({ kind: 'warn', msg: 'REVIEW NÃO APLICADA', sub: msg });
                  }}
                  onSuccess={(action) => {
                    fire({
                      kind: 'success',
                      msg: `REVIEW · ${taskDisplayId(effectiveTask)}`,
                      sub: REVIEW_ACTION_TOAST_LABEL[action],
                    });
                  }}
                />
              )}

              <section className="task-timeline">
                <ol>
                  {timelineEntries.map((entry) => (
                    <li key={entry.id}>
                      <span className="task-timeline-at">{formatTimelineTime(entry.at)}</span>
                      <span className="task-timeline-kind">{entry.kind}</span>
                      <span className="task-timeline-summary">{entry.summary}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <details className="task-detail-side-collapse">
                <summary>
                  <span className="task-detail-side-chips">
                    {metaSummaryChips.map((chip, idx) => (
                      <span key={`${chip}-${idx}`}>{chip}</span>
                    ))}
                  </span>
                </summary>
                <aside className="task-detail-side">
                  <SelectField<UiTaskStatus>
                    label="Status"
                    value={selectedStatus}
                    onValueChange={changeStatus}
                    options={STATUS_OPTIONS}
                    disabled={saving || loadState === 'loading'}
                  />
                  <Field label="ID" value={effectiveTask.human_id || effectiveTask.id.slice(0, 8)} />
                  <Field label="UUID" value={effectiveTask.id} />
                  <Field label="RESPONSÁVEL" value={effectiveTask.assignee} />
                  <Field label="PRIORIDADE" value={effectiveTask.priority} />
                  <Field label="ORIGEM" value={effectiveTask.origin_agent} />
                  <Field label="MODO REVISÃO" value={effectiveTask.review_mode ?? 'human'} />
                  {effectiveTask.reviewer_assignee && (
                    <Field label="REVISOR" value={effectiveTask.reviewer_assignee} />
                  )}
                  {tagsList.length > 0 && <Field label="TAGS" value={tagsList.join(', ')} />}
                  <Field label="INSTÂNCIA" value={effectiveTask.instance_id} />
                  <Field label="RUN" value={effectiveTask.current_run_id ?? null} />
                  <Field label="RUN STATUS" value={effectiveTask.current_run_status} />
                  <Field
                    label="RUN HB"
                    value={
                      effectiveTask.current_run_last_heartbeat
                        ? formatUnixDateTime(effectiveTask.current_run_last_heartbeat)
                        : null
                    }
                  />
                  <Field label="CRIADA" value={formatUnixDateTime(effectiveTask.created_at)} />
                  <Field label="INICIADA" value={formatUnixDateTime(effectiveTask.started_at)} />
                  <Field label="CONCLUÍDA" value={formatUnixDateTime(effectiveTask.completed_at)} />
                </aside>
              </details>

              <footer className="agent-modal-footer task-detail-footer">
                {effectiveTask.assignee && !editing && !confirmDelete && (
                  <SubsessionPopover
                    taskId={effectiveTask.id}
                    agentSlug={effectiveTask.assignee}
                  />
                )}
                <div className="task-detail-footer-info">
                  {loadState === 'loading' && <span>carregando detalhe fresco...</span>}
                  {runHeartbeatStale && <span className="task-detail-error">run sem heartbeat recente</span>}
                  {saving && <span>salvando status...</span>}
                  {dispatching && <span>enviando para sessão...</span>}
                  {deleting && <span>excluindo...</span>}
                  {message && <span className="task-detail-error">{message}</span>}
                </div>
                {!editing &&
                  !confirmDelete &&
                  (effectiveTask.status === 'backlog' || effectiveTask.status === 'ready') && (
                    <button
                      type="button"
                      className="form-cancel task-detail-delete"
                      onClick={() => setConfirmDelete(true)}
                      disabled={saving || dispatching || deleting || loadState === 'loading'}
                    >
                      EXCLUIR
                    </button>
                  )}
                {confirmDelete && (
                  <>
                    <button
                      type="button"
                      className="form-cancel task-detail-delete-cancel"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                    >
                      CANCELAR
                    </button>
                    <button
                      type="button"
                      className="form-cancel task-detail-delete-confirm"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? 'EXCLUINDO...' : `CONFIRMAR EXCLUSÃO · ${taskDisplayId(effectiveTask)}`}
                    </button>
                  </>
                )}
                {!editing &&
                  !confirmDelete &&
                  (effectiveTask.status === 'backlog' || effectiveTask.status === 'ready') && (
                    <button
                      type="button"
                      className="form-cancel task-detail-edit"
                      onClick={() => setEditing(true)}
                      disabled={saving || dispatching || deleting || loadState === 'loading'}
                    >
                      EDITAR
                    </button>
                  )}
                {!confirmDelete &&
                  effectiveTask.status !== 'done' &&
                  effectiveTask.status !== 'review' && (
                    <button
                      type="button"
                      className="form-cancel task-detail-complete"
                      onClick={() => changeStatus('done')}
                      disabled={saving || dispatching || deleting || editing || loadState === 'loading'}
                    >
                      CONCLUIR ✓
                    </button>
                  )}
                {effectiveTask.status !== 'review' && !confirmDelete && (
                  <button
                    type="button"
                    className="form-submit task-detail-dispatch"
                    disabled={dispatching || saving || deleting || editing || effectiveTask.status === 'done' || effectiveTask.status === 'running'}
                    onClick={dispatchToSession}
                  >
                    {dispatching ? 'ENVIANDO...' : effectiveTask.status === 'running' ? 'EM EXECUÇÃO' : 'ENVIAR SESSÃO'}
                  </button>
                )}
              </footer>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
