'use client';

import { useId, useState } from 'react';

import { normalizeThinkingContent } from '../../lib/thinking';
import { AssistantMarkdown } from './markdown';

export type ThinkingProps = {
  content: unknown;
  className?: string;
};

function lineLabel(lineCount: number): string {
  return `${lineCount} ${lineCount === 1 ? 'linha' : 'linhas'}`;
}

export function Thinking({ content, className = '' }: ThinkingProps) {
  const { text, lineCount } = normalizeThinkingContent(content);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const expandable = text.trim() !== '';

  return (
    <section
      className={`min-w-0 max-w-[var(--ck-read-mid)] overflow-hidden rounded-[var(--ck-radius-frame)] border border-[var(--ck-edge-hairline)] ${className}`}
      aria-label="Raciocínio do assistente"
    >
      {expandable ? (
        <button
          type="button"
          className="ck-veil flex min-h-[44px] w-full min-w-0 items-center gap-[var(--ck-space-2)] px-[var(--ck-space-3)] text-left font-sans text-[13px] text-[var(--ck-text-primary)]"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
        >
          <span className="min-w-0 flex-1 font-medium">Raciocínio</span>
          <span className="shrink-0 font-mono text-[13px] text-[var(--ck-text-secondary)]">
            {lineLabel(lineCount)}
          </span>
          <span className="shrink-0 text-[var(--ck-state-thinking)]" aria-hidden="true">
            {open ? '▴' : '▾'}
          </span>
        </button>
      ) : (
        <header className="flex min-h-[44px] min-w-0 items-center gap-[var(--ck-space-2)] px-[var(--ck-space-3)] font-sans text-[13px] text-[var(--ck-text-secondary)]">
          <span className="min-w-0 flex-1 font-medium">Raciocínio</span>
          <span className="shrink-0 font-mono text-[13px]">{lineLabel(lineCount)}</span>
        </header>
      )}

      {open && expandable ? (
        <div
          id={bodyId}
          className="border-t border-[var(--ck-edge-hairline)] bg-[var(--ck-surface-raised)] p-[var(--ck-space-3)]"
        >
          <AssistantMarkdown>{text}</AssistantMarkdown>
        </div>
      ) : null}
    </section>
  );
}
