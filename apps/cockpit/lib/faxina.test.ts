import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  acoesPermitidas,
  descreverParado,
  emTransito,
  rotuloStatus,
  rotuloVeredito,
  statusAposAcao,
} from './faxina.ts';

const DIA = 86400;
const AGORA = 1_790_000_000;

test('pendente oferece manter e arquivar; arquivado só desfazer; trânsito nada', () => {
  assert.deepEqual(acoesPermitidas('pendente'), ['manter', 'arquivar']);
  assert.deepEqual(acoesPermitidas('arquivado'), ['desfazer']);
  assert.deepEqual(acoesPermitidas('arquivar_pedido'), []);
  assert.deepEqual(acoesPermitidas('erro'), []);
});

test('o otimista assume o status que o back grava', () => {
  assert.equal(statusAposAcao('manter'), 'mantido');
  assert.equal(statusAposAcao('arquivar'), 'arquivar_pedido');
  assert.equal(statusAposAcao('desfazer'), 'desfazer_pedido');
  assert.ok(emTransito('arquivar_pedido'));
  assert.ok(!emTransito('arquivado'));
});

test('parecer do Jev vira rótulo curto, e sem parecer não inventa', () => {
  assert.equal(rotuloVeredito({ jev_veredito: 'duplica', jev_duplica_de: 'a.md' }), 'Jev: duplica a.md');
  assert.equal(rotuloVeredito({ jev_veredito: 'duplica', jev_duplica_de: null }), 'Jev: duplica outro doc');
  assert.equal(rotuloVeredito({ jev_veredito: null, jev_duplica_de: null }), null);
});

test('erro mostra o motivo que o executor gravou', () => {
  assert.equal(rotuloStatus({ status: 'erro', erro: 'citado em CLAUDE.md' }), 'não arquivou: citado em CLAUDE.md');
  assert.equal(rotuloStatus({ status: 'pendente', erro: null }), null);
});

test('descreve leitura e commit em dias, com singular', () => {
  assert.equal(
    descreverParado({ ultima_leitura: null, ultimo_commit: AGORA - 34 * DIA }, AGORA),
    'nunca lido · 34 dias sem commit',
  );
  assert.equal(descreverParado({ ultima_leitura: AGORA - DIA, ultimo_commit: null }, AGORA), 'lido há 1 dia');
});
