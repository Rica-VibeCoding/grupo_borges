import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ATRASOS_DA_RETENTATIVA_MS,
  atrasoDaRetentativa,
  ehRecusaTransitoria,
} from './recusa-transitoria.ts';

test('409 que o back afirma não ter entregue é transitório', () => {
  for (const detail of ['agent_pane_unavailable', 'shared_turn_in_flight']) {
    assert.equal(ehRecusaTransitoria({ status: 409, detail }), true, detail);
  }
});

// O `AgentInputError` nasce com o mesmo texto em `detail` e em `message`, mas
// erro montado à mão — em teste, ou por um caminho mais velho — pode ter só a
// mensagem. Perder o caso por causa do campo seria transformar recuperação
// automática em vermelho na tela do Rica.
test('a mensagem serve de fallback quando não há detail', () => {
  const erro = Object.assign(new Error('agent_pane_unavailable'), { status: 409 });
  assert.equal(ehRecusaTransitoria(erro), true);
});

test('desfecho incerto estruturado não recebe retentativa', () => {
  assert.equal(
    ehRecusaTransitoria({
      status: 409,
      detail: 'agent_pane_unavailable',
      deliveryOutcome: 'uncertain',
      safeToResend: false,
    }),
    false,
  );
});

test('recusa estruturada e segura mantém a retentativa', () => {
  assert.equal(
    ehRecusaTransitoria({
      status: 409,
      detail: 'agent_pane_unavailable',
      deliveryOutcome: 'refused',
      safeToResend: true,
    }),
    true,
  );
});

// A regra da máquina é não repetir entrega que PODE ter acontecido. Um 409 sem
// detalhe conhecido não diz se o texto entrou, então continua sendo falha
// terminal — retentar ali é a duplicata que a máquina inteira existe para
// impedir.
test('409 de motivo desconhecido NÃO é transitório', () => {
  assert.equal(ehRecusaTransitoria({ status: 409, detail: 'algo_novo' }), false);
  assert.equal(ehRecusaTransitoria({ status: 409 }), false);
});

test('outros status não são transitórios, mesmo com detalhe conhecido', () => {
  for (const status of [422, 500, 404]) {
    assert.equal(
      ehRecusaTransitoria({ status, detail: 'agent_pane_unavailable' }),
      false,
      String(status),
    );
  }
});

test('valor que não é objeto não quebra a checagem', () => {
  for (const erro of [null, undefined, 'agent_pane_unavailable', 409]) {
    assert.equal(ehRecusaTransitoria(erro), false);
  }
});

test('a espera acaba — a última tentativa devolve null', () => {
  assert.equal(atrasoDaRetentativa(0), ATRASOS_DA_RETENTATIVA_MS[0]);
  assert.equal(atrasoDaRetentativa(1), ATRASOS_DA_RETENTATIVA_MS[1]);
  assert.equal(atrasoDaRetentativa(ATRASOS_DA_RETENTATIVA_MS.length), null);
});

// A soma é o que separa "recuperação" de "tela devendo resposta": o teto de
// atenção do NN/g é 10 s, e as esperas somadas precisam caber nele COM os POSTs
// entre elas. Se alguém dobrar um atraso sem olhar o total, este teste avisa.
test('as esperas somadas cabem no teto de atenção de 10 s', () => {
  const soma = ATRASOS_DA_RETENTATIVA_MS.reduce((total, ms) => total + ms, 0);
  assert.ok(soma < 5_000, `esperas somam ${soma} ms`);
});
