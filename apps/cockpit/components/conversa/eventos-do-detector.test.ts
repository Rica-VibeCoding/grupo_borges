import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { Evento } from '../../lib/conversa/tipos.ts';
import { eventosDoDetector } from './eventos-do-detector.ts';

function monta(falaVale: () => boolean) {
  const eventos: string[] = [];
  const nivelRef = { current: 0 };
  const cb = eventosDoDetector({
    podeOuvir: () => true,
    falaVale,
    falaRef: { current: null },
    eventoRef: { current: (e: Evento) => eventos.push(e.tipo) },
    ultimoQuadroRef: { current: 0 },
    nivelRef,
    setFalaDetectada: () => {},
  });
  return { cb, eventos, nivelRef };
}

const alto = new Float32Array(512).fill(0.3);

it('a fala que começa com a frase de apoio tocando não vira fala — nem o fim dela depois que a frase acaba', () => {
  let tocando = true;
  const { cb, eventos, nivelRef } = monta(() => !tocando);
  cb.onSpeechStart();
  cb.onFrameProcessed(null, alto);
  assert.equal(nivelRef.current, 0, 'o eco não mexe na esfera');
  tocando = false;
  cb.onSpeechRealStart();
  cb.onSpeechEnd(new Float32Array(0));
  assert.deepEqual(eventos, []);
});

it('a próxima fala, com a frase já calada, vale normal', () => {
  let tocando = true;
  const { cb, eventos } = monta(() => !tocando);
  cb.onSpeechStart();
  tocando = false;
  cb.onVADMisfire();
  cb.onSpeechStart();
  cb.onSpeechEnd(new Float32Array(0));
  assert.deepEqual(eventos, ['falaIniciou', 'falaTerminou']);
});

it('os quadros seguem contando para a vigia mesmo com a fala ignorada', () => {
  const ultimo = { current: 0 };
  const cb = eventosDoDetector({
    podeOuvir: () => true,
    falaVale: () => false,
    falaRef: { current: null },
    eventoRef: { current: () => {} },
    ultimoQuadroRef: ultimo,
    nivelRef: { current: 0 },
    setFalaDetectada: () => {},
  });
  cb.onFrameProcessed(null, alto);
  assert.ok(ultimo.current > 0);
});
