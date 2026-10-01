import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mola } from './ritmo-do-historico.ts';

describe('a mola da casa na Motion', () => {
  it('começa em 0 e termina em 1', () => {
    assert.equal(mola(0), 0);
    assert.equal(mola(1), 1);
    assert.equal(mola(-1), 0);
    assert.equal(mola(2), 1);
  });

  it('passa do ponto como a --ck-mola, nos mesmos pontos', () => {
    assert.equal(mola(0.55), 1.013);
    assert.equal(mola(0.65), 1.014);
  });

  it('entre dois pontos, reta', () => {
    assert.ok(Math.abs(mola(0.08) - (0.104 + 0.5 * (0.238 - 0.104))) < 1e-9);
  });
});
