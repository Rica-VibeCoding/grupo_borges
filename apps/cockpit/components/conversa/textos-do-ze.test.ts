import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { maiorIdDasMensagens, textosDoZeDepoisDe } from './textos-do-ze.ts';

function mensagem(
  id: number,
  kind: MessagePayload['kind'],
  content: string | ContentPart[],
): MessagePayload {
  return {
    id,
    kind,
    uuid: String(id),
    parent_uuid: null,
    session_id: 'sessao',
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-09-26T00:00:00Z',
    created_at: id,
    message: {
      role: kind === 'assistant' ? 'assistant' : 'user',
      content,
    },
  };
}

describe('textos novos do Zé', () => {
  it('ignora o replay e entrega só texto posterior ao cursor', () => {
    const mensagens = [
      mensagem(10, 'assistant', 'histórico'),
      mensagem(11, 'user', 'pedido'),
      mensagem(12, 'assistant', 'resposta nova'),
    ];

    assert.deepEqual(textosDoZeDepoisDe(mensagens, 11), [
      { id: 12, texto: 'resposta nova' },
    ]);
  });

  it('entrega cada bloco de texto e ignora thinking e tool_use', () => {
    const mensagens = [
      mensagem(20, 'assistant', [
        { type: 'thinking', thinking: 'interno' },
        { type: 'text', text: 'primeiro' },
        { type: 'tool_use', id: 't1', name: 'Read', input: {} },
        { type: 'text', text: ' segundo ' },
      ]),
    ];

    assert.deepEqual(textosDoZeDepoisDe(mensagens, 0), [
      { id: 20, texto: 'primeiro' },
      { id: 20, texto: 'segundo' },
    ]);
  });

  it('o cursor avança também sobre eventos sem fala', () => {
    const mensagens = [mensagem(7, 'user', 'oi'), mensagem(15, 'system', '')];
    assert.equal(maiorIdDasMensagens(mensagens, 4), 15);
    assert.equal(maiorIdDasMensagens([], 4), 4);
  });
});
