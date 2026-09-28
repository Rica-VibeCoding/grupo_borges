/**
 * O painel guardado por agente (28/09) — a semente que faz o chip do motor
 * nascer com dropdown. A régua é a armadilha 3 do Pavan: o cache NÃO pode
 * ressuscitar o motor velho durante o "trocando…" nem depois do teto que o
 * ae5c41b solta. Aqui a store da espera é a de verdade (`criaEsperasDeTroca`),
 * ligada ao cache do mesmo jeito que `esperas-de-troca-cliente.ts` liga.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import { criaEsperasDeTroca } from './esperas-de-troca.ts';
import { aplicarMotor, esquecerTudo } from './operacao-de-motor.ts';
import {
  definirTrocaEmCurso, esquecerPainel, painelGuardado, preaquecePainel, publicarPainel, sincronizarPainel,
  tomarPreaquecimento,
} from './sincronizacao-painel.ts';
import { TETO_DA_ESPERA_MS, type DesfechoDoPedido, type PedidoDeTroca } from './troca-em-espera.ts';

const painel = (slug: string, modelo: string) =>
  ({ slug, model: { value: modelo, allowed: ['sonnet', 'haiku'] }, effort: { value: 'high', allowed: [] } }) as unknown as AgentPainelResponse;
const modeloGuardado = (slug: string) => painelGuardado(slug)?.model?.value ?? null;
const haiku: PedidoDeTroca = { tipo: 'modelo', valor: 'haiku' };
const drenar = () => new Promise((resolve) => setImmediate(resolve));

/** Uma leitura do `/painel` que só volta quando o teste manda. */
function leituraPresa() {
  let soltar!: (p: AgentPainelResponse) => void;
  const buscar = () => new Promise<AgentPainelResponse>((resolve) => { soltar = resolve; });
  return { buscar, soltar: (p: AgentPainelResponse) => soltar(p) };
}

/** A store da espera ligada ao cache como no cliente: todo envio esquece, e
 *  esperando/trocando o cache não vale. */
function montarEspera(executar: (slug: string, pedido: PedidoDeTroca) => Promise<DesfechoDoPedido>) {
  let t = 0;
  const esperas = criaEsperasDeTroca({
    executar: (slug, pedido) => { esquecerPainel(slug); return executar(slug, pedido); },
    agora: () => t,
    agendar: () => 1 as unknown as ReturnType<typeof setInterval>,
    cancelar: () => {},
    intervaloMs: 3_000,
  });
  definirTrocaEmCurso((slug) => {
    const e = esperas.ler(slug);
    return Boolean(e.espera || e.voando);
  });
  return { esperas, avancar: (ms: number) => { t += ms; } };
}

beforeEach(() => {
  definirTrocaEmCurso(() => false);
  esquecerTudo();
});

