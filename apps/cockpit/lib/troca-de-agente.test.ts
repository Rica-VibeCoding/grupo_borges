import assert from 'node:assert/strict';
import { test } from 'node:test';

import { trocandoDeAgente } from './troca-de-agente.ts';

test('tocou noutro agente: há troca em voo', () => {
  assert.equal(trocandoDeAgente('daniel', 'pavan'), true);
});

test('tocou no agente que já está aberto: não há troca', () => {
  assert.equal(trocandoDeAgente('pavan', 'pavan'), false);
});

test('da raiz, sem agente aberto, o toque também é troca', () => {
  assert.equal(trocandoDeAgente('daniel', undefined), true);
});

test('fora de rota de agente (a raiz) sem toque: nada a esmaecer', () => {
  assert.equal(trocandoDeAgente(undefined, undefined), false);
});
