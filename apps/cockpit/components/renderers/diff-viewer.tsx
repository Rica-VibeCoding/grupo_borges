'use client';

import { useMemo, useState } from 'react';

import {
  calculateDiff,
  collapseContext,
  summarizeDiff,
  type DiffLine,
} from './diff-lines';

export type DiffViewerProps = {
  filePath: string;
  oldString: string;
  newString: string;
  className?: string;
};

function DiffCodeLine({
  line,
  lineNumberWidth,
}: {
  line: DiffLine;
  lineNumberWidth: number;
}) {
  const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
  const colorClass =
    line.type === 'add'
      ? 'bg-[var(--ck-diff-add-bg)] text-[var(--ck-diff-add)]'
      : line.type === 'remove'
        ? 'bg-[var(--ck-diff-del-bg)] text-[var(--ck-diff-del)]'
        : '';

  return (
    <div
      className={`grid min-w-max ${colorClass}`}
      style={{
        gridTemplateColumns: `${lineNumberWidth}ch ${lineNumberWidth}ch 2ch minmax(0, 1fr)`,
      }}
    >
      <span className="select-none text-right">{line.oldLineNumber ?? ''}</span>
      <span className="select-none text-right">{line.newLineNumber ?? ''}</span>
      <span className="select-none text-center">{marker}</span>
      <span className="whitespace-pre pr-[var(--ck-space-4)]">{line.content}</span>
    </div>
  );
}

export function DiffViewer({
  filePath,
  oldString,
  newString,
  className = '',
}: DiffViewerProps) {
  const { blocks, lineNumberWidth, summary } = useMemo(() => {
    const lines = calculateDiff(oldString, newString);
    const largestLineNumber = lines.reduce(
      (largest, line) =>
        Math.max(largest, line.oldLineNumber ?? 0, line.newLineNumber ?? 0),
      0,
    );

    return {
      blocks: collapseContext(lines),
      lineNumberWidth: Math.max(3, String(largestLineNumber).length),
      summary: summarizeDiff(lines),
    };
  }, [oldString, newString]);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(() => new Set());

  function expandBlock(id: string) {
    setExpandedBlocks((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  return (
    <section
      className={`min-w-0 max-w-[var(--ck-read-wide)] overflow-hidden rounded-[var(--ck-radius-frame)] border border-[var(--ck-edge-hairline)] ${className}`}
      aria-label={`Diff de ${filePath}`}
    >
      <header className="flex min-w-0 items-center gap-[var(--ck-space-3)] border-b border-[var(--ck-edge-hairline)] px-[var(--ck-space-4)] py-[var(--ck-space-3)]">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{filePath}</span>
        <span className="shrink-0 font-mono text-[13px] text-[var(--ck-diff-add)]">
          +{summary.additions}
        </span>
        <span className="shrink-0 font-mono text-[13px] text-[var(--ck-diff-del)]">
          -{summary.removals}
        </span>
      </header>

      <div className="max-w-full overflow-x-auto font-mono text-[13px] leading-[1.6]">
        {blocks.map((block) => {
          if (block.type === 'line') {
            const key = `${block.line.type}-${block.line.oldLineNumber ?? 'x'}-${block.line.newLineNumber ?? 'x'}`;
            return (
              <DiffCodeLine
                key={key}
                line={block.line}
                lineNumberWidth={lineNumberWidth}
              />
            );
          }

          if (expandedBlocks.has(block.id)) {
            return block.lines.map((line) => (
              <DiffCodeLine
                key={`${block.id}-${line.oldLineNumber ?? 'x'}-${line.newLineNumber ?? 'x'}`}
                line={line}
                lineNumberWidth={lineNumberWidth}
              />
            ));
          }

          return (
            <button
              key={block.id}
              type="button"
              className="flex min-h-[44px] w-full min-w-max items-center border-y border-[var(--ck-edge-hairline)] px-[var(--ck-space-4)] text-left font-mono text-[13px]"
              onClick={() => expandBlock(block.id)}
              aria-label={`Expandir ${block.lines.length} linhas de contexto`}
            >
              ... {block.lines.length} linhas
            </button>
          );
        })}
      </div>
    </section>
  );
}
