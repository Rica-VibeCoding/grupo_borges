import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alturaDoViewport } from './altura-do-viewport.ts';

test('com o teclado aberto encolhe para o viewport visual', () => {
  assert.equal(alturaDoViewport({ alturaVisual: 380, alturaDaJanela: 733, tecladoAberto: true }), 380);
});

test('com o teclado fechado fica com a janela inteira', () => {
  assert.equal(alturaDoViewport({ alturaVisual: 1000, alturaDaJanela: 1180 }), 1180);
});

test('usa a altura da janela como reserva', () => {
  assert.equal(alturaDoViewport({ alturaVisual: undefined, alturaDaJanela: 844 }), 844);
});

test('arredonda medidas fracionárias para uma altura CSS estável', () => {
  assert.equal(
    alturaDoViewport({ alturaVisual: 779.6, alturaDaJanela: 844, tecladoAberto: true }),
    780,
  );
});
