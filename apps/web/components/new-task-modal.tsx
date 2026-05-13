'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { createTask, type TaskPatchStatus } from '../lib/api';
import type { ReviewMode } from '../lib/cockpit-types';
import { useFleet } from '../lib/fleet-context';
import { useToast } from '../lib/toast-context';
import { SelectField } from './select-field';

type UiTaskStatus = Exclude<TaskPatchStatus, 'ready'>;

const STATUS_OPTIONS: Array<{ value: UiTaskStatus; label: string }> = [
  { value: 'backlog', label: 'BACKLOG' },
  { value: 'running', label: 'EXECUTANDO' },
  { value: 'review', label: 'REVISÃO' },
  { value: 'blocked', label: 'BLOQUEADO' },
];

const VETOED_TAGS = new Set([
  'deploy_prod',
  'db_migration',
  'customer_email',
  'customer_whatsapp',
  'financial_op',
  'send_external',
]);

const RICA_REVIEWER_SENTINEL = '__rica__';

const REVIEW_MODE_OPTIONS: Array<{
  value: ReviewMode;
  label: string;
  desc: string;
}> = [
  {
    value: 'human',
    label: 'HUMANA',
    desc: 'default — Rica revisa manualmente',
  },
  {
    value: 'agent_advisory',
    label: 'ADVISORY',
    desc: 'agente dá parecer, Rica confirma',
  },
  {
    value: 'agent_autonomous',
    label: 'AUTONOMOUS',
    desc: 'agente decide e segue (exige Success Criteria + evidence_refs)',
  },
];

function safeUUID(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NewTaskModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { fleet, mutate } = useFleet();
  const { fire } = useToast();
  const titleRef = useRef<HTMLInputElement>(null);
  const agentOptions = useMemo(
    () => fleet.agents.map((agent) => ({ value: agent.slug, label: `${agent.name} · ${agent.slug}` })),
    [fleet.agents],
  );
  const firstAgent = agentOptions[0]?.value ?? '';
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState(firstAgent);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<UiTaskStatus>('backlog');
  const [priority, setPriority] = useState('0');
  const [reviewMode, setReviewMode] = useState<ReviewMode>('human');
  const [reviewerAssignee, setReviewerAssignee] = useState<string>(RICA_REVIEWER_SENTINEL);
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reviewerOptions = useMemo(
    () => [
      { value: RICA_REVIEWER_SENTINEL, label: '— Rica (humano) —' },
      ...fleet.agents.map((a) => ({ value: a.slug, label: `${a.name} · ${a.slug}` })),
    ],
    [fleet.agents],
  );

  useEffect(() => {
    if (!assignee && firstAgent) setAssignee(firstAgent);
  }, [assignee, firstAgent]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setBody('');
      setStatus('backlog');
      setPriority('0');
      setReviewMode('human');
      setReviewerAssignee(RICA_REVIEWER_SENTINEL);
      setTagsInput('');
      setSaving(false);
      setMessage(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !assignee || saving) return;

    setSaving(true);
    setMessage(null);
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      const created = await createTask({
        title: trimmedTitle,
        assignee,
        body: body.trim() || null,
        status,
        priority: Number.parseInt(priority, 10) || 0,
        idempotency_key: safeUUID(),
        review_mode: reviewMode,
        reviewer_assignee:
          reviewerAssignee && reviewerAssignee !== RICA_REVIEWER_SENTINEL
            ? reviewerAssignee
            : null,
        tags: tags.length > 0 ? tags : null,
      });
      await mutate();
      fire({
        kind: 'success',
        msg: `TAREFA · ${created.human_id || created.id.slice(0, 8)}`,
        sub: 'CRIADA NO KANBAN',
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(msg);
      fire({ kind: 'warn', msg: 'TAREFA NÃO CRIADA', sub: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="agent-modal-overlay" />
        <Dialog.Content
          className="agent-modal-frame new-task-frame mono"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            titleRef.current?.focus();
          }}
        >
          <header className="agent-modal-head">
            <div className="head-left">
              <Dialog.Title className="agent-modal-title">Nova tarefa</Dialog.Title>
              <span className="agent-modal-role">PLANTAR MISSÃO NO KANBAN</span>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="agent-modal-close" aria-label="Fechar criação">X</button>
            </Dialog.Close>
          </header>

          <form className="new-task-form" onSubmit={submit}>
            <label className="new-task-field">
              <span>Título</span>
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                maxLength={500}
                required
              />
            </label>

            <SelectField<string>
              label="Responsável"
              value={assignee}
              onValueChange={setAssignee}
              options={agentOptions}
              disabled={agentOptions.length === 0 || saving}
            />

            <div className="new-task-row">
              <SelectField<UiTaskStatus>
                label="Status"
                value={status}
                onValueChange={setStatus}
                options={STATUS_OPTIONS}
                disabled={saving}
              />
              <label className="new-task-field">
                <span>Prioridade</span>
                <input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(e.currentTarget.value)}
                  inputMode="numeric"
                />
              </label>
            </div>

            <label className="new-task-field">
              <span>Body</span>
              <textarea value={body} onChange={(e) => setBody(e.currentTarget.value)} />
            </label>

            <fieldset className="new-task-review">
              <legend>Modo de revisão</legend>
              <div className="review-mode-radios" role="radiogroup" aria-label="Modo de revisão">
                {REVIEW_MODE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="review-mode-option"
                    data-checked={reviewMode === opt.value}
                  >
                    <input
                      type="radio"
                      name="review_mode"
                      value={opt.value}
                      checked={reviewMode === opt.value}
                      onChange={() => setReviewMode(opt.value)}
                      disabled={saving}
                    />
                    <span className="review-mode-label">{opt.label}</span>
                    <span className="review-mode-desc">{opt.desc}</span>
                  </label>
                ))}
              </div>

              <div className="new-task-row">
                <SelectField<string>
                  label="Revisor"
                  value={reviewerAssignee}
                  onValueChange={setReviewerAssignee}
                  options={reviewerOptions}
                  disabled={saving || reviewMode === 'human'}
                />
                <label className="new-task-field">
                  <span>Tags (vírgula)</span>
                  <input
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.currentTarget.value)}
                    placeholder="deploy_prod, db_migration"
                    disabled={saving}
                  />
                </label>
              </div>

              {reviewMode === 'agent_autonomous' && (() => {
                const inlineTags = tagsInput
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean);
                const conflicts = inlineTags.filter((t) => VETOED_TAGS.has(t));
                return (
                  <>
                    <p className="form-note" data-kind="warn">
                      Modo autonomous é OPT-IN. Tasks com tag vetada (deploy_prod, db_migration,
                      customer_email, customer_whatsapp, financial_op, send_external) são recusadas
                      pelo backend.
                    </p>
                    {conflicts.length > 0 && (
                      <p className="form-note" data-kind="error">
                        ⚠️ tag vetada para autonomous: <strong>{conflicts.join(', ')}</strong>.
                        Mude pra <code>human</code>/<code>agent_advisory</code> ou remova a tag.
                      </p>
                    )}
                  </>
                );
              })()}
            </fieldset>

            {message && <p className="form-note" data-kind="error">{message}</p>}

            <footer className="new-task-actions">
              <Dialog.Close asChild>
                <button type="button" className="form-cancel" disabled={saving}>CANCELAR</button>
              </Dialog.Close>
              <button type="submit" className="form-submit" disabled={saving || !title.trim() || !assignee}>
                {saving ? 'CRIANDO...' : 'CRIAR'}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
