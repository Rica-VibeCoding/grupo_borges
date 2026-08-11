import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideVazio } from './decide-vazio.ts';

// O domínio inteiro: histórico × delegação × status do stream. A regressão
// que motivou a extração é o `connecting`/`replaying` com delegação: a
// delegação não pode furar o branco honesto (senão entra sozinha e o
// histórico empurra ela depois — salto na tela). Só `live` + delegação
// mostra o feed com histórico vazio.
test('sem histórico e status não-live: branco, mesmo com delegação', () => {
  for (const status of ['connecting', 'replaying', 'reconnecting'] as const) {
    assert.equal(decideVazio({ temHistorico: false, temDelegacao: true, status }), 'nada');
    assert.equal(decideVazio({ temHistorico: false, temDelegacao: false, status }), 'nada');
  }
});

test('sem histórico, live, com delegação: feed (a correção)', () => {
  assert.equal(decideVazio({ temHistorico: false, temDelegacao: true, status: 'live' }), 'feed');
});

test('sem histórico, live, sem delegação: sem-conversa', () => {
  assert.equal(
    decideVazio({ temHistorico: false, temDelegacao: false, status: 'live' }),
    'sem-conversa',
  );
});

test('com histórico, o status não manda: feed sempre', () => {
  for (const status of ['connecting', 'replaying', 'reconnecting', 'live'] as const) {
    assert.equal(decideVazio({ temHistorico: true, temDelegacao: false, status }), 'feed');
    assert.equal(decideVazio({ temHistorico: true, temDelegacao: true, status }), 'feed');
  }
});

test('status nulo trata como não-live', () => {
  assert.equal(decideVazio({ temHistorico: false, temDelegacao: true, status: null }), 'nada');
});
