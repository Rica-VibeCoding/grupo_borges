import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { animaTroca } from './transicao-da-voz.ts';

const tudoCerto = { temApi: true, reduzido: false, visivel: true };

describe('quando a troca de tela da voz anima', () => {
  it('com a API, sem movimento reduzido e com a aba à vista', () => {
    assert.equal(animaTroca(tudoCerto), true);
  });

  it('sem a API (Safari antes do 18.2): troca direta', () => {
    assert.equal(animaTroca({ ...tudoCerto, temApi: false }), false);
  });

  it('movimento reduzido nunca anima: troca direta, mesmo comportamento', () => {
    assert.equal(animaTroca({ ...tudoCerto, reduzido: true }), false);
  });

  it('aba escondida não anima', () => {
    assert.equal(animaTroca({ ...tudoCerto, visivel: false }), false);
  });
});
