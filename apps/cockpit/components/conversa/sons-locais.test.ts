import assert from 'node:assert/strict';
import { it } from 'node:test';

import { criaSonsLocais, destravaSintese } from './sons-locais.ts';

it('inicia uma frase silenciosa no gesto que destrava a síntese', () => {
  const chamadas: string[] = [];
  const frases: Array<{ texto: string; volume: number }> = [];

  destravaSintese<{ texto: string; volume: number }>(
    {
      resume: () => chamadas.push('resume'),
      speak: (frase) => {
        chamadas.push('speak');
        frases.push(frase);
      },
    },
    (texto) => ({ texto, volume: 1 }),
  );

  assert.deepEqual(chamadas, ['resume', 'speak']);
  assert.deepEqual(frases, [{ texto: '', volume: 0 }]);
});

it('reserva informa fim da fala, não o pedido de síntese', () => {
  let frase: { onend?: () => void } | undefined;
  let fins = 0;
  const janelaAnterior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fraseAnterior = Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { speechSynthesis: { cancel() {}, speak(atual: typeof frase) { frase = atual; } } } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: class {} });
  try {
    criaSonsLocais().fala('Continuo aqui.', () => { fins++; });
    assert.equal(fins, 0);
    frase?.onend?.();
    assert.equal(fins, 1);
  } finally {
    if (janelaAnterior) Object.defineProperty(globalThis, 'window', janelaAnterior);
    else Reflect.deleteProperty(globalThis, 'window');
    if (fraseAnterior) Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', fraseAnterior);
    else Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance');
  }
});
