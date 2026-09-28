import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  TEXTO_ENTREGA_FALHOU,
  TEXTO_ESFORCO_PENDENTE,
  TEXTO_MODELO_FALHOU,
  TEXTO_PERGUNTA_ABERTA,
  criaExecutorDeTroca,
  type RedeDaTroca,
} from './executor-de-troca.ts';

const painel = (modelo: string, esforco = 'high') =>
  ({ slug: 'a', model: { value: modelo }, effort: { value: esforco } }) as unknown as AgentPainelResponse;

function rede(sobrescrever: Partial<RedeDaTroca> = {}) {
  const publicados: AgentPainelResponse[] = [];
  const fechados: string[] = [];
  const timers: Array<() => void> = [];
  let atual = painel('sonnet');
  const r: RedeDaTroca = {
    postModel: async (_slug, valor) => {
      atual = painel(valor);
      return { tmux_delivered: true, state_persisted: true, confirmed: true, model: valor, runtime_switch: true };
    },
    patchEffort: async () => { throw new Error('não usado'); },
    lePainel: async () => atual,
    publicar: (p) => publicados.push(p),
    fecharSePronto: (slug) => { fechados.push(slug); },
    convergencia: {
      agendar: (cb) => { timers.push(cb); return timers.length as unknown as ReturnType<typeof setTimeout>; },
      cancelar: (id) => { timers[(id as unknown as number) - 1] = () => {}; },
    },
    ...sobrescrever,
  };
  return { r, publicados, fechados, timers, mudar: (p: AgentPainelResponse) => { atual = p; } };
}

const drenar = () => new Promise((resolve) => setImmediate(resolve));
const semRecado = (t: string) => assert.fail(`recado inesperado: ${t}`);

describe('executor da troca — o desfecho chega sem depender de chip montado', () => {
  it('sucesso PUBLICA o painel novo (o chip montado depois lê o modelo novo)', async () => {
    const m = rede();
    const executar = criaExecutorDeTroca(m.r);
    assert.equal(await executar('a', { tipo: 'modelo', valor: 'haiku' }, semRecado), 'feito');
    await drenar();
    assert.equal(m.publicados.at(-1)?.model?.value, 'haiku');
    assert.deepEqual(m.fechados, ['a']);
  });

  it('ja_estava é sucesso silencioso, mesmo com tmux_delivered false', async () => {
    const m = rede({ postModel: async (_s, v) => ({ tmux_delivered: false, state_persisted: true, confirmed: true, model: v, runtime_switch: true, ja_estava: true }) });
    assert.equal(await criaExecutorDeTroca(m.r)('a', { tipo: 'modelo', valor: 'sonnet' }, semRecado), 'feito');
  });

  it('409 agent_busy_wait é esperar, sem recado', async () => {
    const m = rede({ postModel: async () => { throw Object.assign(new Error('x'), { status: 409, detail: 'agent_busy_wait' }); } });
    assert.equal(await criaExecutorDeTroca(m.r)('a', { tipo: 'modelo', valor: 'haiku' }, semRecado), 'esperar');
  });

  it('falha vira RECADO (guardado pela store), não aviso num chip morto', async () => {
    const recados: string[] = [];
    const guardar = (t: string) => recados.push(t);
    const m = rede({ postModel: async () => { throw Object.assign(new Error('x'), { status: 500, detail: 'boom' }); } });
    assert.equal(await criaExecutorDeTroca(m.r)('a', { tipo: 'modelo', valor: 'haiku' }, guardar), 'falhou');
    const aberta = rede({ postModel: async () => { throw Object.assign(new Error('x'), { status: 409, detail: 'pergunta_motor_aberta' }); } });
    await criaExecutorDeTroca(aberta.r)('a', { tipo: 'modelo', valor: 'haiku' }, guardar);
    const perdida = rede({ postModel: async (_s, v) => ({ tmux_delivered: false, state_persisted: false, confirmed: false, model: v, runtime_switch: true }) });
    await criaExecutorDeTroca(perdida.r)('a', { tipo: 'modelo', valor: 'haiku' }, guardar);
    assert.deepEqual(recados, [TEXTO_MODELO_FALHOU, TEXTO_PERGUNTA_ABERTA, TEXTO_ENTREGA_FALHOU]);
  });

  it('esforço pendente: a convergência mora no executor, publica ao convergir e para na troca seguinte', async () => {
    const recados: string[] = [];
    const m = rede({
      patchEffort: async (_s, v) => ({ slug: 'a', effort: v, source: 'x', session_may_diverge: true, written: true, tmux_delivered: true, confirmed: false }),
    });
    const executar = criaExecutorDeTroca(m.r);
    assert.equal(await executar('a', { tipo: 'esforco', valor: 'low' }, (t) => recados.push(t)), 'feito');
    assert.deepEqual(recados, [TEXTO_ESFORCO_PENDENTE]);
    m.mudar(painel('sonnet', 'low'));
    m.timers.at(-1)?.();
    await drenar();
    assert.equal(m.publicados.at(-1)?.effort.value, 'low', 'convergiu e publicou');

    // Nova pendência, e uma troca de modelo no meio: a convergência velha para.
    await executar('a', { tipo: 'esforco', valor: 'max' }, () => {});
    const armados = m.timers.length;
    await executar('a', { tipo: 'modelo', valor: 'haiku' }, semRecado);
    m.mudar(painel('haiku', 'max'));
    const antes = m.publicados.length;
    m.timers[armados - 1]?.();
    await drenar();
    await drenar();
    assert.ok(m.publicados.every((p, i) => i < antes || p.effort.value !== 'max' || p.model?.value === 'haiku'));
    assert.equal(m.timers.length, armados, 'nenhum passo novo da convergência parada');
  });
});
