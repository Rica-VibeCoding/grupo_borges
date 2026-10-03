import assert from 'node:assert/strict';
import test from 'node:test';

import { destinoDoLogin, recadoDaRecusa } from './entrada.ts';

test('cada recusa do portão vira uma frase própria', () => {
  const frases = [401, 429, 403, 500, null].map(recadoDaRecusa);
  assert.equal(new Set(frases).size, frases.length);
  assert.match(recadoDaRecusa(401), /não conferem/);
  assert.match(recadoDaRecusa(429), /15 minutos/);
});

test('o destino é o agente da sessão, e só um slug do cadastro', () => {
  assert.equal(destinoDoLogin({ slug: 'teste' }), '/agente/teste');
  assert.equal(destinoDoLogin({ slug: null }), null);
  assert.equal(destinoDoLogin(null), null);
  // Slug fora da forma do cadastro do portão não vira URL.
  assert.equal(destinoDoLogin({ slug: '../faxina' }), null);
  assert.equal(destinoDoLogin({ slug: 'https://fora.example' }), null);
});
