import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { acompanha, assenta } from './mola.ts';

function elementoFalso() {
  const estilo: Record<string, string> = {};
  const style = new Proxy(estilo, {
    get: (alvo, chave) =>
      chave === 'removeProperty' ? (p: string) => delete alvo[p] : alvo[chave as string],
  });
  return {
    style,
    offsetWidth: 0,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLElement;
}

describe('mola da gaveta', () => {
  it('arrasto novo antes do assento terminar: a sobra do assento velho não desfaz o dedo', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    (globalThis as { window?: unknown }).window = globalThis;
    try {
      const gaveta = elementoFalso();
      let fimDoVelho = 0;
      assenta(gaveta, 0, () => (fimDoVelho += 1));
      acompanha(gaveta, -120);
      mock.timers.tick(1000);
      assert.equal(fimDoVelho, 0);
      assert.equal(gaveta.style.transform, 'translate3d(-120px, 0, 0)');
    } finally {
      mock.timers.reset();
    }
  });
});
