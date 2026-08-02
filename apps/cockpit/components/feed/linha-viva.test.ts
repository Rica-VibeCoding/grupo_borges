import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import type { AssistenteDeTrabalho, ItemDoFeed } from './grupo-ferramentas.ts';
import {
  desdeDaLinhaViva,
  rotuloDoTempo,
  trabalhoEmVooNoFim,
} from './linha-viva.ts';

let proximoId = 0;

function mensagem(
  kind: string,
  role: string,
  content: unknown,
  timestamp = '2026-08-02T12:00:00.000Z',
): MessagePayload {
  proximoId += 1;
  return {
    id: proximoId,
    kind,
    uuid: `lv-${proximoId}`,
    parent_uuid: null,
    is_sidechain: false,
    user_type: 'external',
    timestamp,
    created_at: 0,
    message: { role, content },
  } as unknown as MessagePayload;
}

function ferramenta(tu: string): AssistenteDeTrabalho {
  return {
    kind: 'assistant',
    payload: mensagem('assistant', 'assistant', [
      { type: 'tool_use', id: tu, name: 'Bash', input: { command: 'ls' } },
    ]),
    parts: [{ type: 'tool_use', id: tu, name: 'Bash', input: { command: 'ls' } }],
  };
}

function resultado(tu: string): MessagePayload {
  return mensagem('user', 'user', [
    { type: 'tool_result', tool_use_id: tu, content: 'ok' },
  ]);
}

/* -------------------------------------------------------------------------- */
/* trabalhoEmVooNoFim — a régua de QUANDO a linha viva existe                  */
/* -------------------------------------------------------------------------- */

test('feed vazio não tem trabalho em voo', () => {
  assert.equal(trabalhoEmVooNoFim([]), false);
});

test('grupo com execução em voo dispensa a linha viva — o gerúndio é dele', () => {
  const itens: ItemDoFeed[] = [
    { kind: 'grupo-ferramentas', itens: [ferramenta('tu-1'), ferramenta('tu-2')] },
  ];
  // Sem resultado casado no lookup, a última execução está rodando.
  assert.equal(trabalhoEmVooNoFim(itens, buildToolResultLookup([resultado('tu-1')])), true);
});

test('grupo inteiramente concluído NÃO dispensa — é aí que mora o buraco', () => {
  const itens: ItemDoFeed[] = [
    { kind: 'grupo-ferramentas', itens: [ferramenta('tu-1'), ferramenta('tu-2')] },
  ];
  const lookup = buildToolResultLookup([resultado('tu-1'), resultado('tu-2')]);
  assert.equal(trabalhoEmVooNoFim(itens, lookup), false);
});

test('execução sozinha em voo dispensa a linha viva', () => {
  assert.equal(trabalhoEmVooNoFim([ferramenta('tu-9')]), true);
  assert.equal(
    trabalhoEmVooNoFim([ferramenta('tu-9')], buildToolResultLookup([resultado('tu-9')])),
    false,
  );
});

test('balão do Rica ou a própria linha viva no fim NÃO são trabalho em voo', () => {
  const balao: ItemDoFeed = {
    kind: 'user',
    payload: mensagem('user', 'user', [{ type: 'text', text: 'faz isso' }]),
    text: 'faz isso',
  };
  assert.equal(trabalhoEmVooNoFim([balao]), false);
  assert.equal(trabalhoEmVooNoFim([balao, { kind: 'linha-viva', desdeMs: 0 }]), false);
});

/* -------------------------------------------------------------------------- */
/* desdeDaLinhaViva — a âncora do tempo                                        */
/* -------------------------------------------------------------------------- */

test('sem mensagens não há âncora', () => {
  assert.equal(desdeDaLinhaViva([]), null);
});

test('a âncora é o timestamp da ÚLTIMA mensagem', () => {
  const primeira = mensagem('user', 'user', 'oi', '2026-08-02T12:00:00.000Z');
  const ultima = mensagem('assistant', 'assistant', 'trabalhando', '2026-08-02T12:03:30.000Z');
  assert.equal(desdeDaLinhaViva([primeira, ultima]), Date.parse('2026-08-02T12:03:30.000Z'));
});

test('timestamp quebrado cai no created_at (epoch em segundos)', () => {
  const mensagens = mensagem('user', 'user', 'oi', 'não-é-data');
  mensagens.created_at = 1_750_000_000;
  assert.equal(desdeDaLinhaViva([mensagens]), 1_750_000_000_000);
});

/* -------------------------------------------------------------------------- */
/* rotuloDoTempo — o tempo em português de conversa                            */
/* -------------------------------------------------------------------------- */

test('segundos até um minuto, minutos depois, negativo vira zero', () => {
  assert.equal(rotuloDoTempo(0), 'há 0 s');
  assert.equal(rotuloDoTempo(12_000), 'há 12 s');
  assert.equal(rotuloDoTempo(59_999), 'há 59 s');
  assert.equal(rotuloDoTempo(60_000), 'há 1 min');
  assert.equal(rotuloDoTempo(125_000), 'há 2 min');
  assert.equal(rotuloDoTempo(-5_000), 'há 0 s');
});
