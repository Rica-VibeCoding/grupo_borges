import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { criaChegadas, PRAZO_DA_CHEGADA_MS, type ItemObservado } from './chegada-ao-vivo.ts';

const fala = (chave: string): ItemObservado => ({ chave, kind: 'assistant' });
const doRica = (chave: string): ItemObservado => ({ chave, kind: 'user' });

describe('chegada ao vivo', () => {
  it('a carga inicial é semente: nada dela anima', () => {
    const c = criaChegadas();
    c.observa([fala('a'), fala('b')], 0);
    assert.equal(c.chegando('a', 0), false);
    assert.equal(c.chegando('b', 0), false);
  });

  it('lista vazia antes do replay não semeia — o replay inteiro é a carga', () => {
    const c = criaChegadas();
    c.observa([], 0);
    c.observa([fala('a'), fala('b')], 10);
    assert.equal(c.chegando('b', 10), false);
  });

  it('fala do agente que chega depois da carga anima', () => {
    const c = criaChegadas();
    c.observa([fala('a')], 0);
    c.observa([fala('a'), fala('b')], 100);
    assert.equal(c.chegando('b', 150), true);
  });

  it('a bolha do Rica não anima aqui — quem a anima é o voo do envio', () => {
    const c = criaChegadas();
    c.observa([fala('a')], 0);
    c.observa([fala('a'), doRica('cc-otimista-eco-1')], 100);
    assert.equal(c.chegando('cc-otimista-eco-1', 100), false);
  });

  it('observar a mesma lista duas vezes (StrictMode) não muda a resposta', () => {
    const c = criaChegadas();
    c.observa([fala('a')], 0);
    c.observa([fala('a'), fala('b')], 100);
    c.observa([fala('a'), fala('b')], 110);
    assert.equal(c.chegando('b', 120), true);
  });

  it('depois de animar uma vez, sair e voltar da janela virtual não repete', () => {
    const c = criaChegadas();
    c.observa([fala('a')], 0);
    c.observa([fala('a'), fala('b')], 100);
    c.terminou('b');
    assert.equal(c.chegando('b', 200), false);
  });

  it('item que só monta depois do prazo (Rica rolado para cima) entra seco', () => {
    const c = criaChegadas();
    c.observa([fala('a')], 0);
    c.observa([fala('a'), fala('b')], 100);
    assert.equal(c.chegando('b', 100 + PRAZO_DA_CHEGADA_MS + 1), false);
    assert.equal(c.chegando('b', 100), false);
  });
});
