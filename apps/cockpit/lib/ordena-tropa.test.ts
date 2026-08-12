import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { ordenaTropa } from './ordena-tropa.ts';

function agente(slug: string, status: Agent['status'], name = slug): Agent {
  return { slug, name, status } as unknown as Agent;
}

const TROPA = [
  agente('canarinho', 'trabalhando', 'Canário'),
  agente('daniel', 'trabalhando', 'Daniel Singh'),
  agente('felipe', 'offline', 'Felipe Conti'),
  agente('hiro', 'ocioso', 'Hiro Nakamura'),
  agente('pavan', 'trabalhando', 'José Pavan'),
  agente('barsi', 'offline', 'Luiz Barsi'),
  agente('tara', 'ocioso', 'Tara Kaur'),
  agente('vinicius', 'offline', 'Vinicius Zanella'),
];

const DITADA = ['pavan', 'daniel', 'tara', 'vinicius', 'felipe', 'barsi', 'hiro', 'canarinho'];

test('entrega a ordem ditada pelo Rica, não a do backend', () => {
  assert.deepEqual(ordenaTropa(TROPA).map((a) => a.slug), DITADA);
});

test('nenhum estado move ninguém — nem aguardando', () => {
  // A "dança" que o Rica reprovou em 11/08: flip trabalhando↔ocioso movia a
  // linha. E `aguardando` deixou de ser exceção quando a ordem virou fixa —
  // quem sobe, dança. O âmbar continua no ponto do retrato.
  const trocada = TROPA.map((a) =>
    agente(a.slug, a.status === 'trabalhando' ? 'ocioso' : 'aguardando', a.name),
  );
  assert.deepEqual(ordenaTropa(trocada).map((a) => a.slug), DITADA);
});

test('a ordem não depende da ordem de chegada', () => {
  const invertida = ordenaTropa([...TROPA].reverse()).map((a) => a.slug);
  assert.deepEqual(invertida, DITADA);
});

test('agente fora da lista vai pro fim, por nome, sem sumir', () => {
  const ordem = ordenaTropa([
    agente('zeca', 'trabalhando', 'Zeca'),
    agente('daniel', 'ocioso', 'Daniel Singh'),
    agente('alvaro', 'aguardando', 'Álvaro'),
  ]).map((a) => a.slug);
  assert.deepEqual(ordem, ['daniel', 'alvaro', 'zeca']);
});

test('nome com acento compara em pt-BR no desempate do fim da lista', () => {
  const ordem = ordenaTropa([agente('b', 'ocioso', 'Beto'), agente('a', 'ocioso', 'Álvaro')]).map(
    (a) => a.slug,
  );
  assert.deepEqual(ordem, ['a', 'b']);
});
