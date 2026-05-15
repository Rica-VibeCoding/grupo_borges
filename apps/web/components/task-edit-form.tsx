'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewMode, Task } from '../lib/cockpit-types';
import { patchTask, type TaskPatchPayload, type TaskPatchStatus } from '../lib/api';
import { SelectField } from './select-field';
import { useToast } from '../lib/toast-context';

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

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

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
  const { fire } = useToast();
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

  // Attachments
  const persistedUrls: string[] = Array.isArray(task.image_urls) ? task.image_urls : [];
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingThumbUrls, setPendingThumbUrls] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

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

    try {
      let updated: Task;

      if (Object.keys(fields).length > 0) {
        updated = await patchTask(task.id, fields);
      } else {
        updated = task;
      }

      // Upload pending images after PATCH
      if (pendingFiles.length > 0) {
        const fd = new FormData();
        pendingFiles.forEach((f) => fd.append('files', f));
        const imgRes = await fetch(`/api/tasks/${task.id}/images`, { method: 'POST', body: fd });
        if (imgRes.status === 201) {
          const imgData = await imgRes.json().catch(() => null);
          if (imgData && typeof imgData === 'object' && 'image_urls' in imgData) {
            updated = { ...updated, image_urls: imgData.image_urls as string[] };
          }
        } else {
          const errText = await imgRes.text().catch(() => String(imgRes.status));
          fire({ kind: 'warn', msg: 'CAMPOS SALVOS · IMAGENS FALHARAM', sub: errText });
        }
      }

      if (!mountedRef.current) return;

      if (Object.keys(fields).length === 0 && pendingFiles.length === 0) {
        onCancel();
        return;
      }

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
            onChange={(e) => { if (e.currentTarget.files) { addFiles(e.currentTarget.files); e.currentTarget.value = ''; } }}
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
            {/* Persisted images (read-only, no X) */}
            {persistedUrls.map((url, idx) => (
              <div key={`persisted-${idx}`} className="task-thumb" data-status="persisted">
                <img src={url} alt={`Anexo ${idx + 1}`} />
              </div>
            ))}
            {/* Pending (new, removable) */}
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
