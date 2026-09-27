import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { maiorIdDasMensagens, passosDoZeDepoisDe, textosDoZeDepoisDe } from './textos-do-ze.ts';

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

function doZe(id: number, texto: string, stop: string | null): MessagePayload {
  const base = mensagem(id, 'assistant', [{ type: 'text', text: texto }]);
  return { ...base, message: { ...base.message!, stop_reason: stop } } as MessagePayload;
}

describe('passos do Zé na ordem do lote', () => {
  it('um turno inteiro: abre, cada texto, fecha no fim', () => {
    const lote = [
      mensagem(1, 'user', 'pedido'),
      doZe(2, 'vou olhar', 'tool_use'),
      mensagem(3, 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      doZe(4, 'pronto', 'end_turn'),
    ];
    assert.deepEqual(passosDoZeDepoisDe(lote, 0, false, false), [
      { tipo: 'abre' },
      { tipo: 'respondeu' },
      { tipo: 'texto', texto: 'vou olhar' },
      { tipo: 'texto', texto: 'pronto' },
      { tipo: 'fecha' },
    ]);
  });

  it('dois turnos colados: o fim do descartado vem antes da fala que estava na fila', () => {
    const lote = [doZe(5, 'resto velho', 'end_turn'), mensagem(6, 'user', 'nova fala'), doZe(7, 'resposta', null)];
    assert.deepEqual(passosDoZeDepoisDe(lote, 4, true, true), [
      { tipo: 'respondeu' },
      { tipo: 'texto', texto: 'resto velho' },
      { tipo: 'fecha' },
      { tipo: 'abre' },
      { tipo: 'respondeu' },
      { tipo: 'texto', texto: 'resposta' },
    ]);
  });

  it('resposta gravada em duas linhas com o fim: fecha só depois do texto', () => {
    const lote = [mensagem(20, 'user', 'pedido'), doZe(21, '', 'end_turn'), doZe(22, 'Um.', 'end_turn')];
    assert.deepEqual(passosDoZeDepoisDe(lote, 19, false, false), [
      { tipo: 'abre' },
      { tipo: 'respondeu' },
      { tipo: 'texto', texto: 'Um.' },
      { tipo: 'fecha' },
    ]);
  });

  it('pedido e freio no mesmo lote ainda fecham o turno', () => {
    const lote = [mensagem(8, 'user', 'pedido'), mensagem(9, 'user', '[Request interrupted by user]')];
    assert.deepEqual(passosDoZeDepoisDe(lote, 7, false, false), [{ tipo: 'abre' }, { tipo: 'fecha' }]);
  });

  it('o isRunning do stream vence quando o lote não explica a mudança', () => {
    assert.deepEqual(passosDoZeDepoisDe([], 9, true, false), [{ tipo: 'fecha' }]);
    assert.deepEqual(passosDoZeDepoisDe([], 9, false, true), [{ tipo: 'abre' }]);
  });
});
