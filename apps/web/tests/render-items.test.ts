import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MessagePayload } from '../lib/messages-types.ts';
import { buildRenderItems } from '../lib/render-items.ts';
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

test('buildRenderItems — channel-envelope (whatsapp) produz item kind=chip', () => {
  const raw = '<channel source="whatsapp" user="Rica" attachment_kind="audio" attachment_path="/tmp/a.ogg">manda status</channel>';
  const items = buildRenderItems([userText(12, raw)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'chip');
  if (items[0].kind === 'chip') {
    assert.equal(items[0].classifierKind, 'channel-envelope');
    assert.equal(items[0].chip.icon, '⚙️');
    assert.equal(items[0].chip.label, 'Channel: whatsapp Rica');
  }
});

test('buildRenderItems — channel-envelope (telegram) produz item kind=chip', () => {
  const raw = '<channel source="telegram" user="Daniel">texto do telegram</channel>';
  const items = buildRenderItems([userText(13, raw)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'chip');
  if (items[0].kind === 'chip') {
    assert.equal(items[0].classifierKind, 'channel-envelope');
    assert.equal(items[0].chip.icon, '⚙️');
  }
});

test('buildRenderItems — texto livre cai em kind=user (não vira chip)', () => {
  const items = buildRenderItems([userText(14, 'mensagem normal do Rica')]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'user');
});
