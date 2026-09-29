import assert from 'node:assert/strict';
import { it } from 'node:test';

import { acaoDoToque, JANELA_DO_TOQUE_MS, toqueConta } from './toque-da-conversa.ts';

it('parado inicia e erro tenta de novo', () => {
  assert.equal(acaoDoToque('parado', false), 'comecar');
  assert.equal(acaoDoToque('erro', false), 'comecar');
});

it('no turno do Zé o toque interrompe; fora dele, com a conversa andando, para', () => {
  for (const cena of ['esperandoZe', 'falando', 'interrompendo'] as const) {
    assert.equal(acaoDoToque(cena, false), 'interromper', cena);
  }
  for (const cena of ['ouvindo', 'transcrevendo'] as const) {
    assert.equal(acaoDoToque(cena, false), 'parar', cena);
    assert.equal(acaoDoToque(cena, false, true), 'interromper', `${cena} com o Zé rodando`);
  }
  assert.equal(acaoDoToque('parado', false, true), 'comecar', 'parado, o toque só inicia');
});

it('com o detector preparando ou sem ter carregado, o toque não faz nada', () => {
  assert.equal(acaoDoToque('preparando', false), 'nada');
  assert.equal(acaoDoToque('parado', true), 'nada');
});

it('o segundo toque dentro de ~400 ms não conta: toque duplo não liga e desliga', () => {
  assert.equal(JANELA_DO_TOQUE_MS, 400);
  assert.equal(toqueConta(1000, null), true);
  assert.equal(toqueConta(1250, 1000), false);
  assert.equal(toqueConta(1399, 1000), false);
  assert.equal(toqueConta(1400, 1000), true);
});