describe('painel guardado — a semente do chip do motor', () => {
  it('a leitura do chip e a publicação guardam; o chip que montar depois nasce com ela', async () => {
    const parar = sincronizarPainel('g1', async () => painel('g1', 'sonnet'), () => {}, () => {});
    await drenar();
    parar();
    assert.equal(modeloGuardado('g1'), 'sonnet');
    publicarPainel(painel('g1', 'haiku'), { fundo: true });
    assert.equal(modeloGuardado('g1'), 'haiku');
    assert.equal(painelGuardado('outro'), undefined, 'por slug: nada vaza para outro agente');
  });

  it('leitura que saiu ANTES de um esquecimento não guarda o que trouxe', async () => {
    const lenta = leituraPresa();
    const parar = sincronizarPainel('g2', lenta.buscar, () => {}, () => {});
    esquecerPainel('g2');
    lenta.soltar(painel('g2', 'sonnet'));
    await drenar();
    parar();
    assert.equal(painelGuardado('g2'), undefined);
  });

  it('armadilha 3 — "trocando…": com o envio em voo o cache não semeia o motor velho, nem guarda leitura velha', async () => {
    publicarPainel(painel('g3', 'sonnet'));
    let soltarEnvio!: (d: DesfechoDoPedido) => void;
    const m = montarEspera(() => new Promise((resolve) => { soltarEnvio = resolve; }));
    const lenta = leituraPresa();
    const parar = sincronizarPainel('g3', lenta.buscar, () => {}, () => {});
    const voo = m.esperas.pedir('g3', haiku);
    assert.deepEqual(m.esperas.ler('g3').voando, haiku, 'trocando…');
    assert.equal(painelGuardado('g3'), undefined, 'o chip que montar agora não nasce no sonnet');
    // A leitura que já estava na rede chega com o motor de antes.
    lenta.soltar(painel('g3', 'sonnet'));
    await drenar();
    publicarPainel(painel('g3', 'sonnet'), { fundo: true });
    assert.equal(painelGuardado('g3'), undefined);
    soltarEnvio('feito');
    await voo;
    assert.equal(painelGuardado('g3'), undefined, 'troca feita: o sonnet não volta');
    // O executor republica o painel lido depois da troca: esse vale.
    publicarPainel(painel('g3', 'haiku'), { fundo: true });
    assert.equal(modeloGuardado('g3'), 'haiku');
    parar();
  });

  it('armadilha 3 — teto do ae5c41b: a espera vence com o reenvio em voo e o cache NÃO volta ao motor velho', async () => {
    publicarPainel(painel('g4', 'sonnet'));
    let n = 0;
    const m = montarEspera(() => (++n === 1 ? Promise.resolve('esperar') : new Promise(() => {})));
    await m.esperas.pedir('g4', haiku);
    assert.ok(m.esperas.ler('g4').espera, 'esperando o agente terminar');
    assert.equal(painelGuardado('g4'), undefined);
    // Leitura durante a espera (bloco de ações, barra do chat): não guarda.
    publicarPainel(painel('g4', 'sonnet'));
    const lenta = leituraPresa();
    const parar = sincronizarPainel('g4', lenta.buscar, () => {}, () => {});
    m.esperas.informarStatus('g4', 'ocioso');
    m.avancar(3_000);
    m.esperas.passo();
    assert.deepEqual(m.esperas.ler('g4').voando, haiku, 'o reenvio está em voo');
    m.avancar(TETO_DA_ESPERA_MS);
    m.esperas.passo();
    assert.equal(m.esperas.ler('g4').voando, null, 'o teto soltou o "trocando…"');
    assert.equal(m.esperas.ler('g4').espera, null);
    // Leitura iniciada no meio da troca chega depois do teto: não guarda.
    lenta.soltar(painel('g4', 'sonnet'));
    await drenar();
    parar();
    assert.equal(painelGuardado('g4'), undefined, 'depois do teto o chip nasce sem semente e lê de novo');
    // A leitura seguinte — já fora da troca — volta a valer.
    const parar2 = sincronizarPainel('g4', async () => painel('g4', 'haiku'), () => {}, () => {});
    await drenar();
    parar2();
    assert.equal(modeloGuardado('g4'), 'haiku');
  });

  it('cancelar a espera também não deixa o motor velho guardado', async () => {
    publicarPainel(painel('g5', 'sonnet'));
    const m = montarEspera(async () => 'esperar');
    await m.esperas.pedir('g5', haiku);
    m.esperas.cancelar('g5');
    assert.equal(painelGuardado('g5'), undefined);
  });

  it('religar em curso: não semeia nem guarda; o disparo esquece o que havia', async () => {
    publicarPainel(painel('g6', 'sonnet'));
    const rede = {
      aplicar: () => { esquecerPainel('g6'); return new Promise(() => {}); },
      reler: () => {},
      lePainel: async () => painel('g6', 'sonnet'),
    };
    void aplicarMotor('g6', rede);
    assert.equal(painelGuardado('g6'), undefined);
    publicarPainel(painel('g6', 'sonnet'));
    assert.equal(painelGuardado('g6'), undefined, 'leitura no meio do boot não entra');
    esquecerTudo();
    assert.equal(painelGuardado('g6'), undefined, 'operação encerrada: o motor de antes do religar não volta');
  });

  it('preaquecimento no toque da tropa: guarda o painel e o chip toma a MESMA leitura, sem pedir outra', async () => {
    let pedidos = 0;
    const ler = async (slug: string) => { pedidos += 1; return painel(slug, 'sonnet'); };
    preaquecePainel('g7', ler);
    preaquecePainel('g7', ler);
    assert.equal(pedidos, 1, 'dois toques seguidos, uma leitura');
    await drenar();
    assert.equal(modeloGuardado('g7'), 'sonnet');
    const tomada = tomarPreaquecimento('g7');
    assert.ok(tomada);
    assert.equal((await tomada).model?.value, 'sonnet');
    assert.equal(tomarPreaquecimento('g7'), null, 'uma vez só');
    assert.equal(pedidos, 1);
  });

  it('preaquecimento velho (passou do prazo, ou houve troca no meio) não é tomado', async () => {
    let t = 0;
    const ler = async (slug: string) => painel(slug, 'sonnet');
    preaquecePainel('g8', ler, () => t);
    t = 3_000;
    assert.equal(tomarPreaquecimento('g8', () => t), null, 'passou do prazo');
    preaquecePainel('g9', ler);
    esquecerPainel('g9');
    await drenar();
    assert.equal(tomarPreaquecimento('g9'), null, 'troca depois do toque: a leitura descreve o motor de antes');
    assert.equal(painelGuardado('g9'), undefined);
  });
});
