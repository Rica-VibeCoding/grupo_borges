import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MessagePayload } from '../lib/messages-types.ts';
import { buildRenderItems, deriveSubagentStatusesFromMessages } from '../lib/render-items.ts';
import {
  doneTaskNotificationXml,
  failedTaskNotificationXml,
} from '../lib/__fixtures__/task-notification.fixtures.ts';

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
