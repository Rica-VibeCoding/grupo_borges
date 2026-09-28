import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  alternaPesquisa,
  assinaPesquisa,
  podePesquisar,
  pesquisaEstaAtiva,
  prefixaPesquisa,
} from './pesquisa-canario.ts';

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

test('o toggle é por agente e avisa quem assina', () => {
  let avisos = 0;
  const solta = assinaPesquisa(() => { avisos += 1; });
  assert.equal(pesquisaEstaAtiva('canarinho'), false);
  alternaPesquisa('canarinho');
  assert.equal(pesquisaEstaAtiva('canarinho'), true);
  assert.equal(pesquisaEstaAtiva('pavan'), false);
  alternaPesquisa('canarinho');
  assert.equal(pesquisaEstaAtiva('canarinho'), false);
  assert.equal(avisos, 2);
  solta();
  alternaPesquisa('canarinho');
  assert.equal(avisos, 2);
  alternaPesquisa('canarinho');
});

test('só o Canarinho pesquisa', () => {
  assert.equal(podePesquisar('canarinho'), true);
  assert.equal(podePesquisar('pavan'), false);
});
