'use client';

import { useEffect, useRef, useState } from 'react';
import { patchTask, type TaskPatchPayload } from '../lib/api';
import type { Task } from '../lib/cockpit-types';
import { useToast } from '../lib/toast-context';
import { TaskForm, type TaskFormValues } from './task-form';

/**
 * Edição de task. Regras por status:
 *   backlog/ready → todos os campos liberados (título, body, responsável,
 *     prioridade, tags, modo de revisão, revisor).
 *   running → somente status (re-enfileirar/pausar). Mudar título/body
 *     atrapalha o agente que já leu o envelope.
 *   review/blocked/done → readonly (este form não renderiza).
 */

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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleSubmit(values: TaskFormValues, pendingFiles: File[]) {
    setSaving(true);
    setMessage(null);

    const fields: TaskPatchPayload = {};

    if (values.title !== task.title) fields.title = values.title;
    const originalBody = (task.body ?? '').trim();
    if ((values.body ?? '') !== originalBody) fields.body = values.body;
    if (values.assignee && values.assignee !== task.assignee) fields.assignee = values.assignee;
    if (Number.isFinite(values.priority) && values.priority !== task.priority) {
      fields.priority = values.priority;
    }
    if (values.review_mode !== (task.review_mode ?? 'human')) fields.review_mode = values.review_mode;
    if (values.reviewer_assignee !== (task.reviewer_assignee ?? null)) {
      fields.reviewer_assignee = values.reviewer_assignee;
    }
    if (JSON.stringify(values.tags) !== JSON.stringify(task.tags ?? null)) {
      fields.tags = values.tags;
    }

    try {
      let updated: Task;

      if (Object.keys(fields).length > 0) {
        updated = await patchTask(task.id, fields);
      } else {
        updated = task;
      }

      if (pendingFiles.length > 0) {
        const fd = new FormData();
        pendingFiles.forEach((f) => fd.append('files', f));
        const imgRes = await fetch(`/api/tasks/${task.id}/images`, { method: 'POST', body: fd });
        if (imgRes.status === 201) {
          // Endpoint retorna `{task_id, uploaded: [{url, filename, size}]}`.
          // Mescla as URLs novas com as existentes pra não perder estado local.
          const imgData = await imgRes.json().catch(() => null);
          const newUrls: string[] = Array.isArray(imgData?.uploaded)
            ? imgData.uploaded.map((u: { url?: unknown }) => u?.url).filter(
                (v: unknown): v is string => typeof v === 'string',
              )
            : [];
          if (newUrls.length > 0) {
            updated = {
              ...updated,
              image_urls: [...(updated.image_urls ?? []), ...newUrls],
            };
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
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(msg);
      onError(msg);
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
    <div className="task-edit-form" data-mode="full">
      <TaskForm
        mode="edit"
        initial={task}
        agentOptions={agentOptions}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        saving={saving}
        errorMessage={message}
      />
    </div>
  );
}
