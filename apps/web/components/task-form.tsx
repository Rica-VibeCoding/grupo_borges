'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { REVIEW_MODE_OPTIONS } from '../lib/cockpit-types';
import type { ReviewMode, Task } from '../lib/cockpit-types';
import type { TaskPatchStatus } from '../lib/api';
import { SelectField } from './select-field';
import { useToast } from '../lib/toast-context';

export type TaskFormValues = {
  title: string;
  assignee: string;
  body: string | null;
  status?: TaskPatchStatus;
  priority: number;
  review_mode: ReviewMode;
  reviewer_assignee: string | null;
  tags: string[] | null;
};

export type TaskFormProps = {
  mode: 'create' | 'edit';
  initial?: Task;
  agentOptions: Array<{ value: string; label: string }>;
  onSubmit: (values: TaskFormValues, pendingFiles: File[]) => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
  errorMessage?: string | null;
};

type UiStatus = 'backlog' | 'running' | 'review' | 'blocked';

const STATUS_OPTIONS: Array<{ value: UiStatus; label: string }> = [
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

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export function TaskForm({
  mode,
  initial,
  agentOptions,
  onSubmit,
  onCancel,
  saving = false,
  errorMessage = null,
}: TaskFormProps) {
  const { fire } = useToast();
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [assignee, setAssignee] = useState(initial?.assignee ?? agentOptions[0]?.value ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [status, setStatus] = useState<UiStatus>('backlog');
  const [priority, setPriority] = useState(String(initial?.priority ?? 0));
  const [reviewMode, setReviewMode] = useState<ReviewMode>(initial?.review_mode ?? 'human');
  const [reviewerAssignee, setReviewerAssignee] = useState<string>(
    initial?.reviewer_assignee || RICA_REVIEWER_SENTINEL,
  );
  const [tagsInput, setTagsInput] = useState((initial?.tags ?? []).join(', '));

  // Attachments
  const persistedUrls: string[] = mode === 'edit' && Array.isArray(initial?.image_urls)
    ? (initial.image_urls as string[])
    : [];
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingThumbUrls, setPendingThumbUrls] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  // Auto-focus on mount (edit mode; create mode is handled by Dialog onOpenAutoFocus)
  useEffect(() => {
    if (mode === 'edit') {
      titleRef.current?.focus();
    }
  }, [mode]);

  // Revoke pending thumb object URLs on change
  useEffect(() => {
    const urls = pendingFiles.map((f) => URL.createObjectURL(f));
    setPendingThumbUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [pendingFiles]);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      const accepted: File[] = [];
      const currentTotal = persistedUrls.length + pendingFiles.length;
      for (const f of list) {
        if (!f.type.startsWith('image/')) {
          fire({ kind: 'warn', msg: 'ARQUIVO REJEITADO', sub: `${f.name}: tipo inválido (apenas image/*)` });
          continue;
        }
        if (f.size > MAX_SIZE) {
          fire({ kind: 'warn', msg: 'ARQUIVO REJEITADO', sub: `${f.name}: excede 10 MB` });
          continue;
        }
        if (currentTotal + accepted.length >= MAX_FILES) {
          fire({ kind: 'warn', msg: 'ARQUIVO REJEITADO', sub: `Limite de ${MAX_FILES} imagens atingido` });
          break;
        }
        accepted.push(f);
      }
      if (accepted.length > 0) {
        setPendingFiles((prev) => [...prev, ...accepted]);
      }
    },
    [persistedUrls.length, pendingFiles.length, fire],
  );

  const removePending = useCallback((idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
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

  const totalAttachments = persistedUrls.length + pendingFiles.length;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle || !assignee) return;
    if (autonomousConflicts.length > 0) return;

    const values: TaskFormValues = {
      title: trimmedTitle,
      assignee,
      body: body.trim() || null,
      priority: Number.parseInt(priority, 10) || 0,
      review_mode: reviewMode,
      reviewer_assignee:
        reviewerAssignee && reviewerAssignee !== RICA_REVIEWER_SENTINEL
          ? reviewerAssignee
          : null,
      tags: tagsList.length > 0 ? tagsList : null,
    };

    if (mode === 'create') {
      values.status = status;
    }

    await onSubmit(values, pendingFiles);
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      {/* ID / UUID — edit only */}
      {mode === 'edit' && initial && (
        <div className="task-form-id-row">
          <label className="new-task-field">
            <span>ID</span>
            <input value={initial.human_id || initial.id} readOnly disabled />
          </label>
          <label className="new-task-field">
            <span>UUID</span>
            <input value={initial.id} readOnly disabled />
          </label>
        </div>
      )}

      <label className="new-task-field">
        <span>Título</span>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          maxLength={500}
          required
          disabled={saving}
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

      {/* Status — create only */}
      {mode === 'create' && (
        <SelectField<UiStatus>
          label="Status"
          value={status}
          onValueChange={setStatus}
          options={STATUS_OPTIONS}
          disabled={saving}
        />
      )}

      <label className="new-task-field">
        <span>Body</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          disabled={saving}
          rows={6}
        />
      </label>

      {/* Anexos */}
      <div className="new-task-field">
        <div className="task-attachments-head">
          <span>Anexos</span>
          <span aria-live="polite">({totalAttachments}/{MAX_FILES})</span>
        </div>
        <label
          className="task-dropzone"
          data-empty={totalAttachments === 0 ? 'true' : 'false'}
          data-drag={dragActive ? 'true' : 'false'}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Anexar imagens à task"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            onChange={(e) => {
              if (e.currentTarget.files) {
                addFiles(e.currentTarget.files);
                e.currentTarget.value = '';
              }
            }}
          />
          {totalAttachments === 0 ? (
            <>
              <span className="dropzone-main">+ ARRASTE / CLIQUE</span>
              <span className="dropzone-sub">PNG·JPG·WEBP · 10MB</span>
            </>
          ) : (
            <span className="dropzone-main">+ ANEXAR MAIS</span>
          )}
        </label>
        {totalAttachments > 0 && (
          <div className="task-thumb-grid">
            {/* Persisted images — read-only, no X (edit mode only) */}
            {persistedUrls.map((url, idx) => (
              <div key={`persisted-${idx}`} className="task-thumb" data-status="persisted">
                <img src={url} alt={`Anexo ${idx + 1}`} />
              </div>
            ))}
            {/* Pending — new, removable */}
            {pendingFiles.map((f, idx) => (
              <div key={`pending-${f.name}-${idx}`} className="task-thumb" data-status="pending">
                <img src={pendingThumbUrls[idx]} alt={f.name} />
                <button
                  type="button"
                  className="task-thumb-remove"
                  aria-label={`Remover imagem ${persistedUrls.length + idx + 1}`}
                  onClick={() => removePending(idx)}
                >×</button>
              </div>
            ))}
          </div>
        )}
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
                name={`review_mode_${mode}`}
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

        {reviewMode === 'agent_autonomous' && (
          <p className="form-note" data-kind="warn">
            Modo autonomous é OPT-IN. Tasks com tag vetada (deploy_prod, db_migration,
            customer_email, customer_whatsapp, financial_op, send_external) são recusadas
            pelo backend.
          </p>
        )}
        {autonomousConflicts.length > 0 && (
          <p className="form-note" data-kind="error">
            ⚠️ tag vetada para autonomous: <strong>{autonomousConflicts.join(', ')}</strong>.
            Mude pra <code>human</code>/<code>agent_advisory</code> ou remova a tag.
          </p>
        )}
      </fieldset>

      {errorMessage && <p className="form-note" data-kind="error">{errorMessage}</p>}

      <footer className="new-task-actions">
        <button type="button" className="form-cancel" disabled={saving} onClick={onCancel}>
          CANCELAR
        </button>
        <button
          type="submit"
          className="form-submit"
          disabled={saving || !title.trim() || !assignee || autonomousConflicts.length > 0}
        >
          {mode === 'create'
            ? saving ? 'CRIANDO...' : 'CRIAR'
            : saving ? 'SALVANDO...' : 'SALVAR'}
        </button>
      </footer>
    </form>
  );
}
