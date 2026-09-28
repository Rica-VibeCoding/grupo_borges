'use client';

import { memo, useId, useState } from 'react';

import {
  buildThinkingRenderModel,
  type ThinkingRenderModel,
} from '../../lib/thinking';
import { Chevron } from './linha-execucao';
import { AssistantMarkdown } from './markdown';

export type ThinkingProps = {
  content: unknown;
  className?: string;
};

function lineLabel(lineCount: number): string {
  return `${lineCount} ${lineCount === 1 ? 'linha' : 'linhas'}`;
}

function ThinkingDisclosure({
  thinking,
  className,
}: {
  thinking: ThinkingRenderModel;
  className: string;
}) {
  const { text, lineCount, initiallyExpanded } = thinking;
  const [open, setOpen] = useState<boolean>(initiallyExpanded);
  // Mesma régua da linha de execução: só o corpo aberto pelo dedo chega com
  // `.ck-chega`; o que nasce aberto aparece parado, e recolher segue seco.
  const [abriuNoToque, setAbriuNoToque] = useState(false);
  const bodyId = useId();

  return (
    <section
      className={`min-w-0 max-w-[var(--ck-read-mid)] overflow-hidden rounded-[var(--ck-radius-frame)] border border-[var(--ck-edge-hairline)] ${className}`}
      aria-label="Raciocínio do assistente"
    >
      <button
        type="button"
        className="ck-veil flex min-h-[44px] w-full min-w-0 items-center gap-[var(--ck-space-2)] px-[var(--ck-space-3)] text-left font-sans text-sm text-[var(--ck-text-primary)]"
        onClick={() => {
          setOpen(!open);
          setAbriuNoToque(!open);
        }}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
      >
        <span className="min-w-0 flex-1 font-medium">Raciocínio</span>
        <span className="shrink-0 font-mono text-sm text-[var(--ck-text-secondary)]">
          {lineLabel(lineCount)}
        </span>
        {/* O chevron que gira, o mesmo da linha e do grupo — era um glifo
            ▴/▾ que trocava de estalo. */}
        <Chevron aberto={open} />
      </button>

      {open ? (
        <div
          id={bodyId}
          className={`${abriuNoToque ? 'ck-chega ' : ''}border-t border-[var(--ck-edge-hairline)] bg-[var(--ck-surface-composer)] p-[var(--ck-space-3)]`}
        >
          <AssistantMarkdown>{text}</AssistantMarkdown>
        </div>
      ) : null}
    </section>
  );
}

function Thinking({ content, className = '' }: ThinkingProps) {
  const thinking = buildThinkingRenderModel(content);
  if (thinking === null) return null;

  return <ThinkingDisclosure thinking={thinking} className={className} />;
}

const ThinkingMemo = memo(Thinking);
export { ThinkingMemo as Thinking };
