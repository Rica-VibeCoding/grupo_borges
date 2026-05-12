'use client';

import { useCallback, useState } from 'react';
import type { ReviewAction, Task } from '../lib/cockpit-types';
import { reviewTask } from '../lib/api';

type Props = {
  task: Task;
  reviewerSlug?: string | null;
  onResolved: (newStatus: Task['status']) => void;
  onError: (msg: string) => void;
  onSuccess: (action: ReviewAction) => void;
};

type ActionMeta = { label: string; pending: string; icon: string; cssClass: string };

const ACTION_META: Record<ReviewAction, ActionMeta> = {
  accept: { label: 'ACEITAR', pending: 'ACEITANDO...', icon: '✓', cssClass: 'task-review-accept' },
  reject: { label: 'REJEITAR', pending: 'REJEITANDO...', icon: '↻', cssClass: 'task-review-reject' },
  requeue: { label: 'RE-ENFILEIRAR', pending: 'REENFILEIRANDO...', icon: '⇄', cssClass: 'task-review-requeue' },
};

const ACTION_ORDER: ReviewAction[] = ['accept', 'reject', 'requeue'];

export function TaskReviewActions({ task, reviewerSlug, onResolved, onError, onSuccess }: Props) {
  const [pending, setPending] = useState<ReviewAction | null>(null);
  const [note, setNote] = useState('');
  const reviewMode = task.review_mode ?? 'human';
  const tags = task.tags ?? [];
  const requiresEvidence = reviewMode === 'agent_autonomous';

  const submit = useCallback(
    async (action: ReviewAction) => {
      if (pending !== null) return;
      const trimmedNote = note.trim();
      if (action === 'reject' && !trimmedNote) {
        onError('rejeição exige nota explicando o que voltar pro agente');
        return;
      }
      setPending(action);
      try {
        const result = await reviewTask(
          task.id,
          {
            action,
            note: trimmedNote || null,
          },
          reviewerSlug,
        );
        onSuccess(action);
        onResolved(result.new_status);
        if (action === 'reject') setNote('');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onError(msg);
      } finally {
        setPending(null);
      }
    },
    [note, onError, onResolved, onSuccess, pending, reviewerSlug, task.id],
  );

  return (
    <section className="task-review" data-mode={reviewMode}>
      <header className="task-review-head">
        <span className="task-review-pulse" aria-hidden="true" />
        <span className="task-review-title">REVISÃO PENDENTE</span>
        <span className="task-review-mode" data-mode={reviewMode}>
          {reviewMode === 'human' && 'HUMANA'}
          {reviewMode === 'agent_advisory' && 'ADVISORY'}
          {reviewMode === 'agent_autonomous' && 'AUTONOMOUS'}
        </span>
        {tags.length > 0 && (
          <span className="task-review-tags" aria-label="tags da task">
            {tags.map((t) => (
              <span key={t} className="task-review-tag">{t}</span>
            ))}
          </span>
        )}
      </header>

      {requiresEvidence && (
        <p className="task-review-hint">
          modo autonomous · este card exige evidence_refs e critérios machine-checkable. UI básica:
          aprovação manual aqui não substitui validação de critério (ver painel /reviews).
        </p>
      )}

      <label className="task-review-note">
        <span>NOTA (obrigatória pra rejeitar)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="contexto da decisão — vai pro audit log"
          maxLength={1000}
          rows={3}
          disabled={pending !== null}
        />
      </label>

      <div className="task-review-buttons">
        {ACTION_ORDER.map((action) => {
          const meta = ACTION_META[action];
          const isPending = pending === action;
          return (
            <button
              key={action}
              type="button"
              className={`task-review-btn ${meta.cssClass}`}
              onClick={() => submit(action)}
              disabled={pending !== null}
              data-pending={isPending}
            >
              {isPending ? meta.pending : `${meta.icon} ${meta.label}`}
            </button>
          );
        })}
      </div>

      <p className="task-review-foot">
        ACEITAR → done · REJEITAR → running (volta pro agente com nota) · RE-ENFILEIRAR → ready
      </p>
    </section>
  );
}
