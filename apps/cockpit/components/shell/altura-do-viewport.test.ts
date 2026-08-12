import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alturaDoViewport } from './altura-do-viewport.ts';

test('usa a janela, que no aplicativo instalado já encolhe com o teclado', () => {
  assert.equal(alturaDoViewport({ alturaDaJanela: 655 }), 655);
});

test('arredonda medidas fracionárias para uma altura CSS estável', () => {
  assert.equal(alturaDoViewport({ alturaDaJanela: 851.6 }), 852);
});

test('medida inválida não vira altura', () => {
  assert.equal(alturaDoViewport({ alturaDaJanela: 0 }), 0);
  assert.equal(alturaDoViewport({ alturaDaJanela: Number.NaN }), 0);
});
