'use client';

import { useMemo, useState } from 'react';

import {
  collapseContext,
  prepareDiff,
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
  const view = useMemo(() => {
    const prepared = prepareDiff(oldString, newString);
    if (prepared.status === 'omitted') {
      return prepared;
    }

    const { lines } = prepared;
    const largestLineNumber = lines.reduce(
      (largest, line) =>
        Math.max(largest, line.oldLineNumber ?? 0, line.newLineNumber ?? 0),
      0,
    );

    return {
      status: 'ready' as const,
      blocks: collapseContext(lines),
      lineNumberWidth: Math.max(3, String(largestLineNumber).length),
      summary: prepared.summary,
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
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{filePath}</span>
        {/* U+2212 (−), não hífen: o contrato §2.4 herda isso do Codex e é o que
            faz o par +/− alinhar em tabular-nums. O marcador de cada LINHA do
            diff continua sendo `-` — lá é sintaxe de diff, não estatística. */}
        {view.status === 'ready' ? (
          <>
            <span className="ck-tabular shrink-0 font-mono text-sm text-[var(--ck-diff-add)]">
              +{view.summary.additions}
            </span>
            <span className="ck-tabular shrink-0 font-mono text-sm text-[var(--ck-diff-del)]">
              −{view.summary.removals}
            </span>
          </>
        ) : null}
      </header>

      {view.status === 'omitted' ? (
        <p className="px-[var(--ck-space-4)] py-[var(--ck-space-3)] text-sm text-[var(--ck-fg-muted)]">
          Diff omitido por tamanho: versão anterior com {view.oldLineCount} linhas e
          versão nova com {view.newLineCount} linhas.
        </p>
      ) : (
        <div className="max-w-full overflow-x-auto font-mono text-sm leading-[1.6]">
          {view.blocks.map((block) => {
            if (block.type === 'line') {
              const key = `${block.line.type}-${block.line.oldLineNumber ?? 'x'}-${block.line.newLineNumber ?? 'x'}`;
              return (
                <DiffCodeLine
                  key={key}
                  line={block.line}
                  lineNumberWidth={view.lineNumberWidth}
                />
              );
            }

            if (expandedBlocks.has(block.id)) {
              return block.lines.map((line) => (
                <DiffCodeLine
                  key={`${block.id}-${line.oldLineNumber ?? 'x'}-${line.newLineNumber ?? 'x'}`}
                  line={line}
                  lineNumberWidth={view.lineNumberWidth}
                />
              ));
            }

            return (
              <button
                key={block.id}
                type="button"
                className="flex min-h-[44px] w-full min-w-max items-center border-y border-[var(--ck-edge-hairline)] px-[var(--ck-space-4)] text-left font-mono text-sm"
                onClick={() => expandBlock(block.id)}
                aria-label={`Expandir ${block.lines.length} linhas de contexto`}
              >
                ... {block.lines.length} linhas
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
