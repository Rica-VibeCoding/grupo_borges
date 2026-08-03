import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MessagePayload } from './messages-types.ts';
import type { RenderItem } from './render-items.ts';
import {
  buildRenderItems,
  buildToolResultLookup,
  deriveSubagentStatusesFromMessages,
} from './render-items.ts';
import {
  doneTaskNotificationXml,
  failedTaskNotificationXml,
} from './__fixtures__/task-notification.fixtures.ts';

// V1: prova que kinds vindos do classifier que ANTES caíam no fluxo legado
// (XML vazando em UserBubble) agora viram items de kind='chip'. Cobre os 3
// kinds adicionados ao switch: task-notification, channel-envelope, e
// sidechain-cluster (este último não dispara aqui em prod porque is_sidechain
// é triado antes, mas o switch é exhaustivo).

const baseMessage = {
  id: 1,
  kind: 'user',
  uuid: 'uuid-1',
  parent_uuid: null,
  session_id: 'session-1',
  is_sidechain: false,
  user_type: 'external',
  timestamp: '2026-05-17T00:00:00.000Z',
  created_at: 1,
} satisfies Omit<MessagePayload, 'message'>;

function userText(id: number, content: string): MessagePayload {
  return {
    ...baseMessage,
    id,
    uuid: `uuid-${id}`,
    kind: 'user',
    message: { role: 'user', content },
  };
}

function message(overrides: Partial<MessagePayload> & { message: MessagePayload['message'] }): MessagePayload {
  return {
    ...baseMessage,
    ...overrides,
    id: overrides.id ?? baseMessage.id,
    uuid: overrides.uuid ?? baseMessage.uuid,
    message: overrides.message,
  };
}

test('buildRenderItems — task-notification (failed) produz item kind=chip', () => {
  const items = buildRenderItems([userText(10, failedTaskNotificationXml)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'chip');
  if (items[0].kind === 'chip') {
    assert.equal(items[0].classifierKind, 'task-notification');
    assert.equal(items[0].chip.icon, '⚙️');
    assert.match(items[0].expandBody, /"taskId": "bzubuuj01"/);
  }
});

test('buildRenderItems — task-notification (done) produz item kind=chip', () => {
  const items = buildRenderItems([userText(11, doneTaskNotificationXml)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'chip');
  if (items[0].kind === 'chip') {
    assert.equal(items[0].classifierKind, 'task-notification');
    assert.equal(items[0].chip.icon, '⚙️');
  }
});

// DS-71 round 9: channel-envelope deixou de virar chip universal (perdia
// player de áudio/imagem inline). Volta a emitir kind='channel' com o raw
// — render usa ChannelEnvelopeView com 5 sub-renders ricos.
test('buildRenderItems — channel-envelope (whatsapp) produz item kind=channel', () => {
  const raw = '<channel source="whatsapp" user="Rica" attachment_kind="audio" attachment_path="/tmp/a.ogg">manda status</channel>';
  const items = buildRenderItems([userText(12, raw)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'channel');
  if (items[0].kind === 'channel') {
    assert.match(items[0].raw, /<channel source="whatsapp"/);
  }
});

test('buildRenderItems — channel-envelope (telegram) produz item kind=channel', () => {
  const raw = '<channel source="telegram" user="Daniel">texto do telegram</channel>';
  const items = buildRenderItems([userText(13, raw)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'channel');
  if (items[0].kind === 'channel') {
    assert.match(items[0].raw, /<channel source="telegram"/);
  }
});

test('buildRenderItems — texto livre cai em kind=user (não vira chip)', () => {
  const items = buildRenderItems([userText(14, 'mensagem normal do Rica')]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'user');
});

test('buildRenderItems — meta.kind=wakeup-dynamic vira item kind=synthetic', () => {
  const m: MessagePayload = {
    ...userText(15, '<<autonomous-loop-dynamic>>'),
    meta: { kind: 'wakeup-dynamic', raw_text: '<<autonomous-loop-dynamic>>' },
  };
  const items = buildRenderItems([m]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'synthetic');
  if (items[0].kind === 'synthetic') {
    assert.equal(items[0].syntheticKind, 'wakeup-dynamic');
    assert.equal(items[0].rawText, '<<autonomous-loop-dynamic>>');
  }
});

test('buildRenderItems — meta.kind=stt vira item kind=synthetic com rawText preservado', () => {
  const m: MessagePayload = {
    ...userText(16, '🎙 abrir relatório'),
    meta: { kind: 'stt', raw_text: '🎙 abrir relatório' },
  };
  const items = buildRenderItems([m]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'synthetic');
  if (items[0].kind === 'synthetic') {
    assert.equal(items[0].syntheticKind, 'stt');
    assert.equal(items[0].rawText, '🎙 abrir relatório');
  }
});

test('deriveSubagentStatusesFromMessages — recupera tokens e prompt do resultado', () => {
  const prompt = 'analisar pílula';
  const messages: MessagePayload[] = [
    message({
      id: 20,
      uuid: 'agent-tool',
      kind: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu-agent',
          name: 'Agent',
          input: {
            subagent_type: 'code-reviewer',
            description: 'revisar pílula',
            prompt,
          },
        }],
      },
    }),
    message({
      id: 21,
      uuid: 'side-root',
      kind: 'user',
      is_sidechain: true,
      agent_id: 'agent-1',
      message: { role: 'user', content: prompt },
    }),
    message({
      id: 22,
      uuid: 'tool-result',
      kind: 'user',
      parent_uuid: 'agent-tool',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu-agent', content: 'done' }],
      },
      tool_use_result: {
        status: 'completed',
        agentId: 'agent-1',
        agentType: 'code-reviewer',
        prompt,
        totalDurationMs: 12_345,
        totalTokens: 9876,
        totalToolUseCount: 2,
      },
    }),
  ];

  const statuses = deriveSubagentStatusesFromMessages(messages);
  const entry = statuses.get('side-root');

  assert.equal(entry?.status, 'completed');
  assert.equal(entry?.agent_type, 'code-reviewer');
  assert.equal(entry?.description, 'revisar pílula');
  assert.equal(entry?.prompt, prompt);
  assert.equal(entry?.total_tokens, 9876);
  assert.equal(entry?.total_tool_use_count, 2);
  assert.equal(entry?.duration_ms, 12_345);
});

