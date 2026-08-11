import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { ordenaTropa } from './ordena-tropa.ts';

function agente(slug: string, status: Agent['status'], name = slug): Agent {
  return { slug, name, status } as unknown as Agent;
}

test('ordena por nome, ignorando o estado entre vivos', () => {
  const entrada = [
    agente('zeca', 'ocioso', 'Zeca'),
    agente('ana', 'trabalhando', 'Ana'),
    agente('bia', 'ocioso', 'Bia'),
  ];
  const primeira = ordenaTropa(entrada).map((a) => a.slug);
  // O flip trabalhando↔ocioso não pode mover ninguém: mesma entrada, dois
  // estados trocados, mesma ordem — é a regressão da "dança" que o Rica
  // reprovou em 11/08.
  const invertida = ordenaTropa([
    agente('zeca', 'trabalhando', 'Zeca'),
    agente('ana', 'ocioso', 'Ana'),
    agente('bia', 'trabalhando', 'Bia'),
  ]).map((a) => a.slug);
  assert.deepEqual(primeira, ['ana', 'bia', 'zeca']);
  assert.deepEqual(invertida, primeira);
});

test('aguardando sobe ao topo, e o resto segue por nome', () => {
  const ordem = ordenaTropa([
    agente('zeca', 'ocioso', 'Zeca'),
    agente('ana', 'aguardando', 'Ana'),
    agente('bia', 'trabalhando', 'Bia'),
  ]).map((a) => a.slug);
  assert.deepEqual(ordem, ['ana', 'bia', 'zeca']);
});

test('nome com acento compara em pt-BR', () => {
  const ordem = ordenaTropa([agente('b', 'ocioso', 'Beto'), agente('a', 'ocioso', 'Álvaro')]).map(
    (a) => a.slug,
  );
  // pt-BR: "Álvaro" vem antes de "Beto" (e antes de um "A" cru, mas aqui o
  // caso é só a ordem do acento à frente do B).
  assert.deepEqual(ordem, ['a', 'b']);
});

test('status desconhecido fica na ordem de nome, sem subir', () => {
  const ordem = ordenaTropa([
    agente('zeca', 'ocioso', 'Zeca'),
    agente('estranho', 'inexistente' as Agent['status'], 'Estranho'),
  ]).map((a) => a.slug);
  // estadoDe desconhecido cai em offline (ordem 3) — não é aguardando, então
  // não sobe; segue alfabética.
  assert.deepEqual(ordem, ['estranho', 'zeca']);
});
