import assert from 'node:assert/strict';
import test from 'node:test';

import { conferePedido, recadoDaSenha } from './senha.ts';

const BOA = { atual: 'provisoria1', nova: 'minha-senha', confirmar: 'minha-senha' };

test('o pedido certo passa', () => {
  assert.equal(conferePedido(BOA), null);
});

test('a tela barra antes do portão o que ele recusaria com 422', () => {
  assert.match(conferePedido({ ...BOA, nova: 'curta', confirmar: 'curta' }) ?? '', /pelo menos 8/);
  assert.match(conferePedido({ ...BOA, nova: BOA.atual, confirmar: BOA.atual }) ?? '', /diferente da atual/);
});

test('campo vazio e confirmação diferente têm frase própria', () => {
  assert.match(conferePedido({ ...BOA, atual: '' }) ?? '', /três campos/);
  assert.match(conferePedido({ ...BOA, confirmar: 'minha-senhA' }) ?? '', /confirmação/);
});

test('cada resposta do portão vira uma frase própria', () => {
  const frases = [401, 422, 429, 403, 500, null].map(recadoDaSenha);
  assert.equal(new Set(frases).size, frases.length);
  assert.match(recadoDaSenha(401), /atual não confere/);
});
