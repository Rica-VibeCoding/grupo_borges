import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prefixaPesquisa } from './pesquisa-canario.ts';

test('toggle ativo prefixa a mensagem nova do Canarinho', () => {
  assert.equal(prefixaPesquisa('pesquise a cotação do milho', true), '/pesquisa pesquise a cotação do milho');
});

test('não altera texto sem toggle, vazio ou comando já escrito', () => {
  assert.equal(prefixaPesquisa('pesquise a cotação do milho', false), 'pesquise a cotação do milho');
  assert.equal(prefixaPesquisa('   ', true), '   ');
  assert.equal(prefixaPesquisa('/pesquisa pesquise a cotação do milho', true), '/pesquisa pesquise a cotação do milho');
  assert.equal(prefixaPesquisa('  /compact', true), '  /compact');
});

test('retomada preserva o corpo que já estava pendurado', () => {
  assert.equal(
    prefixaPesquisa('pesquise a cotação do milho', true, true),
    'pesquise a cotação do milho',
    'a retomada não pode adquirir um comando que não existia quando foi enfileirada',
  );
  assert.equal(
    prefixaPesquisa('/pesquisa pesquise a cotação do milho', true, true),
    '/pesquisa pesquise a cotação do milho',
    'um corpo já prefixado também não pode duplicar',
  );
});
