import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { MotivoDeErro } from '@/lib/conversa/tipos';

import { destinoDoErroDeEnvio, entregaFala } from './envio-da-conversa.ts';

const recusada = { status: 409, deliveryOutcome: 'refused', reason: 'sessao_ausente', safeToResend: true };
const incerta = { status: 409, deliveryOutcome: 'uncertain', reason: null, safeToResend: false };
const escoa = () => new Promise((resolve) => setImmediate(resolve));

it('entrega não provada segue como enviada: nem alarme, nem reenvio', () => {
  assert.deepEqual(destinoDoErroDeEnvio(incerta, 0), { tipo: 'enviada' });
});

it('recusa que afirma a não-entrega insiste com as esperas do cockpit e depois falha', () => {
  assert.deepEqual(destinoDoErroDeEnvio(recusada, 0), { tipo: 'retentar', atrasoMs: 1200 });
  assert.deepEqual(destinoDoErroDeEnvio(recusada, 1), { tipo: 'retentar', atrasoMs: 3000 });
  assert.deepEqual(destinoDoErroDeEnvio(recusada, 2), { tipo: 'falhou', motivo: 'envioFalhou' });
});

it('409 sem recibo continua ocupado; outro erro, a mensagem não saiu', () => {
  assert.deepEqual(destinoDoErroDeEnvio({ status: 409, detail: 'x' }, 0), { tipo: 'falhou', motivo: 'agenteOcupado' });
  assert.deepEqual(destinoDoErroDeEnvio({ status: 500 }, 0), { tipo: 'falhou', motivo: 'envioFalhou' });
  assert.deepEqual(destinoDoErroDeEnvio(new TypeError('rede'), 0), { tipo: 'falhou', motivo: 'envioFalhou' });
});

function simula(respostas: Array<'ok' | object>, vivo: () => boolean = () => true) {
  const log = { posts: 0, esperas: [] as number[], enviou: 0, falhas: [] as MotivoDeErro[] };
  const pendentes: Array<() => void> = [];
  entregaFala({
    posta: () => {
      const resposta = respostas[log.posts++];
      return resposta === 'ok' ? Promise.resolve({}) : Promise.reject(resposta);
    },
    vivo,
    enviou: () => { log.enviou += 1; },
    falhou: (motivo) => { log.falhas.push(motivo); },
    agenda: (acao, ms) => {
      log.esperas.push(ms);
      pendentes.push(acao);
    },
  });
  const avanca = async () => {
    await escoa();
    pendentes.shift()?.();
    await escoa();
  };
  return { log, avanca };
}

it('recusada duas vezes e depois aceita: um envio só, depois das duas esperas', async () => {
  const { log, avanca } = simula([recusada, recusada, 'ok']);
  await avanca();
  await avanca();
  assert.deepEqual({ ...log }, { posts: 3, esperas: [1200, 3000], enviou: 1, falhas: [] });
});

it('quem parou durante a espera não reenvia', async () => {
  let vivo = true;
  const { log, avanca } = simula([recusada, 'ok'], () => vivo);
  await escoa();
  vivo = false;
  await avanca();
  assert.deepEqual({ ...log }, { posts: 1, esperas: [1200], enviou: 0, falhas: [] });
});

it('entrega incerta vira enviada na primeira tentativa', async () => {
  const { log } = simula([incerta]);
  await escoa();
  assert.deepEqual({ ...log }, { posts: 1, esperas: [], enviou: 1, falhas: [] });
});

const paneOcupado = { status: 409, detail: 'agent_tmux_busy', deliveryOutcome: null, safeToResend: null };

it('pane preso pelo freio (agent_tmux_busy) é espera curta, não "agente ocupado"', () => {
  assert.deepEqual(destinoDoErroDeEnvio(paneOcupado, 0), { tipo: 'retentar', atrasoMs: 500 });
  assert.deepEqual(destinoDoErroDeEnvio(paneOcupado, 3), { tipo: 'retentar', atrasoMs: 1500 });
  assert.deepEqual(destinoDoErroDeEnvio(paneOcupado, 4), { tipo: 'falhou', motivo: 'agenteOcupado' });
});

it('pane preso duas vezes e depois livre: a fala entra sem erro', async () => {
  const { log, avanca } = simula([paneOcupado, paneOcupado, 'ok']);
  await avanca();
  await avanca();
  assert.deepEqual({ ...log }, { posts: 3, esperas: [500, 1000], enviou: 1, falhas: [] });
});
