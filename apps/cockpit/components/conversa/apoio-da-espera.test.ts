import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TEMPOS } from '../../lib/conversa/tipos.ts';
import { criaRelogioDoApoio } from './apoio-da-espera.ts';

test('prazos aprovados: 10 s, 30 s e 60 s desde o fim audível', () => {
  assert.equal(TEMPOS.ponte, 10_000);
  assert.equal(TEMPOS.avisoDemora, 30_000);
  const r = criaRelogioDoApoio();
  r.inicia(0);
  assert.equal(r.tique(9_999, false), null);
  assert.ok(r.tique(10_000, false));
  r.falou(12_000);
  assert.equal(r.tique(41_999, false), null);
  assert.ok(r.tique(42_000, false));
  r.falou(44_000);
  assert.equal(r.tique(103_999, false), null);
  assert.ok(r.tique(104_000, false));
  r.falou(107_000);
  assert.equal(r.tique(166_999, false), null);
  assert.ok(r.tique(167_000, false));
});

test('fala real reinicia silêncio mas nunca rebaixa o degrau do turno', () => {
  const r = criaRelogioDoApoio();
  r.inicia(0);
  r.falou(8_000);
  assert.equal(r.tique(17_999, false), null);
  assert.ok(r.tique(18_000, false));
  r.falou(20_000);
  r.falou(40_000);
  assert.equal(r.tique(69_999, false), null);
  assert.ok(r.tique(70_000, false));
  r.falou(72_000);
  r.falou(100_000);
  assert.equal(r.tique(159_999, false), null);
  assert.ok(r.tique(160_000, false));
});

test('captura bloqueia pedido vencido, fim desarma e novo turno reinicia degrau', () => {
  const r = criaRelogioDoApoio();
  r.inicia(0);
  assert.equal(r.tique(100_000, true), null);
  assert.ok(r.tique(100_001, false));
  r.encerra();
  r.falou(110_000);
  assert.equal(r.tique(999_999, false), null);
  r.inicia(1_000_000);
  assert.equal(r.tique(1_009_999, false), null);
  assert.ok(r.tique(1_010_000, false));
});

test('sem descrição ou síntese falha não dispara a cada tique', () => {
  const r = criaRelogioDoApoio();
  r.inicia(0);
  assert.ok(r.tique(10_000, false));
  assert.equal(r.tique(10_250, false), null);
  assert.ok(r.tique(40_000, false));
  assert.equal(r.tique(40_250, false), null);
  assert.ok(r.tique(100_000, false));
});
