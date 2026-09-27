import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nivelDaVoz } from './nivel-da-voz.ts';

it('sincroniza picos de 0 a 31 com a posição real das sentenças', () => {
  const envelopes = [
    { inicio: 0, duracao: 2, peaks: [0, 15.5, 31, 0] },
    { inicio: 2, duracao: 1, peaks: [31, 0] },
  ];
  assert.equal(nivelDaVoz(envelopes, 0), 0);
  assert.equal(nivelDaVoz(envelopes, 0.5), 0.5);
  assert.equal(nivelDaVoz(envelopes, 1), 1);
  assert.equal(nivelDaVoz(envelopes, 2), 1);
  assert.equal(nivelDaVoz(envelopes, 2.5), 0);
  assert.equal(nivelDaVoz(envelopes, 3), 0);
  assert.equal(nivelDaVoz([], 0), 0);
});
