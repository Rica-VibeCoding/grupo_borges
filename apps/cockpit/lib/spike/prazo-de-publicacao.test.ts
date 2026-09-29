import assert from 'node:assert/strict';
import { test } from 'node:test';

import { criaPrazoDePublicacao } from './prazo-de-publicacao.ts';

function bancada() {
  const timers = new Map<number, { callback: () => void; atraso: number }>();
  let id = 0;
  let publicacoes = 0;
  const prazo = criaPrazoDePublicacao(
    () => { publicacoes += 1; },
    (callback, atraso) => { timers.set(++id, { callback, atraso }); return id; },
    (timer) => { timers.delete(timer); },
  );
  return { prazo, timers, publicacoes: () => publicacoes };
}

test('rajada não adia o prazo da primeira mensagem', () => {
  const b = bancada();
  b.prazo.agenda();
  b.prazo.agenda();
  assert.equal(b.timers.size, 1);
  assert.equal(b.timers.get(1)?.atraso, 50);
  b.timers.get(1)?.callback();
  assert.equal(b.publicacoes(), 1);
  b.prazo.agenda();
  assert.ok(b.timers.has(2));
});

test('frame normal, replay ou desmontagem cancelam a publicação pendente', () => {
  const b = bancada();
  b.prazo.agenda();
  b.prazo.cancela();
  b.prazo.cancela();
  assert.equal(b.timers.size, 0);
  assert.equal(b.publicacoes(), 0);
  b.prazo.agenda();
  assert.equal(b.timers.size, 1);
});
