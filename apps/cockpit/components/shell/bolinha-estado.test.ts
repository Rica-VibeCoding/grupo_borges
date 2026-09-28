import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estadoDaBolinha, type EntradaDaBolinha } from './bolinha-estado.ts';

/** O repouso: agente vivo, sem turno e sem escrita. Cada teste muda só o que
 *  está sendo provado. */
const PARADO: EntradaDaBolinha = { status: 'ocioso', turnoVivo: false, produzindo: false };

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
      estadoDaBolinha({ status: 'aguardando', turnoVivo: true, produzindo: true }),
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

  it('executar é caso particular de estar em turno, e ganha do pensar', () => {
    // Sem esta precedência a cara não muda: o turno é quase todo ferramenta
    // rodando, e foi exatamente esse o defeito que o Rica filmou em 17/08.
    assert.equal(
      estadoDaBolinha({ status: 'trabalhando', turnoVivo: true, produzindo: true }),
      'executando',
    );
  });

  it('vivo e sem turno é parado', () => {
    assert.equal(estadoDaBolinha(PARADO), 'parado');
  });

  it('parado com texto na caixa escuta', () => {
    assert.equal(estadoDaBolinha({ ...PARADO, ouvindo: true }), 'ouvindo');
  });

  it('escutar não esconde trabalho nem chamado', () => {
    // O rascunho é do Rica; o que o agente está fazendo continua sendo a
    // notícia — senão digitar apagaria "pensando" e "esperando você".
    assert.equal(estadoDaBolinha({ ...PARADO, turnoVivo: true, ouvindo: true }), 'pensando');
    assert.equal(
      estadoDaBolinha({ status: 'trabalhando', turnoVivo: true, produzindo: true, ouvindo: true }),
      'executando',
    );
    assert.equal(estadoDaBolinha({ ...PARADO, status: 'aguardando', ouvindo: true }), 'atencao');
    assert.equal(estadoDaBolinha({ ...PARADO, status: 'offline', ouvindo: true }), 'offline');
  });
});
