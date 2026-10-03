import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { saindoOutputNoFim } from '../../lib/escrita-viva.ts';
import type { ItemDoFeed } from './grupo-ferramentas.ts';
import { estadoDoAgora, fraseEmVoo } from './linha-do-agora.ts';
import { encerraOrfas } from './orfas-do-turno.ts';

test('a esfera não olha pra caixa nem pula: ouvindo e pronto viram parado', () => {
  assert.equal(estadoDoAgora({ status: 'ocioso', turnoVivo: false, produzindo: false }), 'parado');
});

test('sem frota é desligado; turno vivo sem output é pensando; com output, executando', () => {
  assert.equal(estadoDoAgora({ status: undefined, turnoVivo: true, produzindo: true }), 'offline');
  assert.equal(estadoDoAgora({ status: 'trabalhando', turnoVivo: true, produzindo: false }), 'pensando');
  assert.equal(estadoDoAgora({ status: 'trabalhando', turnoVivo: true, produzindo: true }), 'executando');
});

test('quem espera o Rica vence o turno em voo', () => {
  assert.equal(estadoDoAgora({ status: 'aguardando', turnoVivo: true, produzindo: true }), 'atencao');
});

test('feed vazio não tem passo em voo', () => {
  assert.equal(fraseEmVoo([]), null);
});

test('passo órfão que o feed já mostra interrompido não volta "em voo" pela linha do agora', () => {
  // `a` ficou sem resultado e a resposta seguinte (`b`) já respondeu: o feed
  // pinta `a` interrompido. Com o lookup cru, a linha diria "Executando npm test".
  const pede = (n: number, id: string, command: string): MessagePayload => ({
    id: n,
    kind: 'assistant',
    uuid: `u${n}`,
    parent_uuid: null,
    session_id: 's',
    is_sidechain: false,
    agent_id: null,
    user_type: 'external',
    timestamp: '2026-10-01T04:01:12Z',
    created_at: n,
    message: { role: 'assistant', id: `m${n}`, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  });
  const responde: MessagePayload = {
    id: 3,
    kind: 'user',
    uuid: 'u3',
    parent_uuid: null,
    session_id: 's',
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-10-01T04:01:13Z',
    created_at: 3,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'ok' }] },
  };
  const msgs = [pede(1, 'a', 'npm test'), pede(2, 'b', 'git status'), responde];
  const itens: ItemDoFeed[] = [
    {
      kind: 'grupo-ferramentas',
      itens: msgs.slice(0, 2).map((payload) => ({
        kind: 'assistant' as const,
        payload,
        parts: payload.message!.content as ContentPart[],
      })),
    } as ItemDoFeed,
  ];
  const doFeed = encerraOrfas(msgs, buildToolResultLookup(msgs), false);
  assert.equal(fraseEmVoo(itens, doFeed), null);
  assert.equal(saindoOutputNoFim(itens, doFeed), false);
});
