import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chaveRecomendada, janelaDoReset, nomeCurto, tempoDa5h, tempoDa7d } from './conta-folga.ts';

describe('tempo da janela como fração', () => {
  it('5h: horas que faltam arredondadas para cima', () => {
    assert.equal(tempoDa5h({ remaining_seconds: 97 * 60 })?.fracao, '2h/5h');
    assert.equal(tempoDa5h({ remaining_seconds: 60 })?.fracao, '1h/5h');
    assert.equal(tempoDa5h({ remaining_seconds: 97 * 60 })?.volta, null);
    assert.match(tempoDa5h({ remaining_seconds: 97 * 60, resets_at: 1_790_000_000 })?.volta ?? '', /^volta \d\d:\d\d$/);
  });

  it('7d: dias que faltam arredondados para cima', () => {
    assert.equal(tempoDa7d({ remaining_seconds: 5 * 86_400 + 14 * 3_600 })?.fracao, '6/7 d');
    assert.equal(tempoDa7d({ remaining_seconds: 2 * 86_400 })?.fracao, '2/7 d');
  });

  it('sem leitura não inventa tempo', () => {
    assert.equal(tempoDa5h(null), null);
    assert.equal(tempoDa7d({ remaining_seconds: 0 }), null);
    assert.equal(tempoDa7d({ remaining_seconds: null }), null);
  });
});

describe('chaveRecomendada — mais folga somando as duas janelas', () => {
  it('escolhe a de menor uso somado', () => {
    assert.equal(
      chaveRecomendada([
        { chave: 'a', pct5h: 15, pct7d: 18 },
        { chave: 'b', pct5h: 0, pct7d: 19 },
      ]),
      'b',
    );
  });

  it('janela no teto tira a conta da disputa', () => {
    assert.equal(
      chaveRecomendada([
        { chave: 'a', pct5h: 96, pct7d: 1 },
        { chave: 'b', pct5h: 50, pct7d: 50 },
        { chave: 'c', pct5h: 60, pct7d: 50 },
      ]),
      'b',
    );
  });

  it('janela que volta em até 15 min conta como vazia', () => {
    assert.equal(
      chaveRecomendada([
        { chave: 'a', pct5h: 98, pct7d: 10, volta5hEm: 600 },
        { chave: 'b', pct5h: 20, pct7d: 10, volta5hEm: 7_200 },
      ]),
      'a',
    );
  });

  it('sem duas candidatas, ou empate, não recomenda', () => {
    assert.equal(chaveRecomendada([{ chave: 'a', pct5h: 1, pct7d: 1 }, { chave: 'b', pct5h: null, pct7d: 1 }]), null);
    assert.equal(chaveRecomendada([{ chave: 'a', pct5h: 10, pct7d: 20 }, { chave: 'b', pct5h: 20, pct7d: 10 }]), null);
  });
});

describe('janelaDoReset', () => {
  it('reset absoluto vira janela com o restante', () => {
    assert.deepEqual(janelaDoReset(1_000, 400), { resets_at: 1_000, remaining_seconds: 600 });
    assert.equal(janelaDoReset(null, 400), null);
    assert.equal(tempoDa7d(janelaDoReset(1_000 + 3 * 86_400, 1_000))?.fracao, '3/7 d');
  });
});

describe('nomeCurto', () => {
  it('corta o domínio e preserva rótulo que não é email', () => {
    assert.equal(nomeCurto('woodpromais@gmail.com'), 'woodpromais');
    assert.equal(nomeCurto('Wood Pro'), 'Wood Pro');
  });
});
