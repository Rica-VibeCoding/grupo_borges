import assert from 'node:assert/strict';
import { it } from 'node:test';

import { criaParcialDoCanal } from './parcial-do-canal.ts';

it('os pedaços da fala se somam na ordem em que chegam', () => {
  const p = criaParcialDoCanal();
  assert.equal(p.soma('item_1', ' Can'), ' Can');
  assert.equal(p.soma('item_1', 'ário'), ' Canário');
  assert.equal(p.soma('item_1', ', teste'), ' Canário, teste');
});

it('item novo começa do zero', () => {
  const p = criaParcialDoCanal();
  p.soma('item_1', 'Oi');
  assert.equal(p.soma('item_2', 'Tchau'), 'Tchau');
});

it('tosse limpa do canal: o que sobrar dela é ignorado, a fala seguinte (item novo) aparece', () => {
  const p = criaParcialDoCanal();
  p.soma('item_tosse', 'Hã');
  p.descarta();
  assert.equal(p.soma('item_tosse', 'm'), undefined);
  assert.equal(p.soma('item_fala', ' Canário'), ' Canário');
});

it('descartar sem pedaço nenhum não marca item algum', () => {
  const p = criaParcialDoCanal();
  p.descarta();
  assert.equal(p.soma('item_1', 'Oi'), 'Oi');
});
