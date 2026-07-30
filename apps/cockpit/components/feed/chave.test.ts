// Vinha dentro de `estimativa.test.ts`, que saiu junto com a estimativa por
// item em 30/07 (o virtualizador passou a usar altura constante — ver
// ALTURA_ITEM em `feed.tsx`). A identidade de item continua valendo por conta
// própria: é ela que faz o virtualizador reconhecer o mesmo item entre flushes,
// e sem isso a medição de cada item é jogada fora a cada chegada.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';

import { chaveDe } from './chave.ts';

function payload(id: number): MessagePayload {
  return {
    id,
    kind: 'user',
    uuid: `uuid-${id}`,
    parent_uuid: null,
    session_id: 'sessao',
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-07-30T12:00:00Z',
    created_at: 0,
    message: { role: 'user', content: [] },
  };
}

function fala(texto: string, id = 1): RenderItem {
  return { kind: 'user', payload: payload(id), text: texto };
}

describe('chave — identidade estável', () => {
  it('item com payload usa o uuid, não o índice', () => {
    assert.equal(chaveDe(fala('a', 42)), 'uuid-42');
  });

  it('as três formas sem payload têm chave natural própria', () => {
    assert.equal(
      chaveDe({ kind: 'sidechain-group', rootUuid: 'r1', count: 1, durMs: null, parentUuids: [] }),
      'sg-r1',
    );
    assert.equal(
      chaveDe({ kind: 'sidechain-cluster', groups: [], subagentCount: 0, totalDurMs: null }),
      'sc-sem-raiz',
    );
  });

  it('itens distintos não colidem — chave repetida faria o virtualizador reusar medida errada', () => {
    const chaves = [fala('a', 1), fala('b', 2), fala('c', 3)].map(chaveDe);
    assert.equal(new Set(chaves).size, chaves.length);
  });
});
