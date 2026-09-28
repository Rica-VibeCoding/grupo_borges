import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INTERVALO_DE_REENVIO_MS,
  TETO_DA_ESPERA_MS,
  TEXTO_ESPERANDO,
  TEXTO_ESPERANDO_LONGO,
  TEXTO_TROCANDO,
  andamentoDoChip,
  classificaErroDaTroca,
  esperaVenceu,
  jaEstava,
  podeReenviar,
  proximaEspera,
  type EsperaDaTroca,
} from './troca-em-espera.ts';

const sonnet = { tipo: 'modelo', valor: 'sonnet' } as const;
const espera: EsperaDaTroca = { pedido: sonnet, desdeMs: 1_000 };

describe('classificaErroDaTroca', () => {
  it('409 agent_busy_wait é esperar — nunca pedir confirmação', () => {
    assert.equal(classificaErroDaTroca({ status: 409, detail: 'agent_busy_wait' }), 'esperar');
  });
  it('409 pergunta_motor_aberta aponta a barra', () => {
    assert.equal(classificaErroDaTroca({ status: 409, detail: 'pergunta_motor_aberta' }), 'pergunta-aberta');
  });
  it('o código antigo e qualquer outro erro são falha', () => {
    assert.equal(classificaErroDaTroca({ status: 409, detail: 'agent_busy_confirm_required' }), 'falhou');
    assert.equal(classificaErroDaTroca({ status: 500, detail: 'agent_busy_wait' }), 'falhou');
    assert.equal(classificaErroDaTroca(new Error('rede')), 'falhou');
    assert.equal(classificaErroDaTroca(null), 'falhou');
  });
});

describe('jaEstava', () => {
  it('só o true explícito é sucesso silencioso', () => {
    assert.equal(jaEstava({ ja_estava: true }), true);
    assert.equal(jaEstava({ ja_estava: false }), false);
    assert.equal(jaEstava({ ja_estava: null }), false);
    assert.equal(jaEstava({}), false);
  });
});

describe('podeReenviar', () => {
  const base = { espera, emVoo: false, status: 'ocioso', ultimaTentativaMs: 0, agoraMs: INTERVALO_DE_REENVIO_MS };
  it('reenvia quando o agente fica ocioso e o intervalo passou', () => {
    assert.equal(podeReenviar(base), true);
  });
  it('não reenvia com o agente trabalhando, aguardando ou offline', () => {
    for (const status of ['trabalhando', 'aguardando', 'offline', undefined]) {
      assert.equal(podeReenviar({ ...base, status }), false, String(status));
    }
  });
  it('não reenvia sem espera, com envio em voo, ou antes do intervalo', () => {
    assert.equal(podeReenviar({ ...base, espera: null }), false);
    assert.equal(podeReenviar({ ...base, emVoo: true }), false);
    assert.equal(podeReenviar({ ...base, agoraMs: INTERVALO_DE_REENVIO_MS - 1 }), false);
  });
});

describe('proximaEspera', () => {
  it('ocupado arma a espera com o relógio de agora', () => {
    assert.deepEqual(proximaEspera(null, sonnet, 'esperar', 5_000), { pedido: sonnet, desdeMs: 5_000 });
  });
  it('reenvio do mesmo pedido que volta ocupado não zera o teto', () => {
    assert.equal(proximaEspera(espera, { ...sonnet }, 'esperar', 99_000), espera);
  });
  it('pedido novo começa espera nova', () => {
    const haiku = { tipo: 'modelo', valor: 'haiku' } as const;
    assert.deepEqual(proximaEspera(espera, haiku, 'esperar', 7_000), { pedido: haiku, desdeMs: 7_000 });
  });
  it('feito ou falhou encerram a espera', () => {
    assert.equal(proximaEspera(espera, sonnet, 'feito', 2_000), null);
    assert.equal(proximaEspera(espera, sonnet, 'falhou', 2_000), null);
  });
});

describe('esperaVenceu', () => {
  it('desiste no teto, não antes', () => {
    assert.equal(esperaVenceu(espera, espera.desdeMs + TETO_DA_ESPERA_MS - 1), false);
    assert.equal(esperaVenceu(espera, espera.desdeMs + TETO_DA_ESPERA_MS), true);
  });
});

describe('andamentoDoChip', () => {
  it('trocando ganha de esperando, e nada quando não há troca', () => {
    assert.equal(andamentoDoChip({ espera, emVoo: true }), TEXTO_TROCANDO);
    assert.equal(andamentoDoChip({ espera, emVoo: false }), TEXTO_ESPERANDO);
    assert.equal(andamentoDoChip({ espera: null, emVoo: false }), null);
  });
  it('no chip cabe uma palavra; a frase inteira é do rótulo acessível', () => {
    assert.equal(andamentoDoChip({ espera, emVoo: false }, true), TEXTO_ESPERANDO_LONGO);
    assert.ok(TEXTO_ESPERANDO.length <= 10);
  });
});
