import assert from 'node:assert/strict';
import { it } from 'node:test';

import { acaoDoToque, JANELA_DO_TOQUE_MS, toqueConta, zeOcupado } from './toque-da-conversa.ts';

it('parado inicia e erro tenta de novo', () => {
  assert.equal(acaoDoToque('parado', false), 'comecar');
  assert.equal(acaoDoToque('erro', false), 'comecar');
});

it('em todo estado ativo o toque para — inclusive com o Zé falando', () => {
  for (const cena of ['ouvindo', 'transcrevendo', 'esperandoZe', 'falando', 'interrompendo'] as const) {
    assert.equal(acaoDoToque(cena, false), 'parar', cena);
  }
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

it('o Zé só está ocupado num turno que conta: descartado não conta', () => {
  assert.equal(zeOcupado(true, false), true);
  assert.equal(zeOcupado(false, false), false);
  assert.equal(zeOcupado(true, true), false, 'turno descartado: o Claude Code enfileira');
});
