import assert from 'node:assert/strict';
import { test } from 'node:test';

import { relogioAncorado } from './relogio-ancorado.ts';

const SERVIDOR = 1_754_800_000; // segundos
const MONTOU = 9_000_000_000; // ms do relógio do cliente, arbitrário

test('no instante da montagem devolve o relógio do servidor', () => {
  assert.equal(relogioAncorado(SERVIDOR, MONTOU, MONTOU), SERVIDOR);
});

test('anda com o cliente, não COM o cliente como referência', () => {
  // Cinco segundos de browser = cinco segundos somados ao valor do servidor.
  // O relógio do iPhone pode estar horas adiantado (já quebrou o compact em
  // 09/08); o que importa dele é o quanto andou, nunca que horas ele marca.
  assert.equal(relogioAncorado(SERVIDOR, MONTOU, MONTOU + 5_000), SERVIDOR + 5);
});

test('fração de segundo não acumula degrau falso', () => {
  assert.equal(relogioAncorado(SERVIDOR, MONTOU, MONTOU + 1_500), SERVIDOR + 1);
  assert.equal(relogioAncorado(SERVIDOR, MONTOU, MONTOU + 1_999), SERVIDOR + 1);
});

test('relógio do cliente que anda para trás não faz a sessão encolher', () => {
  // Ajuste de NTP no meio da aba aberta. Duração de sessão só cresce — devolver
  // menos que a âncora desenharia o agente entrando na máquina do tempo.
  assert.equal(relogioAncorado(SERVIDOR, MONTOU, MONTOU - 30_000), SERVIDOR);
});
