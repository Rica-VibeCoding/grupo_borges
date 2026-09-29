import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Estado } from '../../lib/conversa/tipos.ts';

import { criaControladorDetector } from './controlador-detector.ts';
import { criaMicrofone, ganchosDoMicrofone, soltaOMicrofone, type Captura, type Microfone } from './microfone-da-conversa.ts';

type FaixaFalsa = { readyState: 'live' | 'ended'; enabled: boolean; stop(): void };
type CapturaFalsa = Captura & { faixa: FaixaFalsa };

function capturaFalsa(): CapturaFalsa {
  const faixa: FaixaFalsa = {
    readyState: 'live',
    enabled: true,
    stop() {
      this.readyState = 'ended';
    },
  };
  return { faixa, getAudioTracks: () => [faixa] };
}

// O ciclo do `@ricky0123/vad-web` 0.0.31 (`dist/real-time-vad.js`): o 1º `start` abre com
// `getStream`; `pause` entrega a captura a `pauseStream`; o `start` seguinte troca a captura
// pelo que `resumeStream(captura)` devolver; `destroy` pausa antes.
function micVadFalso(
  mic: Microfone<CapturaFalsa>,
  ganchos: ReturnType<typeof ganchosDoMicrofone<CapturaFalsa>>,
) {
  let captura: CapturaFalsa | null = null;
  let ouvindo = false;
  const vad = {
    async start() {
      if (captura === null) {
        captura = await mic.abre();
        ouvindo = true;
        return;
      }
      if (ouvindo) return;
      ouvindo = true;
      captura = await ganchos.resumeStream(captura);
    },
    async pause() {
      if (!ouvindo || captura === null) return;
      ouvindo = false;
      await ganchos.pauseStream(captura);
    },
    async destroy() {
      if (ouvindo) await vad.pause();
    },
  };
  return vad;
}

function conversa() {
  let pedidos = 0;
  const estado: { atual: Estado } = { atual: 'ouvindo' };
  const mic = criaMicrofone(async () => {
    pedidos += 1;
    return capturaFalsa();
  });
  const ganchos = ganchosDoMicrofone(mic, () => estado.atual);
  const novoVad = () => micVadFalso(mic, ganchos);
  const controlador = criaControladorDetector(novoVad(), async () => novoVad());
  const faixa = () => mic.atual()?.faixa ?? null;
  return { mic, estado, controlador, faixa, pedidos: () => pedidos };
}

describe('o microfone da conversa', () => {
  it('uma conversa de 3 voltas chama o getUserMedia uma vez só', async () => {
    const c = conversa();
    for (let volta = 0; volta < 3; volta += 1) {
      c.estado.atual = 'ouvindo';
      await c.controlador.liga();
      c.estado.atual = 'transcrevendo';
      await c.controlador.desliga();
    }
    assert.equal(c.pedidos(), 1);
  });

  it('na vez dele, surdo sem soltar: a mesma faixa, viva e calada', async () => {
    const c = conversa();
    for (let volta = 0; volta < 3; volta += 1) {
      c.estado.atual = 'ouvindo';
      await c.controlador.liga();
      assert.equal(c.faixa()?.enabled, true);
      c.estado.atual = 'transcrevendo';
      await c.controlador.desliga();
      assert.equal(c.faixa()?.readyState, 'live');
      assert.equal(c.faixa()?.enabled, false);
      assert.equal(c.mic.surdo(), true);
    }
    assert.equal(c.pedidos(), 1);
  });

  it('a faixa caiu na vez dele: voltando a ouvir, pede outra', async () => {
    const c = conversa();
    await c.controlador.liga();
    c.estado.atual = 'falando';
    await c.controlador.desliga();
    const velha = c.faixa();
    velha?.stop();
    c.estado.atual = 'ouvindo';
    await c.controlador.liga();
    assert.equal(c.pedidos(), 2);
    assert.notEqual(c.faixa(), velha);
    assert.equal(c.faixa()?.enabled, true);
  });

  it('parar com o detector ligado solta o microfone de verdade', async () => {
    const c = conversa();
    await c.controlador.liga();
    const faixa = c.faixa();
    c.estado.atual = 'parado';
    await c.controlador.desliga();
    assert.equal(faixa?.readyState, 'ended');
    assert.equal(c.mic.atual(), null);
  });

  it('parar com ele falando (detector já surdo) solta também, e a conversa nova pede um só', async () => {
    const c = conversa();
    await c.controlador.liga();
    c.estado.atual = 'falando';
    await c.controlador.desliga();
    const faixa = c.faixa();
    c.estado.atual = 'parado';
    c.mic.solta();
    assert.equal(faixa?.readyState, 'ended');
    c.estado.atual = 'ouvindo';
    await c.controlador.liga();
    await c.controlador.desliga();
    await c.controlador.liga();
    assert.equal(c.pedidos(), 2);
  });

  it('a escuta que emudeceu reabre: solta a velha antes de pedir outra', async () => {
    // O detector novo chama `getStream` de novo — o `abre` do mesmo microfone.
    const velhaNoPedido: string[] = [];
    let velha: FaixaFalsa | null = null;
    const mic = criaMicrofone(async () => {
      if (velha !== null) velhaNoPedido.push(velha.readyState);
      const nova = capturaFalsa();
      velha = nova.faixa;
      return nova;
    });
    await mic.abre();
    await mic.abre();
    assert.deepEqual(velhaNoPedido, ['ended']);
  });

  it('solta só com a conversa parada ou em erro', () => {
    assert.equal(soltaOMicrofone('parado'), true);
    assert.equal(soltaOMicrofone('erro'), true);
    for (const e of ['ouvindo', 'transcrevendo', 'esperandoZe', 'falando', 'interrompendo'] as const) {
      assert.equal(soltaOMicrofone(e), false, e);
    }
  });
});
