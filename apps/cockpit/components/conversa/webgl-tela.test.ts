import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escalaDaEsfera } from './esfera-estado.ts';
import { tamanhoDoBuffer } from './webgl-tela.ts';

describe('tamanhoDoBuffer', () => {
  it('a esfera mini (28 px, escala 0,75) sai com o buffer cheio no dpr 2', () => {
    assert.deepEqual(tamanhoDoBuffer(28, 28, 2, 0.75), { largura: 42, altura: 42, esc: 1.5 });
  });

  it('o buffer sai do tamanho de layout: a caixa medida em scale(0.6) daria 60% dos pixels', () => {
    // 28 × 0,6 = 16,8 px — o que o getBoundingClientRect devolvia no meio da entrada.
    const borrado = tamanhoDoBuffer(16.8, 16.8, 2, 0.75);
    const nitido = tamanhoDoBuffer(28, 28, 2, 0.75);
    assert.equal(borrado.largura, 25);
    assert.equal(nitido.largura, 42);
  });

  it('dpr acima de 2 é limitado a 2; dpr ausente vale 1', () => {
    assert.equal(tamanhoDoBuffer(28, 28, 3, 1).largura, 56);
    assert.equal(tamanhoDoBuffer(28, 28, 0, 1).largura, 28);
  });

  it('caixa zerada não gera buffer de 0 nem divisão por zero', () => {
    assert.deepEqual(tamanhoDoBuffer(0, 0, 2, 0.75), { largura: 1, altura: 1, esc: 1 });
  });
});

describe('escala da esfera — a mini nítida, a tela cheia como estava', () => {
  it('mini (28 px) sai com o buffer cheio em dpr 1 e 2', () => {
    assert.deepEqual(tamanhoDoBuffer(28, 28, 1, escalaDaEsfera(true)), { largura: 28, altura: 28, esc: 1 });
    assert.deepEqual(tamanhoDoBuffer(28, 28, 2, escalaDaEsfera(true)), { largura: 56, altura: 56, esc: 2 });
  });

  it('tela cheia segue em 0,75', () => {
    assert.equal(escalaDaEsfera(false), 0.75);
  });
});
