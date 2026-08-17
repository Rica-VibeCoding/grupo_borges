import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  aplicaOrdem,
  mesmaOrdem,
  moveUmaCasa,
  novaOrdem,
  ordemJaChegou,
} from './ordem-arrastada.ts';

const TROPA = ['pavan', 'daniel', 'tara', 'vinicius', 'felipe'];

function agente(slug: string): Agent {
  return { slug, name: slug, status: 'ocioso' } as unknown as Agent;
}

test('arrastar pra baixo e soltar na metade de baixo do alvo põe DEPOIS dele', () => {
  assert.deepEqual(novaOrdem(TROPA, 'pavan', 'tara', 'bottom'), [
    'daniel',
    'tara',
    'pavan',
    'vinicius',
    'felipe',
  ]);
});

test('arrastar pra baixo e soltar na metade de cima do alvo põe ANTES dele', () => {
  assert.deepEqual(novaOrdem(TROPA, 'pavan', 'tara', 'top'), [
    'daniel',
    'pavan',
    'tara',
    'vinicius',
    'felipe',
  ]);
});

test('arrastar pra cima usa o mesmo cálculo, sem deslocamento de um', () => {
  // A armadilha que motivou tirar o arrastado da lista antes de achar o alvo:
  // com ele dentro, o índice de `daniel` muda conforme a direção do arrasto.
  assert.deepEqual(novaOrdem(TROPA, 'felipe', 'daniel', 'top'), [
    'pavan',
    'felipe',
    'daniel',
    'tara',
    'vinicius',
  ]);
  assert.deepEqual(novaOrdem(TROPA, 'felipe', 'daniel', 'bottom'), [
    'pavan',
    'daniel',
    'felipe',
    'tara',
    'vinicius',
  ]);
});

test('soltar em cima de si mesmo não mexe em nada', () => {
  assert.deepEqual(novaOrdem(TROPA, 'tara', 'tara', 'top'), TROPA);
});

test('slug que não está na lista devolve a lista intacta', () => {
  assert.deepEqual(novaOrdem(TROPA, 'fantasma', 'tara', 'top'), TROPA);
  assert.deepEqual(novaOrdem(TROPA, 'tara', 'fantasma', 'top'), TROPA);
});

test('mover pro topo da lista funciona', () => {
  assert.deepEqual(novaOrdem(TROPA, 'felipe', 'pavan', 'top'), [
    'felipe',
    'pavan',
    'daniel',
    'tara',
    'vinicius',
  ]);
});

test('a ordem otimista reordena os agentes recebidos', () => {
  const agentes = [agente('pavan'), agente('daniel'), agente('tara')];
  const vistos = aplicaOrdem(agentes, ['tara', 'pavan', 'daniel']).map((a) => a.slug);
  assert.deepEqual(vistos, ['tara', 'pavan', 'daniel']);
});

test('agente que a ordem otimista não conhece vai pro fim, nunca some', () => {
  const agentes = [agente('pavan'), agente('daniel'), agente('maestro')];
  const vistos = aplicaOrdem(agentes, ['daniel', 'pavan']).map((a) => a.slug);
  assert.deepEqual(vistos, ['daniel', 'pavan', 'maestro']);
});

test('sem ordem otimista a lista passa intacta', () => {
  const agentes = [agente('pavan'), agente('daniel')];
  assert.deepEqual(aplicaOrdem(agentes, null), agentes);
});

test('a ordem otimista morre quando o servidor devolve a mesma sequência', () => {
  const agentes = [agente('tara'), agente('pavan')];
  assert.equal(ordemJaChegou(agentes, ['tara', 'pavan']), true);
  assert.equal(ordemJaChegou(agentes, ['pavan', 'tara']), false);
});

test('agente que entrou depois do arrasto não trava a ordem otimista', () => {
  // Comparar o TAMANHO das listas era uma trava silenciosa: bastava um agente
  // entrar ou sair entre o arrasto e o poll pra que a contagem nunca mais
  // batesse, a ordem otimista nunca fosse descartada, e a coluna parasse de
  // refletir o banco até desmontar. O que interessa é a sequência relativa de
  // quem existe dos dois lados — o recém-chegado o servidor põe no fim, e o
  // `aplicaOrdem` também.
  const agentes = [agente('tara'), agente('pavan'), agente('maestro')];
  assert.equal(ordemJaChegou(agentes, ['tara', 'pavan']), true);
  assert.equal(ordemJaChegou(agentes, ['pavan', 'tara']), false);
});

test('agente que saiu depois do arrasto também não trava', () => {
  const agentes = [agente('tara')];
  assert.equal(ordemJaChegou(agentes, ['tara', 'pavan']), true);
});

test('mesmaOrdem compara conteúdo, não referência', () => {
  // A guarda de "soltou onde já estava" comparava referência, e `novaOrdem`
  // sempre devolve array novo — então ela nunca disparava e o PATCH saía à
  // toa. Soltar na borda de cima do vizinho de baixo é exatamente esse caso.
  assert.equal(mesmaOrdem(['a', 'b'], ['a', 'b']), true);
  assert.equal(mesmaOrdem(['a', 'b'], ['b', 'a']), false);
  assert.equal(mesmaOrdem(['a', 'b'], ['a', 'b', 'c']), false);
  const soltouOndeJaEstava = novaOrdem(TROPA, 'daniel', 'tara', 'top');
  assert.notEqual(soltouOndeJaEstava, TROPA, 'array novo, referência diferente');
  assert.equal(mesmaOrdem(soltouOndeJaEstava, TROPA), true, 'mesmo conteúdo');
});

test('moveUmaCasa desce e sobe uma posição', () => {
  assert.deepEqual(moveUmaCasa(TROPA, 'pavan', 1), [
    'daniel',
    'pavan',
    'tara',
    'vinicius',
    'felipe',
  ]);
  assert.deepEqual(moveUmaCasa(TROPA, 'tara', -1), [
    'pavan',
    'tara',
    'daniel',
    'vinicius',
    'felipe',
  ]);
});

test('moveUmaCasa no meio anda uma casa só, nos dois sentidos', () => {
  // Os dois deslocamentos que se cancelam: o vizinho de destino e a borda em
  // que se encosta. Errar o sinal de um deles anda duas casas ou nenhuma.
  assert.deepEqual(moveUmaCasa(TROPA, 'vinicius', -1).indexOf('vinicius'), 2);
  assert.deepEqual(moveUmaCasa(TROPA, 'vinicius', 1).indexOf('vinicius'), 4);
});

test('moveUmaCasa devolve a MESMA lista quando não há pra onde ir', () => {
  // Quem chama usa a identidade pra não gastar requisição na borda.
  assert.equal(moveUmaCasa(TROPA, 'pavan', -1), TROPA, 'primeiro subindo');
  assert.equal(moveUmaCasa(TROPA, 'felipe', 1), TROPA, 'último descendo');
  assert.equal(moveUmaCasa(TROPA, 'ninguem', 1), TROPA, 'slug fora da lista');
});
