import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { ordenaTropa } from './ordena-tropa.ts';

function agente(slug: string, status: Agent['status'], name = slug): Agent {
  return { slug, name, status } as unknown as Agent;
}

/** Agente que já foi arrastado: o número veio do `agent_state.ordem`. */
function arrastado(slug: string, ordem: number, name = slug): Agent {
  return { slug, name, status: 'ocioso', ordem } as unknown as Agent;
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

test('ordem arrastada manda: o número do banco vence a lista ditada', () => {
  // Ordem ditada põe pavan primeiro. Aqui o Rica arrastou e inverteu.
  const ordem = ordenaTropa([
    arrastado('pavan', 2, 'José Pavan'),
    arrastado('daniel', 1, 'Daniel Singh'),
    arrastado('tara', 0, 'Tara Kaur'),
  ]).map((a) => a.slug);
  assert.deepEqual(ordem, ['tara', 'daniel', 'pavan']);
});

test('quem nunca foi arrastado vai pro fim quando alguém já foi', () => {
  // Estado que só existe com agente novo entrando depois do primeiro arrasto:
  // ele não tem número e não pode roubar a posição de quem tem.
  const ordem = ordenaTropa([
    agente('maestro', 'ocioso', 'Maestro'),
    arrastado('tara', 1, 'Tara Kaur'),
    arrastado('daniel', 0, 'Daniel Singh'),
  ]).map((a) => a.slug);
  assert.deepEqual(ordem, ['daniel', 'tara', 'maestro']);
});

test('ordem zero é posição, não ausência de posição', () => {
  // `0` é falsy: um `if (agente.ordem)` mandaria o primeiro da lista pro fim.
  const ordem = ordenaTropa([
    agente('pavan', 'trabalhando', 'José Pavan'),
    arrastado('canarinho', 0, 'Canário'),
  ]).map((a) => a.slug);
  assert.deepEqual(ordem, ['canarinho', 'pavan']);
});
