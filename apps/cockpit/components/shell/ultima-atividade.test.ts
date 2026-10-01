import assert from 'node:assert/strict';
import test from 'node:test';

import { formataUltimaAtividade } from './ultima-atividade.ts';

test('última atividade: unidade maior só, e travessão sem leitura', () => {
  const agora = 1_000_000;
  assert.equal(formataUltimaAtividade(null, agora), '—');
  assert.equal(formataUltimaAtividade(agora - 5, agora), 'agora');
  assert.equal(formataUltimaAtividade(agora + 30, agora), 'agora');
  assert.equal(formataUltimaAtividade(agora - 12 * 60 - 30, agora), '12 min');
  assert.equal(formataUltimaAtividade(agora - 3 * 3600 - 59 * 60, agora), '3 h');
  assert.equal(formataUltimaAtividade(agora - 2 * 86_400 - 5 * 3600, agora), '2 d');
});
