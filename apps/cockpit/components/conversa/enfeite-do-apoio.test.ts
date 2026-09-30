import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ABERTURAS, CHANCE_DO_FECHO, criaEnfeiteDoApoio, FECHOS } from './enfeite-do-apoio.ts';

/** Sorteio de mentira: devolve os números na ordem, em laço. */
const fila = (...numeros: number[]) => {
  let i = 0;
  return () => numeros[i++ % numeros.length];
};

test('abertura na frente, com a descrição em minúscula', () => {
  const enfeita = criaEnfeiteDoApoio(fila(1 / ABERTURAS.length + 0.01, 0.99));
  assert.equal(enfeita('Tô lendo o código'), 'Rica… tô lendo o código');
});

test('às vezes a frase vai pura', () => {
  const enfeita = criaEnfeiteDoApoio(fila(0, 0.99));
  assert.equal(enfeita('Tô lendo o código'), 'Tô lendo o código');
});

test('nunca a mesma abertura duas vezes seguidas', () => {
  const enfeita = criaEnfeiteDoApoio(fila(0.5, 0.99));
  let anterior = '';
  for (let n = 0; n < 40; n += 1) {
    const dito = enfeita('Tô lendo o código');
    const abertura = dito.slice(0, dito.length - 'tô lendo o código'.length);
    assert.notEqual(abertura, anterior);
    anterior = abertura;
  }
});

test('o fecho vem depois, com ponto antes dele', () => {
  const enfeita = criaEnfeiteDoApoio(fila(0, CHANCE_DO_FECHO - 0.01, 0));
  assert.equal(enfeita('Tô lendo o código'), `Tô lendo o código.${FECHOS[0]}`);
});

test('sorteio no limite não sai da lista', () => {
  const enfeita = criaEnfeiteDoApoio(fila(0.999999, 0, 0.999999));
  const dito = enfeita('Tô rodando os testes');
  assert.ok(FECHOS.some((fecho) => dito.endsWith(fecho)));
});
