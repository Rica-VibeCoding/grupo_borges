import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resumoDeUmaLinha, temMaisParaMostrar } from './linha-seca.ts';

// Os dois corpos abaixo são reais, medidos na tela do Rica em 15/08 (viewport
// de iPhone). O primeiro chegava com 23px visíveis de 555px — 4% do texto.
const NOTIFICACAO_LONGA =
  'completed: Background command "Wait for composer research agent" completed (exit code 0)';
const ENVELOPE_MULTILINHA =
  '<channel source="telegram" user="Rica">\nOlha que vergonha que dá quando olhamos para isso\n</channel>';

test('temMaisParaMostrar — linha que não cabe em uma linha pede expansor', () => {
  assert.equal(temMaisParaMostrar(NOTIFICACAO_LONGA), true);
});

test('temMaisParaMostrar — corpo com quebra de linha pede expansor mesmo se curto', () => {
  assert.equal(temMaisParaMostrar('erro\nna linha 3'), true);
});

test('temMaisParaMostrar — corpo curto de uma linha continua sem expansor', () => {
  // "60 passos", "2 em paralelo" e afins não escondem nada: pôr um controle de
  // abrir neles é ruído, não acessibilidade.
  assert.equal(temMaisParaMostrar('60 passos'), false);
  assert.equal(temMaisParaMostrar('2 em paralelo'), false);
  assert.equal(temMaisParaMostrar(undefined), false);
  assert.equal(temMaisParaMostrar(''), false);
});

test('resumoDeUmaLinha — mostra a primeira linha com conteúdo, não a vazia', () => {
  assert.equal(resumoDeUmaLinha(ENVELOPE_MULTILINHA), '<channel source="telegram" user="Rica">');
  assert.equal(resumoDeUmaLinha('\n\n  primeira de verdade\nsegunda'), 'primeira de verdade');
});

test('resumoDeUmaLinha — corpo de uma linha só volta inteiro', () => {
  assert.equal(resumoDeUmaLinha(NOTIFICACAO_LONGA), NOTIFICACAO_LONGA);
});
