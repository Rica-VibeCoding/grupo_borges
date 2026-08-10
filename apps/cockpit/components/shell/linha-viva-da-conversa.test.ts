import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ancoraDaLinhaViva } from './linha-viva-da-conversa.ts';

const DESDE = 1_754_800_000_000;

/** O caso feliz: o agente trabalha, nada mais no fim do feed diz isso, e a
 *  frota concorda que ele está de pé. */
const CORRENDO = {
  correndo: true,
  vencida: false,
  trabalhoEmVooNoFim: false,
  desdeMs: DESDE,
  statusDaFrota: 'trabalhando',
} as const;

test('linha viva aparece quando a corrida está de pé e o fim do feed está mudo', () => {
  assert.equal(ancoraDaLinhaViva(CORRENDO), DESDE);
});

test('o agente OFFLINE na frota desliga a linha viva na hora', () => {
  // O defeito de 10/08: o Rica desliga o agente, o turno morre sem despedida e
  // o "Pensando" fica de pé até o prazo de 5 min do `linha-viva.ts`. A frota
  // sabe do desligamento em segundos — quem sabe manda.
  assert.equal(ancoraDaLinhaViva({ ...CORRENDO, statusDaFrota: 'offline' }), null);
});

test('a frota só DESLIGA — ociosa com corrida de pé não apaga a linha', () => {
  // O lifecycle tem 300 s de frescor: o agente pode estar trabalhando há dois
  // segundos e a frota ainda dizer "ocioso". Deixar esse valor apagar a linha
  // seria trocar uma mentira por outra.
  assert.equal(ancoraDaLinhaViva({ ...CORRENDO, statusDaFrota: 'ocioso' }), DESDE);
  assert.equal(ancoraDaLinhaViva({ ...CORRENDO, statusDaFrota: 'aguardando' }), DESDE);
});

test('agente fora da frota não decide nada', () => {
  assert.equal(ancoraDaLinhaViva({ ...CORRENDO, statusDaFrota: null }), DESDE);
});

test('a régua nova só SUBTRAI — não inventa linha onde não havia', () => {
  assert.equal(ancoraDaLinhaViva({ ...CORRENDO, correndo: false }), null);
  assert.equal(ancoraDaLinhaViva({ ...CORRENDO, desdeMs: null }), null);
  assert.equal(ancoraDaLinhaViva({ ...CORRENDO, trabalhoEmVooNoFim: true }), null);
  assert.equal(ancoraDaLinhaViva({ ...CORRENDO, vencida: true }), null);
});
