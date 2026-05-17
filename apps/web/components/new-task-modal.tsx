'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { createTask } from '../lib/api';
import { useFleet } from '../lib/fleet-context';
import { useToast } from '../lib/toast-context';
import { useIsMobile } from '../lib/use-is-mobile';
import { TaskForm, type TaskFormValues } from './task-form';

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
  const isMobile = useIsMobile();
  const titleRef = useRef<HTMLInputElement>(null);

  const agentOptions = useMemo(
    () => fleet.agents.map((agent) => ({ value: agent.slug, label: `${agent.name} · ${agent.slug}` })),
    [fleet.agents],
  );

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // formKey forces TaskForm to remount (reset state) each time the dialog opens
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!open) {
      setSaving(false);
      setMessage(null);
    } else {
      setFormKey((k) => k + 1);
    }
  }, [open]);

  async function handleSubmit(values: TaskFormValues, pendingFiles: File[]) {
    setSaving(true);
    setMessage(null);
    try {
      const created = await createTask({
        title: values.title,
        assignee: values.assignee,
        body: values.body,
        status: values.status,
        priority: values.priority,
        idempotency_key: safeUUID(),
        review_mode: values.review_mode,
        reviewer_assignee: values.reviewer_assignee,
        tags: values.tags,
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
          className={`agent-modal-frame new-task-frame mono${isMobile ? ' new-task-frame-mobile' : ''}`}
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
              <button type="button" className="agent-modal-close" aria-label="Fechar criação">✕</button>
            </Dialog.Close>
          </header>

          <TaskForm
            key={formKey}
            mode="create"
            agentOptions={agentOptions}
            onSubmit={handleSubmit}
            onCancel={() => onOpenChange(false)}
            saving={saving}
            errorMessage={message}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
