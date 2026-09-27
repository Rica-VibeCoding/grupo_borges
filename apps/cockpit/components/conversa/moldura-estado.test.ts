import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  alvosDaMoldura,
  animaSozinha,
  aproxima,
  assentou,
  caudaDaEspera,
  ouveVolume,
  suavizaNivel,
  tomDaCena,
  type Cena,
} from './moldura-estado.ts';

const CENAS: Cena[] = ['parado', 'preparando', 'ouvindo', 'transcrevendo', 'esperandoZe', 'falando', 'interrompendo', 'erro'];

describe('moldura: o que acende em cada cena', () => {
  it('a sua vez sobe do pé; a vez dele desce do topo; pensar orbita', () => {
    assert.equal(alvosDaMoldura('ouvindo').voce, 1);
    assert.equal(alvosDaMoldura('falando').ze, 1);
    assert.equal(alvosDaMoldura('esperandoZe').pensa, 1);
    assert.equal(alvosDaMoldura('transcrevendo').pensa, 1);
  });

  it('interromper junta a sua voz com a dele congelada', () => {
    const alvo = alvosDaMoldura('interrompendo');
    assert.equal(alvo.voce, 1);
    assert.equal(alvo.gelo, 1);
    assert.equal(alvo.ze, 0);
  });

  it('toda cena acende pelo menos uma camada, e o erro só a dele', () => {
    for (const cena of CENAS) {
      assert.ok(Object.values(alvosDaMoldura(cena)).some((p) => p > 0), cena);
    }
    const erro = alvosDaMoldura('erro');
    assert.deepEqual(Object.entries(erro).filter(([, p]) => p > 0).map(([c]) => c), ['erro']);
  });

  it('o clarão é quente na sua vez e frio na dele', () => {
    assert.equal(tomDaCena('ouvindo'), 'voce');
    assert.equal(tomDaCena('interrompendo'), 'voce');
    assert.equal(tomDaCena('falando'), 'ze');
    assert.equal(tomDaCena('esperandoZe'), 'pensa');
    assert.equal(tomDaCena('erro'), 'erro');
  });
});

describe('moldura: transição e laço', () => {
  it('aproxima o alvo sem saltar, e salta com movimento reduzido', () => {
    const de = alvosDaMoldura('ouvindo');
    const para = alvosDaMoldura('falando');
    const meio = aproxima(de, para, 1 / 60);
    assert.ok(meio.ze > 0 && meio.ze < 0.2);
    assert.ok(meio.voce < 1 && meio.voce > 0.8);
    assert.deepEqual(aproxima(de, para, Number.POSITIVE_INFINITY), para);
  });

  it('assenta em menos de um segundo a 60 quadros', () => {
    let pesos = alvosDaMoldura('ouvindo');
    const alvo = alvosDaMoldura('erro');
    for (let i = 0; i < 60; i++) pesos = aproxima(pesos, alvo, 1 / 60);
    assert.ok(assentou(pesos, alvo));
  });

  it('parado e erro dormem; o resto anima', () => {
    assert.equal(animaSozinha('parado'), false);
    assert.equal(animaSozinha('erro'), false);
    for (const cena of ['preparando', 'ouvindo', 'esperandoZe', 'falando', 'interrompendo'] as const) {
      assert.equal(animaSozinha(cena), true, cena);
    }
  });

  it('só as cenas com voz leem volume', () => {
    assert.deepEqual(CENAS.filter(ouveVolume), ['ouvindo', 'falando', 'interrompendo']);
  });

  it('a cauda da espera cresce até 20 s e para', () => {
    assert.equal(caudaDaEspera('esperandoZe', 0), 0.9);
    assert.equal(caudaDaEspera('esperandoZe', 20), caudaDaEspera('esperandoZe', 60));
    assert.equal(caudaDaEspera('transcrevendo', 30), 0.9);
  });

  it('o volume sobe rápido e desce devagar', () => {
    const subida = suavizaNivel(0, 1, 1 / 60);
    const descida = 1 - suavizaNivel(1, 0, 1 / 60);
    assert.ok(subida > descida * 3);
  });
});
