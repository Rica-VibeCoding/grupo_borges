'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReviewMode, Task } from '../lib/cockpit-types';
import { patchTask, type TaskPatchPayload, type TaskPatchStatus } from '../lib/api';
import { SelectField } from './select-field';

/**
 * Edição de task. Regras por status:
 *   backlog/ready → todos os campos liberados (título, body, responsável,
 *     prioridade, tags, modo de revisão, revisor).
 *   running → somente status (re-enfileirar/pausar). Mudar título/body
 *     atrapalha o agente que já leu o envelope.
 *   review/blocked/done → readonly (este form não renderiza).
 */

const RICA_REVIEWER_SENTINEL = '__rica__';

const REVIEW_MODE_OPTIONS: Array<{ value: ReviewMode; label: string }> = [
  { value: 'human', label: 'HUMANA' },
  { value: 'agent_advisory', label: 'ADVISORY' },
  { value: 'agent_autonomous', label: 'AUTONOMOUS' },
];

const VETOED_TAGS = new Set([
  'deploy_prod',
  'db_migration',
  'customer_email',
  'customer_whatsapp',
  'financial_op',
  'send_external',
]);

type Mode = 'full' | 'status-only';

export function TaskEditForm({
  task,
  mode,
  agentOptions,
  onSaved,
  onError,
  onCancel,
}: {
  task: Task;
  mode: Mode;
  agentOptions: Array<{ value: string; label: string }>;
  onSaved: (task: Task) => void;
  onError: (msg: string) => void;
  onCancel: () => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? '');
  const [assignee, setAssignee] = useState(task.assignee ?? '');
  const [priority, setPriority] = useState(String(task.priority ?? 0));
  const [reviewMode, setReviewMode] = useState<ReviewMode>(task.review_mode ?? 'human');
  const [reviewerAssignee, setReviewerAssignee] = useState<string>(
    task.reviewer_assignee || RICA_REVIEWER_SENTINEL,
  );
  const [tagsInput, setTagsInput] = useState((task.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const reviewerOptions = [
    { value: RICA_REVIEWER_SENTINEL, label: '— Rica (humano) —' },
    ...agentOptions,
  ];

  const tagsList = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const autonomousConflicts =
    reviewMode === 'agent_autonomous' ? tagsList.filter((t) => VETOED_TAGS.has(t)) : [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const trimmedTitle = title.trim();
    if (mode === 'full' && !trimmedTitle) {
      onError('Título não pode ficar vazio');
      return;
    }
    if (autonomousConflicts.length > 0) {
      onError(`Tag vetada para autonomous: ${autonomousConflicts.join(', ')}`);
      return;
    }

    setSaving(true);
    const fields: TaskPatchPayload = {};
    if (mode === 'full') {
      if (trimmedTitle !== task.title) fields.title = trimmedTitle;
      const trimmedBody = body.trim();
      const originalBody = (task.body ?? '').trim();
      if (trimmedBody !== originalBody) fields.body = trimmedBody || null;
      if (assignee && assignee !== task.assignee) fields.assignee = assignee;
      const prioNum = Number.parseInt(priority, 10);
      if (Number.isFinite(prioNum) && prioNum !== task.priority) fields.priority = prioNum;
      if (reviewMode !== (task.review_mode ?? 'human')) fields.review_mode = reviewMode;
      const reviewerOut =
        reviewerAssignee && reviewerAssignee !== RICA_REVIEWER_SENTINEL
          ? reviewerAssignee
          : null;
      if (reviewerOut !== (task.reviewer_assignee ?? null)) {
        fields.reviewer_assignee = reviewerOut;
      }
      const tagsOut = tagsList.length > 0 ? tagsList : null;
      const originalTags = task.tags ?? null;
      if (JSON.stringify(tagsOut) !== JSON.stringify(originalTags)) {
        fields.tags = tagsOut;
      }
    }

    if (Object.keys(fields).length === 0) {
      if (mountedRef.current) setSaving(false);
      onCancel();
      return;
    }

    try {
      const updated = await patchTask(task.id, fields);
      if (!mountedRef.current) return;
      onSaved(updated);
    } catch (err) {
      if (!mountedRef.current) return;
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  if (mode === 'status-only') {
    return (
      <section className="task-edit-form" data-mode="status-only">
        <p className="task-edit-hint">
          Task em execução — alteração de título/body/responsável atrapalha o agente que já leu o
          envelope. Para mudar status, use o seletor STATUS acima.
        </p>
      </section>
    );
  }

  return (
    <form className="task-edit-form" onSubmit={submit} data-mode="full">
      <label className="new-task-field">
        <span>Título</span>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          maxLength={500}
          disabled={saving}
          required
        />
      </label>

      <label className="new-task-field">
        <span>Body</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          disabled={saving}
          rows={6}
        />
      </label>

      <div className="new-task-row">
        <SelectField<string>
          label="Responsável"
          value={assignee}
          onValueChange={setAssignee}
          options={agentOptions}
          disabled={agentOptions.length === 0 || saving}
        />
        <label className="new-task-field">
          <span>Prioridade</span>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.currentTarget.value)}
            inputMode="numeric"
            disabled={saving}
          />
        </label>
      </div>

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
                name="task_edit_review_mode"
                value={opt.value}
                checked={reviewMode === opt.value}
                onChange={() => setReviewMode(opt.value)}
                disabled={saving}
              />
              <span className="review-mode-label">{opt.label}</span>
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

        {autonomousConflicts.length > 0 && (
          <p className="form-note" data-kind="error">
            ⚠️ tag vetada para autonomous: <strong>{autonomousConflicts.join(', ')}</strong>
          </p>
        )}
      </fieldset>

      <footer className="new-task-actions">
        <button type="button" className="form-cancel" disabled={saving} onClick={onCancel}>
          CANCELAR
        </button>
        <button
          type="submit"
          className="form-submit"
          disabled={saving || !title.trim() || autonomousConflicts.length > 0}
        >
          {saving ? 'SALVANDO...' : 'SALVAR'}
        </button>
      </footer>
    </form>
  );
}
