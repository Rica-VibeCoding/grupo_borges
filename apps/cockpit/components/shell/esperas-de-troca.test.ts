import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TEXTO_DESISTIU, criaEsperasDeTroca } from './esperas-de-troca.ts';
import { TETO_DA_ESPERA_MS, type DesfechoDoPedido, type PedidoDeTroca } from './troca-em-espera.ts';

const haiku: PedidoDeTroca = { tipo: 'modelo', valor: 'haiku' };

function montar(respostas: DesfechoDoPedido[]) {
  let t = 0;
  const armados: number[] = [];
  let cancelados = 0;
  const esperas = criaEsperasDeTroca({
    agora: () => t,
    agendar: () => { armados.push(1); return 1 as unknown as ReturnType<typeof setInterval>; },
    cancelar: () => { cancelados += 1; },
    intervaloMs: 3_000,
  });
  const envios: PedidoDeTroca[] = [];
  const executar = async (_slug: string, pedido: PedidoDeTroca) => {
    envios.push(pedido);
    return respostas.shift() ?? 'feito';
  };
  return {
    esperas, envios, executar,
    avancar(ms: number) { t += ms; },
    relogio: () => ({ armados: armados.length, cancelados }),
  };
}

const drenar = () => new Promise((r) => setImmediate(r));

describe('esperas de troca — a espera sobrevive à troca de agente', () => {
  it('o chip de A desmonta (Rica abre o B) e o reenvio acontece assim mesmo', async () => {
    const m = montar(['esperar', 'feito']);
    m.esperas.definirExecutor(m.executar);
    m.esperas.informarStatus('a', 'trabalhando');
    await m.esperas.pedir('a', haiku);
    assert.deepEqual(m.esperas.ler('a').espera?.pedido, haiku);

    // Nada de chip montado para A daqui em diante: só a frota informa status.
    m.esperas.informarStatus('b', 'ocioso');
    m.avancar(3_000);
    m.esperas.passo();
    await drenar();
    assert.equal(m.envios.length, 1, 'com A trabalhando, não reenvia');

    m.esperas.informarStatus('a', 'ocioso');
    m.esperas.passo();
    await drenar();
    assert.equal(m.envios.length, 2, 'A ficou ocioso: reenviou sem o chip na tela');
    // De volta ao A: o chip lê a espera encerrada — a troca aconteceu.
    assert.equal(m.esperas.ler('a').espera, null);
    assert.equal(m.esperas.ler('a').voando, null);
  });

  it('voltar ao A com a troca ainda esperando lê "esperando" da store', async () => {
    const m = montar(['esperar']);
    m.esperas.definirExecutor(m.executar);
    await m.esperas.pedir('a', haiku);
    const leitura = m.esperas.ler('a');
    assert.deepEqual(leitura.espera?.pedido, haiku);
    assert.equal(m.esperas.ler('a'), leitura, 'leitura estável entre avisos');
    assert.deepEqual(m.esperas.ler('b').espera, null, 'uma espera por slug');
  });

  it('cancelar encerra a espera, e envio em voo não a rearma', async () => {
    let soltar: (d: DesfechoDoPedido) => void = () => {};
    const m = montar([]);
    m.esperas.definirExecutor(() => new Promise((r) => { soltar = r; }));
    const voo = m.esperas.pedir('a', haiku);
    assert.deepEqual(m.esperas.ler('a').voando, haiku);
    m.esperas.cancelar('a');
    soltar('esperar');
    await voo;
    assert.equal(m.esperas.ler('a').espera, null);
    assert.equal(m.esperas.ler('a').voando, null);
  });

  it('escolha nova substitui a anterior: uma de cada vez', async () => {
    const m = montar(['esperar', 'esperar']);
    m.esperas.definirExecutor(m.executar);
    await m.esperas.pedir('a', haiku);
    const sonnet: PedidoDeTroca = { tipo: 'modelo', valor: 'sonnet' };
    await m.esperas.pedir('a', sonnet);
    assert.deepEqual(m.esperas.ler('a').espera?.pedido, sonnet);
  });

  it('teto de 15 min: desiste, marca a desistência e desliga o relógio', async () => {
    const m = montar(['esperar']);
    m.esperas.definirExecutor(m.executar);
    m.esperas.informarStatus('a', 'trabalhando');
    await m.esperas.pedir('a', haiku);
    assert.equal(m.relogio().armados, 1);
    m.avancar(TETO_DA_ESPERA_MS);
    m.esperas.passo();
    assert.equal(m.esperas.ler('a').espera, null);
    assert.equal(m.esperas.ler('a').recado, TEXTO_DESISTIU);
    assert.equal(m.relogio().cancelados, 1);
    m.esperas.esquecerRecado('a');
    assert.equal(m.esperas.ler('a').recado, null);
  });

  it('executor que lança conta como falha e encerra a espera', async () => {
    const m = montar([]);
    m.esperas.definirExecutor(async () => { throw new Error('rede'); });
    await m.esperas.pedir('a', haiku);
    assert.equal(m.esperas.ler('a').espera, null);
  });

  it('teto vencido com o reenvio em voo solta o "trocando…" (code-review 28/09)', async () => {
    let n = 0;
    const m = montar([]);
    m.esperas.definirExecutor(() => (++n === 1 ? Promise.resolve('esperar') : new Promise(() => {})));
    await m.esperas.pedir('a', haiku);
    m.esperas.informarStatus('a', 'ocioso');
    m.avancar(3_000);
    m.esperas.passo();
    assert.deepEqual(m.esperas.ler('a').voando, haiku, 'o reenvio está em voo');
    m.avancar(TETO_DA_ESPERA_MS);
    m.esperas.passo();
    assert.equal(m.esperas.ler('a').voando, null);
    assert.equal(m.esperas.ler('a').espera, null);
    assert.equal(m.esperas.ler('a').recado, TEXTO_DESISTIU);
  });

  it('a falha de um reenvio com o chip desmontado fica guardada para o chip que montar', async () => {
    const m = montar([]);
    let n = 0;
    m.esperas.definirExecutor(async (_slug, _pedido, recado) => {
      if (++n === 1) return 'esperar';
      recado('Não foi possível trocar o modelo.');
      return 'falhou';
    });
    await m.esperas.pedir('a', haiku);
    m.esperas.informarStatus('a', 'ocioso');
    m.avancar(3_000);
    m.esperas.passo();
    await drenar();
    assert.equal(m.esperas.ler('a').recado, 'Não foi possível trocar o modelo.');
    assert.equal(m.esperas.ler('a').espera, null);
  });

  it('recado de envio superado (cancelado) não vira notícia', async () => {
    const m = montar([]);
    let soltar: () => void = () => {};
    m.esperas.definirExecutor((_slug, _pedido, recado) => new Promise((r) => {
      soltar = () => { recado('velho'); r('falhou'); };
    }));
    const voo = m.esperas.pedir('a', haiku);
    m.esperas.cancelar('a');
    soltar();
    await voo;
    assert.equal(m.esperas.ler('a').recado, null);
  });
});
