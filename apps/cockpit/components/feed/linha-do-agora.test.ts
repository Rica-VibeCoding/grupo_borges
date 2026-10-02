import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estadoDoAgora, fraseEmVoo } from './linha-do-agora.ts';

test('a esfera não olha pra caixa nem pula: ouvindo e pronto viram parado', () => {
  assert.equal(estadoDoAgora({ status: 'ocioso', turnoVivo: false, produzindo: false }), 'parado');
});

test('sem frota é desligado; turno vivo sem output é pensando; com output, executando', () => {
  assert.equal(estadoDoAgora({ status: undefined, turnoVivo: true, produzindo: true }), 'offline');
  assert.equal(estadoDoAgora({ status: 'trabalhando', turnoVivo: true, produzindo: false }), 'pensando');
  assert.equal(estadoDoAgora({ status: 'trabalhando', turnoVivo: true, produzindo: true }), 'executando');
});

test('quem espera o Rica vence o turno em voo', () => {
  assert.equal(estadoDoAgora({ status: 'aguardando', turnoVivo: true, produzindo: true }), 'atencao');
});

test('feed vazio não tem passo em voo', () => {
  assert.equal(fraseEmVoo([]), null);
});
