import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estadoDaBolinha } from './bolinha-estado.ts';

describe('estadoDaBolinha', () => {
  it('nasce offline enquanto a frota não respondeu', () => {
    assert.equal(estadoDaBolinha({ status: undefined, turnoVivo: false }), 'offline');
  });

  it('agente desligado não anima, mesmo com turno preso no stream', () => {
    assert.equal(estadoDaBolinha({ status: 'offline', turnoVivo: true }), 'offline');
  });

  it('quem chama uma pessoa vence quem está ocupado', () => {
    // O âmbar é o único estado que precisa de humano: um turno em voo não pode
    // escondê-lo, senão o pedido de resposta fica invisível na tela.
    assert.equal(estadoDaBolinha({ status: 'aguardando', turnoVivo: true }), 'atencao');
  });

  it('o turno vivo do stream acende antes da frota concordar', () => {
    // É o caso que motivou o `lib/turno-vivo.ts`: o `status` da frota chega no
    // tempo do painel, e o agente já está pensando há segundos.
    assert.equal(estadoDaBolinha({ status: 'ocioso', turnoVivo: true }), 'pensando');
  });

  it('a frota sozinha também acende, quando o stream ainda não abriu', () => {
    assert.equal(estadoDaBolinha({ status: 'trabalhando', turnoVivo: false }), 'pensando');
  });

  it('vivo e sem turno é parado', () => {
    assert.equal(estadoDaBolinha({ status: 'ocioso', turnoVivo: false }), 'parado');
  });
});
