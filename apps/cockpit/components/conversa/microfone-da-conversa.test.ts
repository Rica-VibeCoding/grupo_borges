import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Estado } from '../../lib/conversa/tipos.ts';

import { criaControladorDetector } from './controlador-detector.ts';
import { criaMicrofone, ganchosDoMicrofone, soltaNaVezDele, soltaOMicrofone, type Captura, type Microfone } from './microfone-da-conversa.ts';

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

function conversa(soltaNaVez = false) {
  let pedidos = 0;
  const estado: { atual: Estado } = { atual: 'ouvindo' };
  const mic = criaMicrofone(async () => {
    pedidos += 1;
    return capturaFalsa();
  });
  const ganchos = ganchosDoMicrofone(mic, () => estado.atual, soltaNaVez);
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

  it('no iPhone, na vez dele o microfone se solta de verdade e volta a cada volta', async () => {
    const c = conversa(true);
    for (let volta = 0; volta < 3; volta += 1) {
      c.estado.atual = 'ouvindo';
      await c.controlador.liga();
      const faixa = c.faixa();
      assert.equal(faixa?.enabled, true);
      c.estado.atual = 'transcrevendo';
      await c.controlador.desliga();
      assert.equal(faixa?.readyState, 'ended');
      assert.equal(c.mic.atual(), null);
    }
    assert.equal(c.pedidos(), 3);
  });

  it('solta na vez dele só no iPhone e no iPad', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
    assert.equal(soltaNaVezDele({ userAgent: iphone, maxTouchPoints: 5 }), true);
    assert.equal(soltaNaVezDele({ userAgent: mac, maxTouchPoints: 5 }), true); // iPad se diz Mac
    assert.equal(soltaNaVezDele({ userAgent: mac, maxTouchPoints: 0 }), false);
    assert.equal(soltaNaVezDele({ userAgent: android, maxTouchPoints: 5 }), false);
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

  it('bloqueado não pede nem retoma captura', async () => {
    let pedidos = 0;
    let bloqueado = true;
    const mic = criaMicrofone(async () => { pedidos += 1; return capturaFalsa(); }, () => bloqueado);
    await assert.rejects(mic.abre(), { name: 'AbortError' });
    assert.equal(pedidos, 0);
    bloqueado = false;
    const captura = await mic.abre();
    mic.pausa(captura, false);
    bloqueado = true;
    await assert.rejects(mic.retoma(captura), { name: 'AbortError' });
    assert.equal(captura.faixa.readyState, 'ended');
    assert.equal(mic.atual(), null);
    assert.equal(pedidos, 1);
  });

  it('mudo durante a permissão para a faixa que chega tarde', async () => {
    let entrega!: (captura: CapturaFalsa) => void;
    let bloqueado = false;
    const mic = criaMicrofone(() => new Promise<CapturaFalsa>((resolve) => { entrega = resolve; }), () => bloqueado);
    const abertura = mic.abre();
    bloqueado = true;
    const captura = capturaFalsa();
    entrega(captura);
    await assert.rejects(abertura, { name: 'AbortError' });
    assert.equal(captura.faixa.readyState, 'ended');
    assert.equal(mic.atual(), null);
  });

  it('soltar invalida a abertura pendente mesmo se desmutar antes da resolução', async () => {
    let entrega!: (captura: CapturaFalsa) => void;
    const mic = criaMicrofone(() => new Promise<CapturaFalsa>((resolve) => { entrega = resolve; }));
    const abertura = mic.abre();
    mic.solta();
    const captura = capturaFalsa();
    entrega(captura);
    await assert.rejects(abertura, { name: 'AbortError' });
    assert.equal(captura.faixa.readyState, 'ended');
    assert.equal(mic.atual(), null);
  });

  it('abertura superada não troca nem solta a captura mais nova', async () => {
    const entregas: ((captura: CapturaFalsa) => void)[] = [];
    const mic = criaMicrofone(() => new Promise<CapturaFalsa>((resolve) => { entregas.push(resolve); }));
    const primeira = mic.abre();
    const segunda = mic.abre();
    const velha = capturaFalsa();
    const nova = capturaFalsa();
    entregas[1](nova);
    await segunda;
    entregas[0](velha);
    await assert.rejects(primeira, { name: 'AbortError' });
    assert.equal(velha.faixa.readyState, 'ended');
    assert.equal(nova.faixa.readyState, 'live');
    assert.equal(mic.atual(), nova);
  });

  it('pausar bloqueado solta em vez de guardar faixa viva', async () => {
    let bloqueado = false;
    const mic = criaMicrofone(async () => capturaFalsa(), () => bloqueado);
    const captura = await mic.abre();
    bloqueado = true;
    mic.pausa(captura, false);
    assert.equal(captura.faixa.readyState, 'ended');
    assert.equal(mic.atual(), null);
  });

  it('solta só com a conversa parada ou em erro', () => {
    assert.equal(soltaOMicrofone('parado'), true);
    assert.equal(soltaOMicrofone('erro'), true);
    for (const e of ['ouvindo', 'transcrevendo', 'esperandoZe', 'falando', 'interrompendo'] as const) {
      assert.equal(soltaOMicrofone(e), false, e);
    }
  });
});
