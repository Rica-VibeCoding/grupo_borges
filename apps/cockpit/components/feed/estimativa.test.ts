import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';

import { ALTURA_MINIMA_PX, estimaAltura, linhasDeTexto } from './estimativa.ts';
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

describe('estimativa — determinística e sem estado', () => {
  it('o mesmo item devolve o mesmo número na primeira e na milésima chamada', () => {
    const item = fala('uma linha qualquer');
    const primeira = estimaAltura(item);
    for (let volta = 0; volta < 1_000; volta++) {
      assert.equal(estimaAltura(item), primeira);
    }
  });

  it('o cache não altera a resposta — item novo com o mesmo conteúdo dá o mesmo número', () => {
    const original = fala('mesmo conteúdo, outra identidade');
    const gemeo = fala('mesmo conteúdo, outra identidade');
    assert.notEqual(original, gemeo, 'o teste precisa de duas identidades distintas');
    assert.equal(estimaAltura(gemeo), estimaAltura(original));
  });

  it('estimar OUTROS itens no meio não muda a resposta — foi a média móvel que deslocou 20.273 px', () => {
    const alvo = fala('curto');
    const antes = estimaAltura(alvo);
    estimaAltura(fala('x'.repeat(50_000), 2));
    estimaAltura(fala('', 3));
    assert.equal(estimaAltura(alvo), antes);
  });
});

describe('estimativa — bordas que os renderers aguentam', () => {
  it('conteúdo vazio ainda ocupa pelo menos uma linha', () => {
    assert.equal(linhasDeTexto(''), 1);
    assert.ok(estimaAltura(fala('')) >= ALTURA_MINIMA_PX);
  });

  it('conteúdo gigante não explode a estimativa — o teto segura', () => {
    const gigante = estimaAltura(fala('x'.repeat(500_000)));
    const medio = estimaAltura(fala('x'.repeat(2_000)));
    assert.ok(Number.isFinite(gigante));
    assert.equal(gigante, medio, 'ambos batem no mesmo teto de linhas');
  });

  it('uma linha só, sem quebra, dobra pela largura da tela', () => {
    assert.ok(linhasDeTexto('x'.repeat(112)) >= 2);
  });

  it('toda forma de item tem altura positiva e finita', () => {
    const itens: RenderItem[] = [
      fala('oi'),
      { kind: 'user-internal', payload: payload(2), text: '' },
      { kind: 'meta-decision', payload: payload(3), text: 'decidiu' },
      { kind: 'assistant', payload: payload(4), parts: [] },
      {
        kind: 'assistant',
        payload: payload(5),
        parts: [
          { type: 'text', text: 'resposta' },
          { type: 'thinking', thinking: 'x'.repeat(9_000) },
          { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
          { type: 'tool_result', tool_use_id: 't1', content: '' },
        ],
      },
      { kind: 'channel', payload: payload(6), raw: '' },
      {
        kind: 'chip',
        payload: payload(7),
        chip: { icon: '$', label: 'Bash', summary: '' },
        expandBody: '',
        classifierKind: 'tool',
      },
      { kind: 'sidechain-group', rootUuid: 'r1', count: 3, durMs: null, parentUuids: [] },
      { kind: 'sidechain-cluster', groups: [], subagentCount: 2, totalDurMs: null },
    ];

    for (const item of itens) {
      const altura = estimaAltura(item);
      assert.ok(altura > 0 && Number.isFinite(altura), `${item.kind} devolveu ${altura}`);
    }
  });
});

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
});
