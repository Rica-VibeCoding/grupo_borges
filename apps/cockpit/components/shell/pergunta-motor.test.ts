import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PerguntaMotor } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  MEMORIA_VAZIA,
  aoMudarAFrota,
  chaveDaPergunta,
  depoisDoToque,
  perguntaVisivel,
  rotuloDoDestino,
  textoDaPergunta,
} from './pergunta-motor.ts';

const haiku: PerguntaMotor = { tipo: 'modelo', destino: 'Haiku 4.5', opcao_em_foco: 'sim' };
const medio: PerguntaMotor = { tipo: 'esforco', destino: 'medium', opcao_em_foco: null };

describe('tradução do destino', () => {
  it('modelo vem com nome de exibição e fica como está', () => {
    assert.equal(rotuloDoDestino(haiku), 'Haiku 4.5');
    assert.equal(textoDaPergunta(haiku), 'Trocar para Haiku 4.5?');
  });
  it('esforço cru vira o rótulo do chip', () => {
    assert.equal(rotuloDoDestino(medio), 'médio');
    assert.equal(rotuloDoDestino({ tipo: 'esforco', destino: 'XHigh ' }), 'extra alto');
    assert.equal(rotuloDoDestino({ tipo: 'esforco', destino: 'auto' }), 'automático');
    assert.equal(textoDaPergunta(medio), 'Trocar o esforço para médio?');
  });
  it('esforço desconhecido passa cru, sem sumir', () => {
    assert.equal(rotuloDoDestino({ tipo: 'esforco', destino: 'turbo' }), 'turbo');
  });
});

describe('quando mostrar a barrinha', () => {
  it('mostra a pergunta que a frota traz, e nada sem ela', () => {
    assert.equal(perguntaVisivel(haiku, MEMORIA_VAZIA), haiku);
    assert.equal(perguntaVisivel(null, MEMORIA_VAZIA), null);
    assert.equal(perguntaVisivel(undefined, MEMORIA_VAZIA), null);
  });
  it('some no toque respondido, sem esperar a próxima leitura da frota', () => {
    const memoria = depoisDoToque(MEMORIA_VAZIA, haiku, { tipo: 'resposta', respondida: true });
    assert.equal(perguntaVisivel(haiku, memoria), null);
  });
  it('tecla que não fechou a pergunta deixa a barra na tela', () => {
    const memoria = depoisDoToque(MEMORIA_VAZIA, haiku, { tipo: 'resposta', respondida: false });
    assert.equal(perguntaVisivel(haiku, memoria), haiku);
  });
  it('409 sem_pergunta_motor some sem erro', () => {
    const memoria = depoisDoToque(MEMORIA_VAZIA, haiku, { tipo: 'erro', codigo: 'sem_pergunta_motor', pergunta: null });
    assert.equal(perguntaVisivel(haiku, memoria), null);
  });
  it('409 pergunta_mudou troca para a pergunta nova', () => {
    const memoria = depoisDoToque(MEMORIA_VAZIA, haiku, { tipo: 'erro', codigo: 'pergunta_mudou', pergunta: medio });
    assert.equal(perguntaVisivel(haiku, memoria), medio);
  });
  it('outro erro não esconde a pergunta', () => {
    const memoria = depoisDoToque(MEMORIA_VAZIA, haiku, { tipo: 'erro', codigo: null, pergunta: null });
    assert.equal(perguntaVisivel(haiku, memoria), haiku);
  });
  it('a frota nova manda: pergunta que some limpa a memória, e a mesma pergunta que volta depois reaparece', () => {
    const respondida = depoisDoToque(MEMORIA_VAZIA, haiku, { tipo: 'resposta', respondida: true });
    assert.equal(perguntaVisivel(haiku, aoMudarAFrota(respondida, haiku)), null);
    const limpa = aoMudarAFrota(respondida, null);
    assert.deepEqual(limpa, MEMORIA_VAZIA);
    assert.equal(perguntaVisivel(haiku, aoMudarAFrota(limpa, haiku)), haiku);
  });
  it('a substituta cai quando a frota traz leitura nova', () => {
    const trocada = depoisDoToque(MEMORIA_VAZIA, haiku, { tipo: 'erro', codigo: 'pergunta_mudou', pergunta: medio });
    assert.equal(perguntaVisivel(medio, aoMudarAFrota(trocada, medio)), medio);
    assert.equal(perguntaVisivel(null, aoMudarAFrota(trocada, null)), null);
  });
  it('chave distingue tipo e destino', () => {
    assert.notEqual(chaveDaPergunta(haiku), chaveDaPergunta({ ...haiku, tipo: 'esforco' }));
    assert.equal(chaveDaPergunta(null), null);
  });
});
