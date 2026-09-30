import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alvosComEscuta, alvosDaEsfera, coresComEscuta, coresDaEsfera, tomDoClarao } from './esfera-estado.ts';

describe('Esfera: a escuta com ele pensando', () => {
  it('sem escuta, nada muda', () => {
    for (const cena of ['esperandoZe', 'trabalhando', 'ouvindo'] as const) {
      assert.deepEqual(alvosComEscuta(cena, 'nao'), alvosDaEsfera(cena));
      assert.deepEqual(coresComEscuta(cena, 'nao'), coresDaEsfera(cena));
    }
  });

  it('aberta: o pensar segue e ganha um toque seu, com a borda pendendo para você', () => {
    const pesos = alvosComEscuta('esperandoZe', 'aberta');
    assert.equal(pesos.calma, 1);
    assert.ok(pesos.voce > 0 && pesos.voce < 0.5, 'um toque, não a sua vez');
    const borda = coresComEscuta('esperandoZe', 'aberta').borda;
    assert.ok(typeof borda === 'object' && borda.entre[0] === 'voce' && borda.peso < 0.5);
    assert.equal(alvosComEscuta('trabalhando', 'aberta').cristal, alvosDaEsfera('trabalhando').cristal);
  });

  it('falando: a sua vez inteira, sem apagar os veios do pensar', () => {
    const pesos = alvosComEscuta('ouvindo', 'falando');
    assert.equal(pesos.voce, 1);
    assert.ok(pesos.calma > 0);
    const corpo = coresComEscuta('ouvindo', 'falando').corpo;
    assert.ok(typeof corpo === 'object' && corpo.peso < 0.5, 'mais você que ele');
  });

  it('o clarão de quando a fala entra na fila dele é na sua cor — o recebido', () => {
    assert.equal(tomDoClarao('transcrevendo', 'esperandoZe'), 'voce');
    assert.equal(tomDoClarao('transcrevendo', 'trabalhando'), 'voce');
    assert.equal(tomDoClarao('transcrevendo', 'falando'), 'voce');
    assert.equal(tomDoClarao('esperandoZe', 'falando'), 'ze');
    assert.equal(tomDoClarao('falando', 'ouvindo'), 'voce');
    assert.equal(tomDoClarao('ouvindo', 'transcrevendo'), 'pensa');
  });
});
