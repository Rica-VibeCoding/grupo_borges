import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deslizes } from './desliza-tropa.ts';

const topos = (slugs: string[]) => new Map(slugs.map((s, i) => [s, i * 56]));

test('arrastou a última para o topo: as de cima descem uma linha, a soltada fica', () => {
  const antes = topos(['pavan', 'daniel', 'tara']);
  const depois = topos(['tara', 'pavan', 'daniel']);
  assert.deepEqual(deslizes(antes, depois, 'tara'), [
    { slug: 'pavan', dy: -56 },
    { slug: 'daniel', dy: -56 },
  ]);
});

test('pela seta (sem dedo) a linha movida desliza junto', () => {
  const antes = topos(['pavan', 'daniel']);
  const depois = topos(['daniel', 'pavan']);
  assert.deepEqual(deslizes(antes, depois, null), [
    { slug: 'daniel', dy: 56 },
    { slug: 'pavan', dy: -56 },
  ]);
});

test('quem não andou e quem não existia antes ficam de fora', () => {
  const antes = new Map([['pavan', 0], ['daniel', 56.2]]);
  const depois = new Map([['pavan', 0], ['daniel', 56], ['novo', 112]]);
  assert.deepEqual(deslizes(antes, depois, null), []);
});
