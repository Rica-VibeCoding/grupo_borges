import assert from 'node:assert/strict';
import { it } from 'node:test';

import { destravaSintese } from './sons-locais.ts';

it('inicia uma frase silenciosa no gesto que destrava a síntese', () => {
  const chamadas: string[] = [];
  const frases: Array<{ texto: string; volume: number }> = [];

  destravaSintese<{ texto: string; volume: number }>(
    {
      resume: () => chamadas.push('resume'),
      speak: (frase) => {
        chamadas.push('speak');
        frases.push(frase);
      },
    },
    (texto) => ({ texto, volume: 1 }),
  );

  assert.deepEqual(chamadas, ['resume', 'speak']);
  assert.deepEqual(frases, [{ texto: '', volume: 0 }]);
});
