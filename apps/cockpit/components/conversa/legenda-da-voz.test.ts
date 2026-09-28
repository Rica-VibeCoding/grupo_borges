import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FALA_VAZIA } from './fala-da-vez.ts';
import { legendaDaVez } from './legenda-da-voz.ts';
import type { Cena } from './moldura-estado.ts';

const CENAS: Cena[] = ['parado', 'preparando', 'ouvindo', 'transcrevendo', 'esperandoZe', 'falando', 'interrompendo', 'erro'];
const cheia = { firme: 'Qual a previsão?', parcial: null };
const resposta = { dito: ['Sol o dia todo.'], atual: 'Máxima de 31 graus.', indice: 1, duracao: 1.8 };

describe('a legenda da tela de voz', () => {
  it('sem "Mostrar texto", nada em cena nenhuma', () => {
    for (const cena of CENAS) {
      assert.deepEqual(legendaDaVez({ cena, texto: false, fala: { firme: 'x', parcial: 'y' }, falaDoZe: resposta }), [], cena);
    }
  });

  it('parado e preparando não escrevem legenda: quem fala é o convite', () => {
    for (const cena of ['parado', 'preparando'] as const) {
      assert.deepEqual(legendaDaVez({ cena, texto: true, fala: cheia, falaDoZe: resposta }), [], cena);
    }
  });

  it('ouvindo: só as palavras ao vivo; sem palavra ainda, a tela não escreve nada', () => {
    assert.deepEqual(legendaDaVez({ cena: 'ouvindo', texto: true, fala: { firme: null, parcial: 'Qual a' }, falaDoZe: null }), [
      { quem: 'voce', forma: 'ao-vivo', texto: 'Qual a' },
    ]);
    assert.deepEqual(legendaDaVez({ cena: 'ouvindo', texto: true, fala: FALA_VAZIA, falaDoZe: null }), []);
  });

  it('entendendo: as palavras esmaecidas até o texto firme; sem nenhuma, as reticências', () => {
    const e = { cena: 'transcrevendo' as const, texto: true, falaDoZe: null };
    assert.deepEqual(legendaDaVez({ ...e, fala: { firme: null, parcial: 'Qual a previsão' } }), [
      { quem: 'voce', forma: 'disse', texto: 'Qual a previsão', firme: false },
    ]);
    assert.deepEqual(legendaDaVez({ ...e, fala: cheia }), [{ quem: 'voce', forma: 'disse', texto: 'Qual a previsão?', firme: true }]);
    assert.deepEqual(legendaDaVez({ ...e, fala: FALA_VAZIA }), [{ quem: 'voce', forma: 'disse', texto: null, firme: false }]);
  });

  it('pensando e erro: "Você disse" só com o texto firme desta vez', () => {
    for (const cena of ['esperandoZe', 'erro'] as const) {
      assert.deepEqual(legendaDaVez({ cena, texto: true, fala: cheia, falaDoZe: null }), [
        { quem: 'voce', forma: 'disse', texto: 'Qual a previsão?', firme: true },
      ]);
      // "Não entendi o áudio" nunca vem com texto de outra fala.
      assert.deepEqual(legendaDaVez({ cena, texto: true, fala: FALA_VAZIA, falaDoZe: null }), [], cena);
    }
  });

  it('falando: a sua fala apagada em cima, a frase dele que está tocando embaixo; pausado, congela nela', () => {
    assert.deepEqual(legendaDaVez({ cena: 'falando', texto: true, fala: cheia, falaDoZe: resposta }), [
      { quem: 'voce', forma: 'recuada', texto: 'Qual a previsão?' },
      { quem: 'ze', forma: 'resposta', fala: resposta },
    ]);
    assert.deepEqual(legendaDaVez({ cena: 'interrompendo', texto: true, fala: FALA_VAZIA, falaDoZe: resposta }), [
      { quem: 'ze', forma: 'pausada', fala: resposta },
    ]);
    assert.deepEqual(legendaDaVez({ cena: 'falando', texto: true, fala: FALA_VAZIA, falaDoZe: null }), []);
  });
});
