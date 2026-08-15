import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { textosDoUsuario } from './textos-do-usuario.ts';

function base(id: number): Omit<MessagePayload, 'kind' | 'message'> {
  return {
    id,
    uuid: `u${id}`,
    parent_uuid: null,
    session_id: null,
    is_sidechain: false,
    user_type: 'external',
    timestamp: new Date(id * 1000).toISOString(),
    created_at: id * 1000,
  };
}

function doUsuario(id: number, texto: string): MessagePayload {
  return { ...base(id), kind: 'user', message: { role: 'user', content: texto } };
}

describe('textos do usuário — o que encerra a bolha otimista', () => {
  it('devolve o que o Rica escreveu, na ordem', () => {
    assert.deepEqual(
      textosDoUsuario([doUsuario(1, 'primeira'), doUsuario(2, 'segunda')]),
      ['primeira', 'segunda'],
    );
  });

  it('ignora a fala do agente — bolha do assistente não encerra pendência nenhuma', () => {
    const doAgente: MessagePayload = {
      ...base(3),
      kind: 'assistant',
      message: { role: 'assistant', content: 'respondi' },
    };
    assert.deepEqual(textosDoUsuario([doAgente]), []);
  });

  it('a mensagem ENFILEIRADA pelo CLI conta como chegada', () => {
    // O `queued` é o recibo que chega em segundos; o eco `user` do mesmo texto
    // só nasce quando a fila drena, minutos depois. Se este caso ficar vermelho,
    // a bolha otimista fica empilhada em cima da bolha da fila — a mesma frase
    // duas vezes na tela até o teto de 3 min.
    const enfileirada: MessagePayload = {
      ...base(4),
      kind: 'queued',
      message: null,
      content: 'mandei com ele ocupado',
    };
    assert.deepEqual(textosDoUsuario([enfileirada]), ['mandei com ele ocupado']);
  });

  it('conteúdo em blocos: junta o texto e descarta o resto', () => {
    const emBlocos: MessagePayload = {
      ...base(5),
      kind: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'olha ' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } },
          { type: 'text', text: 'a foto' },
        ] as MessagePayload['message'] extends { content: infer C } ? C : never,
      },
    };
    assert.deepEqual(textosDoUsuario([emBlocos]), ['olha a foto']);
  });

  it('mensagem sem texto nenhum não vira string vazia na lista', () => {
    const soFerramenta: MessagePayload = {
      ...base(6),
      kind: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'x', content: 'saída' },
        ] as MessagePayload['message'] extends { content: infer C } ? C : never,
      },
    };
    assert.deepEqual(textosDoUsuario([soFerramenta]), []);
  });
});
