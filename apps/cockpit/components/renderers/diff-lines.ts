export type DiffLine = {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type CollapsedDiffBlock =
  | { type: 'line'; line: DiffLine }
  | { type: 'collapsed'; id: string; lines: DiffLine[] };

export type DiffSummary = {
  additions: number;
  removals: number;
};

export const DIFF_LINE_LIMIT = 2_000;

export type DiffViewModel =
  | {
      status: 'ready';
      lines: DiffLine[];
      summary: DiffSummary;
    }
  | {
      status: 'omitted';
      oldLineCount: number;
      newLineCount: number;
    };

function splitLines(value: string): string[] {
  if (value === '') {
    return [];
  }

  const lines = value.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

export function countLines(value: string): number {
  return splitLines(value).length;
}

export function calculateDiff(oldString: string, newString: string): DiffLine[] {
  const oldLines = splitLines(oldString);
  const newLines = splitLines(newString);
  const lengths = Array.from({ length: oldLines.length + 1 }, () =>
    Array<number>(newLines.length + 1).fill(0),
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      lengths[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lengths[oldIndex + 1][newIndex + 1] + 1
          : Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1]);
    }
  }

  const diff: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      diff.push({
        type: 'context',
        content: oldLines[oldIndex],
        oldLineNumber: oldIndex + 1,
        newLineNumber: newIndex + 1,
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      oldIndex < oldLines.length &&
      (newIndex === newLines.length ||
        lengths[oldIndex + 1][newIndex] >= lengths[oldIndex][newIndex + 1])
    ) {
      diff.push({
        type: 'remove',
        content: oldLines[oldIndex],
        oldLineNumber: oldIndex + 1,
        newLineNumber: null,
      });
      oldIndex += 1;
    } else {
      diff.push({
        type: 'add',
        content: newLines[newIndex],
        oldLineNumber: null,
        newLineNumber: newIndex + 1,
      });
      newIndex += 1;
    }
  }

  return diff;
}

export function prepareDiff(
  oldString: string,
  newString: string,
  diffCalculator: typeof calculateDiff = calculateDiff,
): DiffViewModel {
  const oldLineCount = countLines(oldString);
  const newLineCount = countLines(newString);

  if (oldLineCount > DIFF_LINE_LIMIT || newLineCount > DIFF_LINE_LIMIT) {
    return {
      status: 'omitted',
      oldLineCount,
      newLineCount,
    };
  }

  const lines = diffCalculator(oldString, newString);
  return {
    status: 'ready',
    lines,
    summary: summarizeDiff(lines),
  };
}

export function summarizeDiff(lines: DiffLine[]): DiffSummary {
  return lines.reduce<DiffSummary>(
    (summary, line) => ({
      additions: summary.additions + (line.type === 'add' ? 1 : 0),
      removals: summary.removals + (line.type === 'remove' ? 1 : 0),
    }),
    { additions: 0, removals: 0 },
  );
}

export function collapseContext(
  lines: DiffLine[],
  contextLimit = 6,
): CollapsedDiffBlock[] {
  const blocks: CollapsedDiffBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    if (lines[index].type !== 'context') {
      blocks.push({ type: 'line', line: lines[index] });
      index += 1;
      continue;
    }

    const start = index;
    while (index < lines.length && lines[index].type === 'context') {
      index += 1;
    }

    const contextLines = lines.slice(start, index);
    if (contextLines.length > contextLimit) {
      blocks.push({
        type: 'collapsed',
        id: `context-${start}-${index}`,
        lines: contextLines,
      });
    } else {
      blocks.push(...contextLines.map((line) => ({ type: 'line' as const, line })));
    }
  }

  return blocks;
}
