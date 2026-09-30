import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GestoDaConversa } from './gesto-de-arrasto.ts';
import type { Cena } from './moldura-estado.ts';
import { aoSoltar, dedoAosQuinhentos, dedoQueAnda, podeSegurar, SEGURAR_MS, type Dedo } from './segurar-a-vez.ts';

const CENAS: Cena[] = ['preparando', 'parado', 'ouvindo', 'transcrevendo', 'esperandoZe', 'falando', 'interrompendo', 'erro'];

type Passo = 'anda' | 'quinhentos';

/** Um dedo inteiro: o que aconteceu com ele até soltar, e o que o soltar faz. */
function dedo(cena: Cena, historia: Passo[], gesto: GestoDaConversa) {
  let atual: Dedo = 'toque';
  let segurou = false;
  for (const passo of historia) {
    atual = passo === 'anda' ? dedoQueAnda(atual) : dedoAosQuinhentos(atual, cena);
    segurou ||= atual === 'segurando';
  }
  return { segurou, soltar: aoSoltar(atual, gesto) };
}

describe('segurar a vez: gesto × estado', () => {
  it('o limiar do dedo parado é meio segundo', () => {
    assert.equal(SEGURAR_MS, 500);
  });

  it('só a vez do Rica pode ser segura', () => {
    assert.deepEqual(
      CENAS.filter(podeSegurar),
      ['ouvindo'],
    );
  });

  it('dedo parado 500 ms em ouvindo segura, e o soltar só devolve a contagem', () => {
    assert.deepEqual(dedo('ouvindo', ['quinhentos'], 'toque'), { segurou: true, soltar: 'solta' });
  });

  it('cena parado, dedo 800 ms sem andar, soltar → toque', () => {
    assert.deepEqual(dedo('parado', ['quinhentos'], 'toque'), { segurou: false, soltar: 'toque' });
  });

  it('fora da vez, dedo parado é toque em toda cena, curto ou longo', () => {
    for (const cena of CENAS.filter((c) => c !== 'ouvindo')) {
      assert.deepEqual(dedo(cena, [], 'toque'), { segurou: false, soltar: 'toque' }, cena);
      assert.deepEqual(dedo(cena, ['quinhentos'], 'toque'), { segurou: false, soltar: 'toque' }, cena);
    }
  });

  it('toque rápido continua sendo toque em toda cena, ouvindo inclusive', () => {
    for (const cena of CENAS) {
      assert.deepEqual(dedo(cena, [], 'toque'), { segurou: false, soltar: 'toque' }, cena);
    }
  });

  it('dedo que anda antes dos 500 ms é gesto e não segura, mesmo devagar', () => {
    for (const cena of CENAS) {
      assert.deepEqual(dedo(cena, ['anda', 'quinhentos'], 'cima'), { segurou: false, soltar: 'cima' }, cena);
      assert.deepEqual(dedo(cena, ['anda', 'quinhentos'], 'nada'), { segurou: false, soltar: 'nada' }, cena);
    }
  });

  it('dedo que andou e voltou ao lugar antes dos 500 ms segue sendo toque, como antes', () => {
    assert.deepEqual(dedo('ouvindo', ['anda'], 'toque'), { segurou: false, soltar: 'toque' });
  });

  it('depois de segurar, andar não vira gesto: o soltar só devolve a contagem', () => {
    assert.deepEqual(dedo('ouvindo', ['quinhentos', 'anda'], 'cima'), { segurou: true, soltar: 'solta' });
  });

  it('fora da vez, o dedo longo que anda depois dos 500 ms continua gesto', () => {
    assert.deepEqual(dedo('falando', ['quinhentos', 'anda'], 'cima'), { segurou: false, soltar: 'cima' });
    assert.deepEqual(dedo('parado', ['quinhentos', 'anda'], 'nada'), { segurou: false, soltar: 'nada' });
  });

  it('o dedo já decidido não muda de ideia aos 500 ms', () => {
    assert.equal(dedoAosQuinhentos('segurando', 'falando'), 'segurando');
    assert.equal(dedoAosQuinhentos('andou', 'ouvindo'), 'andou');
  });
});
