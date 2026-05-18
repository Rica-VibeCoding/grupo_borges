'use client';

import { useMemo, useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { fetchAgentSkills, spawnSubsession } from '../lib/api';
import { useTaskSubsessions } from '../lib/use-subsessions';
import { useToast } from '../lib/toast-context';
import type { AgentSkill } from '../lib/cockpit-types';

type Feedback = { text: string; kind: 'info' | 'error' } | null;

export function SubsessionPopover({
  taskId,
  agentSlug,
}: {
  taskId: string;
  agentSlug: string;
}) {
  const { fire } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState('');
  const [visible, setVisible] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [spawning, setSpawning] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const subsessions = useTaskSubsessions(taskId, agentSlug);
  const activeSubsessions = useMemo(
    () => subsessions.filter((s) => s.status === 'active' || s.status === 'starting'),
    [subsessions],
  );

  useEffect(() => {
    if (open) setFeedback(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetchAgentSkills(agentSlug, ctrl.signal)
      .then((r) => setSkills(r.skills))
      .catch(() => setFeedback({ text: 'erro ao carregar skills', kind: 'error' }));
    return () => ctrl.abort();
  }, [open, agentSlug]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function handleSpawn() {
    if (!selectedSkill || spawning) return;
    setSpawning(true);
    setFeedback(null);
    const skill = selectedSkill;
    try {
      await spawnSubsession(agentSlug, {
        task_id: taskId,
        prompt: prompt.trim() || skill,
        visibility: visible,
        skill,
      });
      setPrompt('');
      setSelectedSkill('');
      setOpen(false);
      fire({ kind: 'success', msg: 'SUBSESSÃO INICIADA', sub: skill });
    } catch (err) {
      setFeedback({ text: err instanceof Error ? err.message : String(err), kind: 'error' });
    } finally {
      setSpawning(false);
    }
  }

  return (
    <div className="subsession-panel">
      {activeSubsessions.length > 0 && (
        <ul className="subsession-list mono" aria-label="Subsessões ativas">
          {activeSubsessions.map((s) => (
            <li key={s.subsession_id} className="subsession-item">
              <span className="subsession-dot" aria-hidden="true" />
              <span className="subsession-name">{s.session_name}</span>
              <span className="subsession-status">{s.status}</span>
            </li>
          ))}
        </ul>
      )}
      {feedback && (
        <p
          className="form-note subsession-feedback"
          data-kind={feedback.kind}
          role="status"
          aria-live="polite"
        >
          {feedback.text}
        </p>
      )}
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="form-cancel subsession-trigger"
            aria-label="Abrir painel de subsessão"
          >
            + SUBSESSÃO
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="subsession-popover mono"
            side="top"
            align="start"
            sideOffset={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <p className="subsession-popover-label">SKILL</p>
            <Command className="subsession-command" shouldFilter>
              <Command.Input
                ref={inputRef}
                placeholder="buscar skill..."
                className="subsession-command-input"
              />
              <Command.List className="subsession-command-list">
                <Command.Empty className="subsession-command-empty">
                  nenhuma skill encontrada
                </Command.Empty>
                {skills.map((skill) => (
                  <Command.Item
                    key={skill.name}
                    value={skill.name}
                    className="subsession-command-item"
                    data-selected={selectedSkill === skill.name ? 'true' : undefined}
                    onSelect={() => setSelectedSkill(skill.name)}
                  >
                    {skill.name}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>

            {selectedSkill && (
              <p className="subsession-selected mono">▸ {selectedSkill}</p>
            )}

            <div className="subsession-form">
              <button
                type="button"
                className="subsession-toggle-btn"
                aria-pressed={visible}
                onClick={() => setVisible((v) => !v)}
              >
                {visible ? 'VISÍVEL NO CARD' : 'BACKGROUND'}
              </button>
              <textarea
                className="subsession-prompt"
                placeholder="Instrução adicional (opcional)..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
              />
              <button
                type="button"
                className="form-submit subsession-spawn-btn"
                onClick={handleSpawn}
                disabled={!selectedSkill || spawning}
              >
                {spawning ? 'INICIANDO...' : 'SPAWNAR'}
              </button>
            </div>
            <Popover.Arrow className="subsession-popover-arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export const subsessionCss = `
.subsession-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.subsession-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
}
.subsession-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.subsession-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 5px var(--accent);
  flex: none;
  animation: subagent-badge-pulse 1.4s ease-in-out infinite;
}
.subsession-name { color: var(--text); }
.subsession-status { margin-left: auto; color: var(--accent); letter-spacing: 0.06em; }
.subsession-feedback { font-size: 10px; }
.subsession-trigger {
  align-self: flex-start;
  font-size: 10px;
  padding: 3px 10px;
  letter-spacing: 0.1em;
}
.subsession-popover {
  background: var(--panel);
  border: 1px solid var(--accent-border);
  box-shadow: 0 4px 24px rgba(0,0,0,0.45), 0 0 12px rgba(0,240,255,0.12);
  border-radius: 6px;
  padding: 10px;
  width: 260px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subsession-popover-label {
  font-size: 9px;
  color: var(--accent);
  letter-spacing: 0.15em;
}
.subsession-command {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.subsession-command-input {
  background: var(--card);
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-family: inherit;
  font-size: 11px;
  padding: 6px 8px;
  outline: none;
  width: 100%;
}
.subsession-command-input::placeholder { color: var(--muted); }
.subsession-command-list {
  max-height: 120px;
  overflow-y: auto;
  background: var(--card);
}
.subsession-command-list::-webkit-scrollbar { width: 3px; }
.subsession-command-list::-webkit-scrollbar-thumb { background: var(--accent-border); }
.subsession-command-empty {
  padding: 8px;
  font-size: 10px;
  color: var(--muted);
  text-align: center;
}
.subsession-command-item {
  padding: 5px 8px;
  font-size: 11px;
  cursor: pointer;
  color: var(--text);
  transition: background 120ms;
}
.subsession-command-item:hover,
[cmdk-item][aria-selected="true"].subsession-command-item,
.subsession-command-item[data-selected="true"] {
  background: var(--accent-subtle);
  color: var(--accent);
}
.subsession-selected {
  font-size: 10px;
  color: var(--accent);
  letter-spacing: 0.04em;
}
.subsession-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.subsession-toggle-btn {
  background: var(--card);
  border: 1px solid var(--border);
  color: var(--muted);
  font-family: inherit;
  font-size: 9px;
  letter-spacing: 0.12em;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  align-self: flex-start;
  transition: color 120ms, border-color 120ms;
}
.subsession-toggle-btn[aria-pressed="true"] {
  border-color: var(--accent-border);
  color: var(--accent);
}
.subsession-prompt {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: inherit;
  font-size: 10px;
  padding: 5px 7px;
  resize: vertical;
  outline: none;
}
.subsession-prompt::placeholder { color: var(--muted); }
.subsession-prompt:focus { border-color: var(--accent-border); }
.subsession-spawn-btn {
  font-size: 10px;
  padding: 5px 10px;
  letter-spacing: 0.12em;
}
.subsession-popover-arrow { fill: var(--panel); }
`;
