import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateDiff,
  collapseContext,
  DIFF_LINE_LIMIT,
  prepareDiff,
  summarizeDiff,
} from './diff-lines.ts';

describe('calculateDiff', () => {
  it('representa uma linha trocada como remoção seguida de adição', () => {
    const diff = calculateDiff('const value = 1;', 'const value = 2;');

    assert.deepEqual(
      diff.map(({ type, content }) => ({ type, content })),
      [
        { type: 'remove', content: 'const value = 1;' },
        { type: 'add', content: 'const value = 2;' },
      ],
    );
  });

  it('calcula uma inserção pura', () => {
    const diff = calculateDiff('alpha\nomega', 'alpha\nbeta\nomega');

    assert.deepEqual(
      diff.map((line) => line.type),
      ['context', 'add', 'context'],
    );
    assert.deepEqual(diff[1], {
      type: 'add',
      content: 'beta',
      oldLineNumber: null,
      newLineNumber: 2,
    });
  });

  it('calcula uma remoção pura', () => {
    const diff = calculateDiff('alpha\nbeta\nomega', 'alpha\nomega');

    assert.deepEqual(
      diff.map((line) => line.type),
      ['context', 'remove', 'context'],
    );
    assert.deepEqual(diff[1], {
      type: 'remove',
      content: 'beta',
      oldLineNumber: 2,
      newLineNumber: null,
    });
  });

  it('trata conteúdo novo em arquivo vazio como adições', () => {
    const diff = calculateDiff('', 'primeira\nsegunda');

    assert.deepEqual(
      diff.map((line) => line.type),
      ['add', 'add'],
    );
    assert.deepEqual(summarizeDiff(diff), { additions: 2, removals: 0 });
  });
});

describe('collapseContext', () => {
  it('colapsa mais de seis linhas consecutivas de contexto', () => {
    const diff = calculateDiff(
      '1\n2\n3\n4\n5\n6\n7\nantes',
      '1\n2\n3\n4\n5\n6\n7\ndepois',
    );
    const blocks = collapseContext(diff);

    assert.equal(blocks[0].type, 'collapsed');
    if (blocks[0].type === 'collapsed') {
      assert.equal(blocks[0].lines.length, 7);
    }
  });
});

describe('summarizeDiff', () => {
  it('conta +N/-M sem incluir contexto', () => {
    const diff = calculateDiff('fica\nremove 1\nremove 2', 'fica\nadiciona');

    assert.deepEqual(summarizeDiff(diff), { additions: 1, removals: 2 });
  });
});

describe('prepareDiff', () => {
  it('não chama o LCS quando qualquer versão excede o limite', () => {
    const oversized = Array.from(
      { length: DIFF_LINE_LIMIT + 1 },
      (_, index) => `linha ${index + 1}`,
    ).join('\n');
    let calls = 0;

    const result = prepareDiff('uma linha', oversized, () => {
      calls += 1;
      return [];
    });

    assert.equal(calls, 0);
    assert.deepEqual(result, {
      status: 'omitted',
      oldLineCount: 1,
      newLineCount: DIFF_LINE_LIMIT + 1,
    });
  });

  it('mantém o LCS para entradas dentro do limite', () => {
    let calls = 0;

    const result = prepareDiff('antes', 'depois', (oldString, newString) => {
      calls += 1;
      return calculateDiff(oldString, newString);
    });

    assert.equal(calls, 1);
    assert.equal(result.status, 'ready');
  });
});
