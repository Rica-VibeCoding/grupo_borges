import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alturaDoViewport } from './altura-do-viewport.ts';

test('teclado em cena: visual + deslocamento, os números do compositor', () => {
  // O aparelho em 12/08: visual 449, deslocamento 216 — fundo da app no topo
  // do teclado, "revelar" compensado.
  assert.equal(
    alturaDoViewport({ alturaVisual: 449, deslocamentoVisual: 216, alturaDaJanela: 852 }),
    665,
  );
});

test('sem panorâmica o deslocamento é zero e o visual manda sozinho', () => {
  assert.equal(
    alturaDoViewport({ alturaVisual: 655, deslocamentoVisual: 0, alturaDaJanela: 852 }),
    655,
  );
});

test('sem viewport visual a janela é a reserva', () => {
  assert.equal(alturaDoViewport({ alturaDaJanela: 844 }), 844);
});

test('arredonda medidas fracionárias para uma altura CSS estável', () => {
  assert.equal(
    alturaDoViewport({ alturaVisual: 448.6, deslocamentoVisual: 215.7, alturaDaJanela: 852 }),
    664,
  );
});

test('medida inválida não vira altura', () => {
  assert.equal(alturaDoViewport({ alturaVisual: Number.NaN, alturaDaJanela: 0 }), 0);
});
