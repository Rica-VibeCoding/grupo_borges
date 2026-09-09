import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';
import { publicarPainel, sincronizarPainel } from './sincronizacao-painel.ts';

const painel = (slug: string, familia = 'kimi') => ({
  slug, motor: { familia }, model: null, effort: { value: 'high' },
}) as AgentPainelResponse;

it('publicação entrega painel inteiro só ao mesmo slug e supera leitura antiga', async () => {
  let resolver!: (valor: AgentPainelResponse) => void;
  let signal!: AbortSignal;
  const recebidos: AgentPainelResponse[] = [];
  const parar = sincronizarPainel('canarinho', (_, sinal) => {
    signal = sinal;
    return new Promise((resolve) => { resolver = resolve; });
  }, (novo) => recebidos.push(novo), () => assert.fail('leitura cancelada não falha'));
  publicarPainel(painel('daniel'));
  assert.equal(recebidos.length, 0);
  const novo = painel('canarinho');
  publicarPainel(novo);
  assert.equal(signal.aborted, true);
  resolver(painel('canarinho', 'anthropic'));
  await Promise.resolve();
  assert.deepEqual(recebidos, [novo]);
  parar();
  publicarPainel(novo);
  assert.equal(recebidos.length, 1);
});

it('desmontagem ignora sucesso e falha tardios', async () => {
  for (const falha of [false, true]) {
    let concluir!: () => void;
    const parar = sincronizarPainel('tara', () => new Promise((resolve, reject) => {
      concluir = () => falha ? reject(new Error('rede')) : resolve(painel('tara'));
    }), () => assert.fail('recebeu após desmontar'), () => assert.fail('falhou após desmontar'));
    parar();
    concluir();
    await new Promise((resolve) => setImmediate(resolve));
  }
});

it('leitura inicial não aceita painel de outro slug', async () => {
  const recebidos: AgentPainelResponse[] = [];
  const parar = sincronizarPainel('tara', async () => painel('daniel'),
    (novo) => recebidos.push(novo), () => {});
  await Promise.resolve();
  parar();
  assert.deepEqual(recebidos, []);
});
