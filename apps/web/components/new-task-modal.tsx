'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { createTask, type TaskPatchStatus } from '../lib/api';
import { REVIEW_MODE_OPTIONS } from '../lib/cockpit-types';
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [thumbUrls, setThumbUrls] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
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
      setPendingFiles([]);
      setDragActive(false);
    }
  }, [open]);

  // Revoke old thumb URLs and rebuild when pendingFiles changes
  useEffect(() => {
    const urls = pendingFiles.map((f) => URL.createObjectURL(f));
    setThumbUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [pendingFiles]);

  const MAX_FILES = 5;
  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      const accepted: File[] = [];
      for (const f of list) {
        if (!f.type.startsWith('image/')) {
          fire({ kind: 'warn', msg: 'ARQUIVO REJEITADO', sub: `${f.name}: tipo inválido (apenas image/*)` });
          continue;
        }
        if (f.size > MAX_SIZE) {
          fire({ kind: 'warn', msg: 'ARQUIVO REJEITADO', sub: `${f.name}: excede 10 MB` });
          continue;
        }
        if (pendingFiles.length + accepted.length >= MAX_FILES) {
          fire({ kind: 'warn', msg: 'ARQUIVO REJEITADO', sub: `Limite de ${MAX_FILES} imagens atingido` });
          break;
        }
        accepted.push(f);
      }
      if (accepted.length > 0) {
        setPendingFiles((prev) => [...prev, ...accepted]);
      }
    },
    [pendingFiles.length, fire],
  );

  const removeFile = useCallback((idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

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

      if (pendingFiles.length > 0) {
        const fd = new FormData();
        pendingFiles.forEach((f) => fd.append('files', f));
        const imgRes = await fetch(`/api/tasks/${created.id}/images`, { method: 'POST', body: fd });
        if (imgRes.status !== 201) {
          const errText = await imgRes.text().catch(() => String(imgRes.status));
          fire({ kind: 'warn', msg: 'TASK CRIADA · IMAGENS FALHARAM', sub: errText });
        }
      }

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

            {/* Anexos */}
            <div className="new-task-field">
              <div className="task-attachments-head">
                <span>Anexos</span>
                <span aria-live="polite">({pendingFiles.length}/{MAX_FILES})</span>
              </div>
              <label
                className="task-dropzone"
                data-empty={pendingFiles.length === 0 ? 'true' : 'false'}
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
                {pendingFiles.length === 0 ? (
                  <>
                    <span className="dropzone-main">+ ARRASTE / CLIQUE</span>
                    <span className="dropzone-sub">PNG·JPG·WEBP · 10MB</span>
                  </>
                ) : (
                  <span className="dropzone-main">+ ANEXAR MAIS</span>
                )}
              </label>
              {pendingFiles.length > 0 && (
                <div className="task-thumb-grid">
                  {pendingFiles.map((f, idx) => (
                    <div key={`${f.name}-${idx}`} className="task-thumb">
                      <img src={thumbUrls[idx]} alt={f.name} />
                      <button
                        type="button"
                        className="task-thumb-remove"
                        aria-label={`Remover imagem ${idx + 1}`}
                        onClick={() => removeFile(idx)}
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