test('deriveSubagentStatusesFromMessages — recupera metadados enquanto subagente roda', () => {
  const prompt = 'mapear input do cockpit';
  const messages: MessagePayload[] = [
    message({
      id: 30,
      uuid: 'agent-tool-active',
      kind: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu-agent-active',
          name: 'Agent',
          input: {
            subagent_type: 'Explore',
            description: 'Mapear envio cockpit→CC',
            prompt,
          },
        }],
      },
    }),
    message({
      id: 31,
      uuid: 'side-active-root',
      kind: 'user',
      is_sidechain: true,
      agent_id: 'agent-active-1',
      message: { role: 'user', content: prompt },
    }),
    message({
      id: 32,
      uuid: 'side-active-tool',
      kind: 'assistant',
      is_sidechain: true,
      parent_uuid: 'side-active-root',
      agent_id: 'agent-active-1',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu-read',
          name: 'Read',
          input: {
            file_path: '/home/clawd/repos/grupo_borges/apps/api/routers/agents.py',
          },
        }],
      },
    }),
  ];

  const statuses = deriveSubagentStatusesFromMessages(messages);
  const entry = statuses.get('side-active-root');

  assert.equal(entry?.status, 'active');
  assert.equal(entry?.agent_type, 'Explore');
  assert.equal(entry?.description, 'Mapear envio cockpit→CC');
  assert.equal(entry?.prompt, prompt);
  assert.equal(entry?.agent_id, 'agent-active-1');
  assert.equal(entry?.current_tool, 'Read');
  assert.equal(entry?.current_tool_summary, '/home/clawd/repos/grupo_borges/apps/api/routers/agents.py');
});

/* -------------------------------------------------------------------------- */
/* buildToolResultLookup — o `rich` (tool_use_result cru) chega ao lookup      */
/* Plano: docs/cockpit-v2-plano-tool-use-result.md (D1-D5, revisão da Tara).   */
/* -------------------------------------------------------------------------- */

function mensagemComResult(
  id: number,
  toolUseId: string,
  extras?: {
    toolUseResult?: unknown;
    content?: string;
    isError?: boolean;
    results?: Array<{ id: string; content: string; isError?: boolean }>;
  },
): MessagePayload {
  const parts = (extras?.results ?? [{ id: toolUseId, content: extras?.content ?? 'saida', isError: extras?.isError }]).map((r) => ({
    type: 'tool_result',
    tool_use_id: r.id,
    content: r.content,
    ...(r.isError !== undefined ? { is_error: r.isError } : {}),
  }));
  // Via JSON de propósito: os testes 3 e 5 usam formas que o tipo
  // `ToolUseResult` não declara — é exatamente o que `rich?: unknown` existe
  // pra carregar sem fraude de cast.
  return JSON.parse(JSON.stringify({
    ...baseMessage,
    id,
    uuid: `uuid-rich-${id}`,
    kind: 'user',
    message: { role: 'user', content: parts },
    ...(extras?.toolUseResult !== undefined ? { tool_use_result: extras.toolUseResult } : {}),
  })) as MessagePayload;
}

test('lookup — rich atravessa da fixture real (família fetch)', () => {
  const fixture = JSON.parse(readFileSync(
    join(import.meta.dirname, '../../../fixtures/cockpit-v2/familias/result__bytes_code_codeText_durationMs_result.json'),
    'utf8',
  )) as { evento: MessagePayload };

  const lookup = buildToolResultLookup([fixture.evento]);
  const entry = lookup.get('toolu_01FRWfj5j384Pebxk6bLdKce');

  assert.ok(entry);
  assert.ok(Object.hasOwn(entry, 'rich'), 'a propriedade rich tem de existir');
  const rich = entry.rich as { code: number; bytes: number };
  assert.equal(rich.code, 200);
  assert.equal(rich.bytes, 2954287);
});

