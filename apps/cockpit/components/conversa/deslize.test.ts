import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ARREMESSO,
  decideSemMovimento,
  decideSoltura,
  limitaAvanco,
  travaEixo,
  velocidadeFinal,
} from './deslize.ts';
import { LIMIAR } from './gesto-de-arrasto.ts';

const MEIO = { x: 200, y: 450 };
const anda = (dx: number, dy: number) => ({ x: MEIO.x + dx, y: MEIO.y + dy });

describe('eixo do arrasto', () => {
  it('dentro do raio do toque ainda não decide', () => {
    assert.equal(travaEixo(MEIO, anda(6, -7)), null);
    assert.equal(travaEixo(MEIO, anda(LIMIAR.toque, 0)), null);
  });

  it('de lado quando anda mais de lado que na vertical, pelos primeiros pixels', () => {
    assert.equal(travaEixo(MEIO, anda(12, 0)), 'horizontal');
    assert.equal(travaEixo(MEIO, anda(-12, 3)), 'horizontal');
    // O começo do arco do polegar: sobe, mas anda mais de lado.
    assert.equal(travaEixo(MEIO, anda(11, -8)), 'horizontal');
  });

  it('rolar e a diagonal íngreme ficam com a rolagem', () => {
    assert.equal(travaEixo(MEIO, anda(2, 14)), 'vertical');
    assert.equal(travaEixo(MEIO, anda(8, -10)), 'vertical');
    assert.equal(travaEixo(MEIO, anda(9, 9)), 'vertical');
  });
});

describe('soltura', () => {
  it('antes da metade e sem pressa, volta; passou da metade, vai', () => {
    assert.equal(decideSoltura(150, 393, 0.1), 'volta');
    assert.equal(decideSoltura(196.5, 393, 0.1), 'vai');
    assert.equal(decideSoltura(300, 393, 0), 'vai');
  });

  it('arremesso vai antes da metade', () => {
    assert.equal(decideSoltura(90, 393, ARREMESSO), 'vai');
    assert.equal(decideSoltura(90, 393, 1.2), 'vai');
    assert.equal(decideSoltura(90, 393, ARREMESSO - 0.01), 'volta');
  });

  it('arremessar de volta desiste, mesmo depois da metade', () => {
    assert.equal(decideSoltura(300, 393, -ARREMESSO), 'volta');
    assert.equal(decideSoltura(300, 393, -0.2), 'vai');
  });

  it('abaixo do limiar de sempre nunca vai, com a pressa que for', () => {
    assert.equal(decideSoltura(LIMIAR.arrasto - 1, 393, 3), 'volta');
    assert.equal(decideSoltura(LIMIAR.arrasto, 393, 3), 'vai');
  });

  it('a metade é da extensão do caminho: a gaveta da tropa é mais curta que a tela', () => {
    assert.equal(decideSoltura(131, 260, 0), 'vai');
    assert.equal(decideSoltura(129, 260, 0), 'volta');
  });

  it('com movimento reduzido vale só o limiar', () => {
    assert.equal(decideSemMovimento(LIMIAR.arrasto - 1), 'volta');
    assert.equal(decideSemMovimento(LIMIAR.arrasto), 'vai');
  });
});

describe('avanço e velocidade', () => {
  it('o avanço fica entre o começo e o destino', () => {
    assert.equal(limitaAvanco(-30, 393), 0);
    assert.equal(limitaAvanco(120, 393), 120);
    assert.equal(limitaAvanco(500, 393), 393);
  });

  it('a velocidade é a do fim do gesto, não a média', () => {
    // Andou devagar e acelerou nos últimos 100 ms.
    const amostras = [
      { t: 0, x: 0 },
      { t: 300, x: 30 },
      { t: 350, x: 60 },
      { t: 400, x: 100 },
    ];
    assert.equal(velocidadeFinal(amostras), (100 - 30) / 100);
    // Parou antes de soltar: nada de arremesso.
    assert.equal(velocidadeFinal([{ t: 0, x: 0 }, { t: 80, x: 150 }, { t: 400, x: 150 }]), 0);
    assert.equal(velocidadeFinal([]), 0);
    assert.equal(velocidadeFinal([{ t: 5, x: 5 }]), 0);
  });
});
