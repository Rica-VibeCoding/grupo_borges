import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estadoDaBolinha, type EntradaDaBolinha } from './bolinha-estado.ts';

/** O repouso: agente vivo, sem turno e sem escrita. Cada teste muda só o que
 *  está sendo provado. */
const PARADO: EntradaDaBolinha = { status: 'ocioso', turnoVivo: false, escrevendo: false };

describe('estadoDaBolinha', () => {
  it('nasce offline enquanto a frota não respondeu', () => {
    assert.equal(estadoDaBolinha({ ...PARADO, status: undefined }), 'offline');
  });

  it('agente desligado não anima, mesmo com turno preso no stream', () => {
    assert.equal(estadoDaBolinha({ ...PARADO, status: 'offline', turnoVivo: true }), 'offline');
  });

  it('quem chama uma pessoa vence quem está ocupado', () => {
    // O âmbar é o único estado que precisa de humano: nem turno em voo nem
    // escrita podem escondê-lo, senão o pedido fica invisível na tela.
    assert.equal(
      estadoDaBolinha({ status: 'aguardando', turnoVivo: true, escrevendo: true }),
      'atencao',
    );
  });

  it('o turno vivo do stream acende antes da frota concordar', () => {
    // É o caso que motivou o `lib/turno-vivo.ts`: o `status` da frota chega no
    // tempo do painel, e o agente já está pensando há segundos.
    assert.equal(estadoDaBolinha({ ...PARADO, turnoVivo: true }), 'pensando');
  });

  it('a frota sozinha também acende, quando o stream ainda não abriu', () => {
    assert.equal(estadoDaBolinha({ ...PARADO, status: 'trabalhando' }), 'pensando');
  });

  it('escrever é caso particular de estar em turno, e ganha do pensar', () => {
    // Sem esta precedência, o agente responderia a mensagem inteira com cara de
    // quem ainda está pensando — que é o que a bolinha existe pra desmentir.
    assert.equal(
      estadoDaBolinha({ status: 'trabalhando', turnoVivo: true, escrevendo: true }),
      'falando',
    );
  });

  it('vivo e sem turno é parado', () => {
    assert.equal(estadoDaBolinha(PARADO), 'parado');
  });
});
