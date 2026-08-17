import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { aplicaOrdem, novaOrdem, ordemJaChegou } from './ordem-arrastada.ts';

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

test('frota que mudou de tamanho não conta como ordem chegada', () => {
  // Agente entrou ou saiu entre o arrasto e o poll: as listas não são
  // comparáveis, e insistir na ordem otimista esconderia o recém-chegado.
  const agentes = [agente('tara'), agente('pavan'), agente('maestro')];
  assert.equal(ordemJaChegou(agentes, ['tara', 'pavan']), false);
});
