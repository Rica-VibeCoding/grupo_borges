// A sessão conferida pelo navegador (`lib/sessao-no-navegador.ts`): o que o
// `/auth/me` responde decide entre ficar, ir ao `/entrar` ou ao `/senha`.

import assert from 'node:assert/strict';
import test from 'node:test';

import { precisaTrocarSenha, rumoDaSessao } from './sessao-no-navegador.ts';

test('sessão morta leva ao /entrar', () => {
  assert.equal(rumoDaSessao(401, null), '/entrar');
});

test('senha a trocar leva ao /senha', () => {
  assert.equal(rumoDaSessao(200, { username: 'ana', trocar_senha: true }), '/senha');
});

test('sessão boa ou queda do portão: a tela fica e religa', () => {
  assert.equal(rumoDaSessao(200, { username: 'ana', trocar_senha: false }), null);
  assert.equal(rumoDaSessao(200, { username: 'ana' }), null);
  assert.equal(rumoDaSessao(502, null), null);
  assert.equal(rumoDaSessao(null, null), null);
});

test('trocar_senha só vale como booleano verdadeiro', () => {
  assert.equal(precisaTrocarSenha({ trocar_senha: 'true' }), false);
  assert.equal(precisaTrocarSenha(null), false);
});
