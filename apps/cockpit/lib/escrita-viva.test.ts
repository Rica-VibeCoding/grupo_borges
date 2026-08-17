import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import type { AssistenteDeTrabalho, ItemDoFeed } from '../components/feed/grupo-ferramentas.ts';
import { escrevendoNoFim } from './escrita-viva.ts';

let proximoId = 0;

function mensagem(role: string, content: unknown): MessagePayload {
  proximoId += 1;
  return {
    id: proximoId,
    kind: role,
    uuid: `ev-${proximoId}`,
    parent_uuid: null,
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-08-17T03:00:00.000Z',
    created_at: 0,
    message: { role, content },
  } as unknown as MessagePayload;
}

function assistente(partes: readonly unknown[]): AssistenteDeTrabalho {
  return {
    kind: 'assistant',
    payload: mensagem('assistant', partes),
    parts: partes,
  } as unknown as AssistenteDeTrabalho;
}

const TEXTO = { type: 'text', text: 'A régua é a última parte' };
const FERRAMENTA = { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } };

describe('escrevendoNoFim', () => {
  it('feed vazio não está escrevendo', () => {
    assert.equal(escrevendoNoFim([]), false);
  });

  it('texto do assistente no fim é escrita viva', () => {
    assert.equal(escrevendoNoFim([assistente([TEXTO])]), true);
  });

  it('texto seguido de ferramenta NÃO é escrita: quem está no ar é a ferramenta', () => {
    // É o caso comum de um item de assistente — ele fala e então chama uma
    // ferramenta. Olhar "existe texto em algum lugar" acenderia errado.
    assert.equal(escrevendoNoFim([assistente([TEXTO, FERRAMENTA])]), false);
  });

  it('ferramenta seguida de texto volta a ser escrita', () => {
    assert.equal(escrevendoNoFim([assistente([FERRAMENTA, TEXTO])]), true);
  });

  it('último item que não é do assistente não conta', () => {
    const doUsuario = { kind: 'user', payload: mensagem('user', 'oi') } as unknown as ItemDoFeed;
    assert.equal(escrevendoNoFim([assistente([TEXTO]), doUsuario]), false);
  });
});
