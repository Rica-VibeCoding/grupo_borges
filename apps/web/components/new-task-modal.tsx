'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { createTask, type TaskPatchStatus } from '../lib/api';
import { useFleet } from '../lib/fleet-context';
import { useToast } from '../lib/toast-context';
import { SelectField } from './select-field';

type UiTaskStatus = Exclude<TaskPatchStatus, 'ready'>;

const STATUS_OPTIONS: Array<{ value: UiTaskStatus; label: string }> = [
  { value: 'backlog', label: 'FILA' },
  { value: 'running', label: 'EXECUTANDO' },
  { value: 'review', label: 'REVISÃO' },
  { value: 'blocked', label: 'BLOQUEADO' },
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!assignee && firstAgent) setAssignee(firstAgent);
  }, [assignee, firstAgent]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setBody('');
      setStatus('backlog');
      setPriority('0');
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
    try {
      const created = await createTask({
        title: trimmedTitle,
        assignee,
        body: body.trim() || null,
        status,
        priority: Number.parseInt(priority, 10) || 0,
        idempotency_key: safeUUID(),
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
