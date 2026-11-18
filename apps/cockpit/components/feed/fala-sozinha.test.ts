import assert from 'node:assert/strict';
import test from 'node:test';

import { criaVigiaDaFala, gravaFalaLigada, leFalaLigada } from './fala-sozinha.ts';

const textos: Record<string, string> = {
  velha: 'Resposta antiga. ```\n┌─┐\n└─┘\n```',
  u1: 'por que o céu é azul?',
  a1: 'Vou pensar...',
  a2: 'Uau, boa pergunta! ⚽\n```\n┌── CÉU ──┐\n│ luz     │\n└─────────┘\n```\nQuer outro desafio? 🤔',
};
const textoDe = (chave: string) => textos[chave];

test('sem gesto nesta abertura, nada fala — nem o histórico, nem o que chega', () => {
  const vigia = criaVigiaDaFala();
  vigia.observa([{ chave: 'velha', kind: 'assistant' }], false);
  vigia.observa([{ chave: 'velha', kind: 'assistant' }, { chave: 'a2', kind: 'assistant' }], false);
  assert.equal(vigia.temPendente(), false);
});

test('armado, fala só o que chegou depois: a última fala do turno, fora da lousa', () => {
  const vigia = criaVigiaDaFala();
  vigia.observa([{ chave: 'velha', kind: 'assistant' }], false);
  const lista = [
    { chave: 'velha', kind: 'assistant' },
    { chave: 'u1', kind: 'user' },
    { chave: 'a1', kind: 'assistant' },
    { chave: 'x', kind: 'chip' },
    { chave: 'a2', kind: 'assistant' },
  ];
  vigia.observa(lista, true);
  assert.equal(vigia.temPendente(), true);
  assert.equal(vigia.colhe(textoDe), 'Uau, boa pergunta! Quer outro desafio?');
  assert.equal(vigia.temPendente(), false);
  // Rever a mesma lista não fala de novo.
  vigia.observa(lista, true);
  assert.equal(vigia.temPendente(), false);
});

test('resposta só de lousa não vira fala vazia', () => {
  const vigia = criaVigiaDaFala();
  vigia.observa([], true);
  vigia.observa([{ chave: 'velha', kind: 'assistant' }], true);
  assert.equal(vigia.colhe(() => '```\n┌─┐\n└─┘\n```'), null);
});

test('última fala só de lousa: fala a anterior que tem o que dizer', () => {
  const vigia = criaVigiaDaFala();
  vigia.observa([], true);
  vigia.observa([{ chave: 'a2', kind: 'assistant' }, { chave: 'velha', kind: 'assistant' }], true);
  const so = (c: string) => (c === 'velha' ? '```\n┌─┐\n└─┘\n```' : textos[c]);
  assert.equal(vigia.colhe(so), 'Uau, boa pergunta! Quer outro desafio?');
});

test('a chave do aparelho: ausente é ligada; só "0" cala', () => {
  assert.equal(leFalaLigada(null), true);
  assert.equal(leFalaLigada(undefined), true);
  assert.equal(leFalaLigada('1'), true);
  assert.equal(leFalaLigada('0'), false);
  assert.equal(gravaFalaLigada(false), '0');
  assert.equal(leFalaLigada(gravaFalaLigada(true)), true);
});
