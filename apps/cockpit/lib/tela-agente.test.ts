import assert from 'node:assert/strict';
import { test } from 'node:test';

import { caminhoDaTela, limitaRolagem, mapaDeTelas, pinca, pontoNaImagem, pxDaPagina, textoDaFalha, textoDoPrazo, VISTA_INTEIRA } from './tela-agente.ts';

const CAIXA = { left: 10, top: 100, width: 400, height: 200 };

test('toque vira coordenada normalizada dentro da imagem', () => {
  assert.deepEqual(pontoNaImagem(210, 200, CAIXA, { largura: 960, altura: 480 }), { x: 0.5, y: 0.5 });
  assert.deepEqual(pontoNaImagem(10, 100, CAIXA, { largura: 960, altura: 480 }), { x: 0, y: 0 });
});

test('a borda direita e a de baixo ficam fora (0 ≤ x,y < 1)', () => {
  assert.equal(pontoNaImagem(410, 200, CAIXA, { largura: 960, altura: 480 }), null);
  assert.equal(pontoNaImagem(210, 300, CAIXA, { largura: 960, altura: 480 }), null);
});

test('faixa do object-fit contain não clica', () => {
  // Imagem 1:1 numa caixa 400×200: ocupa 200×200 no meio, faixas de 100px dos lados.
  assert.equal(pontoNaImagem(60, 200, CAIXA, { largura: 500, altura: 500 }), null);
  assert.deepEqual(pontoNaImagem(210, 200, CAIXA, { largura: 500, altura: 500 }), { x: 0.5, y: 0.5 });
});

test('caixa ou imagem sem tamanho não clica', () => {
  assert.equal(pontoNaImagem(0, 0, { ...CAIXA, width: 0 }, { largura: 960, altura: 480 }), null);
});

test('arrastar na tela rola a mesma distância na página', () => {
  assert.equal(pxDaPagina(390, 2334), 2334 / 390);
  assert.equal(pxDaPagina(0, 2334), 1);
  assert.equal(limitaRolagem(5000), 3000);
  assert.equal(limitaRolagem(-5000), -3000);
  assert.equal(limitaRolagem(12.6), 13);
});

test('Ver tela só para par máquina+rótulo exato e único', () => {
  const mapa = mapaDeTelas([
    { id: 'campanha-arsenal', maquina: 'arsenal', rotulo: 'Chrome do Campanha' },
    { id: 'a', maquina: 'pc', rotulo: 'Chrome repetido' },
    { id: 'b', maquina: 'pc', rotulo: 'Chrome repetido' },
  ]);
  assert.equal(mapa.get('arsenal|Chrome do Campanha'), 'campanha-arsenal');
  assert.equal(mapa.has('pc|Chrome repetido'), false);
  assert.equal(mapa.has('note|Chrome do Campanha'), false);
});

test('caminho da tela, com e sem pedido', () => {
  assert.equal(caminhoDaTela('arsenal', 'campanha-arsenal'), '/maquinas/arsenal/chrome/campanha-arsenal');
  assert.equal(caminhoDaTela('arsenal', 'campanha-arsenal', 'abc'), '/maquinas/arsenal/chrome/campanha-arsenal?pedido=abc');
});

test('prazo em m:ss, nunca negativo', () => {
  assert.equal(textoDoPrazo(1000 + 581, 1000), '9:41');
  assert.equal(textoDoPrazo(1007, 1000), '0:07');
  assert.equal(textoDoPrazo(990, 1000), '0:00');
});

test('pinça amplia em volta do meio dos dedos e não deixa vão', () => {
  const moldura = { largura: 400, altura: 200 };
  const v = pinca(VISTA_INTEIRA, 100, 200, { x: 200, y: 100 }, { x: 200, y: 100 }, moldura);
  assert.deepEqual(v, { escala: 2, x: -200, y: -100 });
  // Afastar demais trava no teto; aproximar demais volta à inteira.
  assert.equal(pinca(VISTA_INTEIRA, 10, 1000, { x: 0, y: 0 }, { x: 0, y: 0 }, moldura).escala, 5);
  assert.deepEqual(pinca(v, 200, 50, { x: 200, y: 100 }, { x: 200, y: 100 }, moldura), VISTA_INTEIRA);
  // Arrastar a pinça para fora não descola a imagem da borda.
  assert.deepEqual(pinca(VISTA_INTEIRA, 100, 200, { x: 0, y: 0 }, { x: 300, y: 300 }, moldura), { escala: 2, x: 0, y: 0 });
});

test('cada falha diz o que houve e o que fazer', () => {
  assert.match(textoDaFalha('assumir', 409, 'x'), /agente está usando/);
  assert.match(textoDaFalha('abrir', 502, 'x'), /Reconecte/);
  assert.match(textoDaFalha('entrada', 409, 'x'), /Toque de novo/);
  assert.match(textoDaFalha('devolver', 403, 'x'), /Assuma de novo/);
});
