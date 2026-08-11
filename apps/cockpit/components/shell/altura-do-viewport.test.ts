import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alturaDoViewport } from './altura-do-viewport.ts';

test('prioriza a altura do viewport visual quando ela existe', () => {
  assert.equal(alturaDoViewport({ alturaVisual: 780, alturaDaJanela: 844 }), 780);
});

test('usa a altura da janela como reserva', () => {
  assert.equal(alturaDoViewport({ alturaVisual: undefined, alturaDaJanela: 844 }), 844);
});

test('arredonda medidas fracionárias para uma altura CSS estável', () => {
  assert.equal(alturaDoViewport({ alturaVisual: 779.6, alturaDaJanela: 844 }), 780);
});

test('aplicativo instalado usa a janela inteira quando o teclado está fechado', () => {
  assert.equal(
    alturaDoViewport({
      alturaVisual: 1000,
      alturaDaJanela: 1180,
      modoAplicativo: true,
      tecladoAberto: false,
    }),
    1180,
  );
});

test('aplicativo instalado usa o viewport visual quando o teclado está aberto', () => {
  assert.equal(
    alturaDoViewport({
      alturaVisual: 760,
      alturaDaJanela: 1180,
      modoAplicativo: true,
      tecladoAberto: true,
    }),
    760,
  );
});
