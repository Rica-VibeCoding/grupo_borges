import assert from 'node:assert/strict';
import { it } from 'node:test';
import { rotulaModelo } from './motor.ts';

it('rótulo oficial vence heurística legada Kimi', () => {
  assert.equal(rotulaModelo('kimi-for-coding', { 'kimi-for-coding': 'K2.7 Coding' }), 'K2.7 Coding');
});
