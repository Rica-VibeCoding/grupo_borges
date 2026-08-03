import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ESCAPE_COMPACT_MS,
  ETA_COMPACT_PADRAO_MS,
  JANELA_DURACOES_COMPACT,
  TETO_PROGRESSO_COMPACT,
  etaDoCompact,
  faseDaEsperaCompact,
  formataTokens,
  mediana,
  progressoDoCompact,
  rotuloCronometroCompact,
} from './compact-eta.ts';

test('etaDoCompact — sem histórico, cai no padrão medido de 140s', () => {
  assert.equal(etaDoCompact([]), ETA_COMPACT_PADRAO_MS);
  assert.equal(ETA_COMPACT_PADRAO_MS, 140_000);
});

test('etaDoCompact — mediana das últimas 5 durações reais', () => {
  // 93s, 108s, 136s, 150s, 163s (as cinco manuais medidas em 02/08) → mediana 136s
  assert.equal(etaDoCompact([93_000, 108_000, 136_000, 150_000, 163_000]), 136_000);
});

test('etaDoCompact — com mais de 5 entradas, só as 5 MAIS RECENTES contam', () => {
  const antigas = [1_000, 2_000, 3_000, 4_000];
  const recentes = [100_000, 110_000, 120_000, 130_000, 140_000];
  assert.equal(etaDoCompact([...antigas, ...recentes]), 120_000);
  assert.equal(JANELA_DURACOES_COMPACT, 5);
});

test('etaDoCompact — duração inválida não contamina a mediana', () => {
  assert.equal(etaDoCompact([0, -5, Number.NaN, 120_000]), 120_000);
  assert.equal(etaDoCompact([0, Number.NaN]), ETA_COMPACT_PADRAO_MS);
});

test('mediana — par tira a média do meio, ímpar pega o central, não muta a entrada', () => {
  const par = [40, 10, 30, 20];
  assert.equal(mediana(par), 25);
  assert.deepEqual(par, [40, 10, 30, 20]);
  assert.equal(mediana([5, 1, 9]), 5);
});

test('progressoDoCompact — linear no ETA e TRAVADO em 90%', () => {
  const eta = 140_000;
  assert.equal(progressoDoCompact(0, eta), 0);
  assert.equal(progressoDoCompact(eta / 2, eta), 0.45);
  // No ETA exato e muito além dele: 90%, nunca 100% no chute.
  assert.equal(progressoDoCompact(eta, eta), TETO_PROGRESSO_COMPACT);
  assert.equal(progressoDoCompact(eta * 10, eta), TETO_PROGRESSO_COMPACT);
  assert.equal(TETO_PROGRESSO_COMPACT, 0.9);
  // Relógio do cliente à frente: negativo não existe.
  assert.equal(progressoDoCompact(-1_000, eta), 0);
});

test('faseDaEsperaCompact — enchendo até o ETA, quase-la depois, sem-retorno nos 6min', () => {
  const eta = 140_000;
  assert.equal(faseDaEsperaCompact(0, eta), 'enchendo');
  assert.equal(faseDaEsperaCompact(eta, eta), 'enchendo');
  assert.equal(faseDaEsperaCompact(eta + 1, eta), 'quase-la');
  assert.equal(faseDaEsperaCompact(ESCAPE_COMPACT_MS - 1, eta), 'quase-la');
  assert.equal(faseDaEsperaCompact(ESCAPE_COMPACT_MS, eta), 'sem-retorno');
  assert.equal(faseDaEsperaCompact(ESCAPE_COMPACT_MS * 2, eta), 'sem-retorno');
  assert.equal(ESCAPE_COMPACT_MS, 360_000);
});

test('rotuloCronometroCompact — "42s" até um minuto, "1m12s" depois', () => {
  assert.equal(rotuloCronometroCompact(0), '0s');
  assert.equal(rotuloCronometroCompact(42_000), '42s');
  assert.equal(rotuloCronometroCompact(72_000), '1m12s');
  assert.equal(rotuloCronometroCompact(600_000), '10m00s');
});

test('formataTokens — milhar abreviado com vírgula pt-BR', () => {
  assert.equal(formataTokens(842), '842');
  assert.equal(formataTokens(13_000), '13k');
  assert.equal(formataTokens(222_000), '222k');
  assert.equal(formataTokens(13_500), '13,5k');
});