test('lookup — sem tool_use_result a entrada NÃO tem a propriedade rich (D2)', () => {
  const lookup = buildToolResultLookup([mensagemComResult(1, 'toolu-sem-rich')]);
  const entry = lookup.get('toolu-sem-rich');

  assert.ok(entry);
  assert.equal(Object.hasOwn(entry, 'rich'), false);
  assert.equal('rich' in entry, false);
  assert.equal(entry.content, 'saida');
  assert.equal(entry.isError, false);
});

test('lookup — mensagem com >1 tool_result não anexa rich a nenhum (D3)', () => {
  const lookup = buildToolResultLookup([
    mensagemComResult(2, 'ignorado', {
      toolUseResult: { status: 'completed' },
      results: [
        { id: 'toolu-a', content: 'saida a' },
        { id: 'toolu-b', content: 'saida b' },
      ],
    }),
  ]);

  assert.ok(lookup.get('toolu-a'));
  assert.ok(lookup.get('toolu-b'));
  assert.equal(Object.hasOwn(lookup.get('toolu-a')!, 'rich'), false);
  assert.equal(Object.hasOwn(lookup.get('toolu-b')!, 'rich'), false);
});

test('lookup — duplicata: evento posterior sem rico preserva o rico anterior (D4)', () => {
  const lookup = buildToolResultLookup([
    mensagemComResult(3, 'toolu-dup', {
      toolUseResult: { status: 'completed', totalTokens: 10 },
      content: 'saida-ANTIGA',
      isError: false,
    }),
    mensagemComResult(4, 'toolu-dup', { content: 'saida-NOVA', isError: true }),
  ]);
  const entry = lookup.get('toolu-dup');

  assert.ok(entry);
  // Valores DIFERENTES de propósito (revisão Tara): se uma regressão
  // preservar os campos do primeiro evento, este teste pega.
  assert.equal(entry.content, 'saida-NOVA'); // o texto do último ganha
  assert.equal(entry.isError, true); // o isError do último também
  const rich = entry.rich as { totalTokens: number };
  assert.equal(rich.totalTokens, 10); // mas o rico do primeiro sobrevive
});

test('lookup — duplicata: evento posterior COM rico substitui (D4)', () => {
  const lookup = buildToolResultLookup([
    mensagemComResult(5, 'toolu-dup2', {
      toolUseResult: { status: 'running' },
      content: 'saida-PARCIAL',
    }),
    mensagemComResult(6, 'toolu-dup2', {
      toolUseResult: { status: 'completed' },
      content: 'saida-FINAL',
    }),
  ]);
  const entry = lookup.get('toolu-dup2')!;
  assert.equal(entry.content, 'saida-FINAL');
  const rich = entry.rich as { status: string };
  assert.equal(rich.status, 'completed');
});

test('lookup — multi-result reusando o MESMO id não herda rich velho (D3×D4)', () => {
  // Caso da revisão Tara: mensagem com 2 parts tool_result do MESMO
  // tool_use_id e um rich pré-existente no mapa. O D4 herda rich entre
  // EVENTOS (mesmo id = mesma execução), mas dentro de UMA mensagem
  // multi-result a associação é ambígua por definição — herdar aqui
  // contradiz o D3. Regra: a herança só vale quando a mensagem atual tem
  // exatamente 1 result.
  const lookup = buildToolResultLookup([
    mensagemComResult(7, 'toolu-mix', { toolUseResult: { status: 'completed', totalTokens: 99 } }),
    mensagemComResult(8, 'ignorado', {
      results: [
        { id: 'toolu-mix', content: 'primeira saida' },
        { id: 'toolu-mix', content: 'segunda saida' },
      ],
    }),
  ]);
  const entry = lookup.get('toolu-mix')!;
  assert.equal(entry.content, 'segunda saida'); // último part ganha o texto
  assert.equal(Object.hasOwn(entry, 'rich'), false); // mas NÃO herda o rich
});

test('lookup — tool_use_result em forma inesperada atravessa como está (D1)', () => {
  const lookup = buildToolResultLookup([
    mensagemComResult(9, 'toolu-estranho', { toolUseResult: 'uma string, não um objeto' }),
  ]);
  assert.equal(lookup.get('toolu-estranho')!.rich, 'uma string, não um objeto');
});

test('lookup — message null + tool_use_result null não quebra (borda__content_none)', () => {
  const nula = JSON.parse(JSON.stringify({
    ...baseMessage,
    id: 8,
    uuid: 'uuid-nula',
    kind: 'user',
    message: null,
    tool_use_result: null,
  })) as MessagePayload;

  const lookup = buildToolResultLookup([nula]);
  assert.equal(lookup.size, 0);
});

