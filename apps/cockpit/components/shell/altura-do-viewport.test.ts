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

test('janela encolhida: a app continua ancorada na TELA', () => {
  // O modo de 793 do WebKit em `standalone`: a janela perde a faixa da status
  // bar e o visual encolhe junto (449 − 59 = 390). Sem a correção a app
  // publicaria 606 e o composer pararia 59px acima do teclado.
  assert.equal(
    alturaDoViewport({
      alturaVisual: 390,
      deslocamentoVisual: 216,
      alturaDaJanela: 852,
      alturaDaTela: 852,
      alturaDaJanelaCss: 793,
    }),
    665,
  );
});

test('janela inteira: a correção vale zero e a conta é a de sempre', () => {
  assert.equal(
    alturaDoViewport({
      alturaVisual: 449,
      deslocamentoVisual: 216,
      alturaDaJanela: 852,
      alturaDaTela: 852,
      alturaDaJanelaCss: 852,
    }),
    665,
  );
});

test('tela menor que a janela não encolhe a app', () => {
  assert.equal(
    alturaDoViewport({
      alturaVisual: 449,
      deslocamentoVisual: 216,
      alturaDaJanela: 852,
      alturaDaTela: 700,
      alturaDaJanelaCss: 852,
    }),
    665,
  );
});
