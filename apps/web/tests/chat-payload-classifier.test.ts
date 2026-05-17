import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ContentPart, MessagePayload } from '../lib/messages-types.ts';
import { classifyMessage } from '../lib/chat-payload-classifier.ts';
import {
  doneTaskNotificationXml,
  failedTaskNotificationXml,
} from '../lib/__fixtures__/task-notification.fixtures.ts';

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

function msg(
  overrides: Partial<MessagePayload> & {
    message?: MessagePayload['message'];
  },
): MessagePayload {
  return {
    ...baseMessage,
    ...overrides,
    message: overrides.message ?? { role: 'user', content: '' },
  };
}

function userText(id: number, content: string): MessagePayload {
  return msg({
    id,
    uuid: `uuid-${id}`,
    kind: 'user',
    message: { role: 'user', content },
  });
}

function assistantParts(id: number, content: ContentPart[]): MessagePayload {
  return msg({
    id,
    uuid: `uuid-${id}`,
    kind: 'assistant',
    message: { role: 'assistant', content },
  });
}

function toolResult(id: number, toolUseId: string, content: string): MessagePayload {
  return msg({
    id,
    uuid: `uuid-${id}`,
    kind: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
    },
  });
}

function slashRaw(name: string, stdout = '', args = ''): string {
  return [
    `<command-name>${name}</command-name>`,
    `<command-message>${name.slice(1)}</command-message>`,
    `<command-args>${args}</command-args>`,
    stdout ? `<local-command-stdout>${stdout}</local-command-stdout>` : '',
  ].filter(Boolean).join('\n');
}

test('classifyMessage — slash /clear vira chip com icon mapeado', () => {
  const payload = classifyMessage(userText(10, slashRaw('/clear')));
  assert.equal(payload.kind, 'slash');
  assert.deepEqual(payload.chip, { icon: '🧹', label: '/clear', summary: '' });
  assert.equal(payload.expandBody, '');
});

test('classifyMessage — slash /reload-plugins resume primeira linha do stdout', () => {
  const payload = classifyMessage(userText(11, slashRaw(
    '/reload-plugins',
    'Reloaded: 2 plugins\nSecond line',
  )));
  assert.equal(payload.kind, 'slash');
  assert.equal(payload.chip.icon, '↻');
  assert.equal(payload.chip.summary, 'Reloaded: 2 plugins');
  assert.equal(payload.expandBody, 'Reloaded: 2 plugins\nSecond line');
});

test('classifyMessage — slash custom usa raio', () => {
  const payload = classifyMessage(userText(12, slashRaw('/project:ship-it', 'queued')));
  assert.equal(payload.kind, 'slash');
  assert.equal(payload.chip.icon, '⚡');
  assert.equal(payload.chip.label, '/project:ship-it');
});

test('classifyMessage — system-reminder isolado suprime', () => {
  const payload = classifyMessage(userText(13, '<system-reminder>não renderizar</system-reminder>'));
  assert.equal(payload.kind, 'suppress');
  assert.equal(payload.chip, null);
});

test('classifyMessage — content vazio suprime', () => {
  const payload = classifyMessage(userText(14, '   \n\t'));
  assert.equal(payload.kind, 'suppress');
});

test('classifyMessage — texto livre vira plain', () => {
  const payload = classifyMessage(userText(15, 'mensagem normal do usuário'));
  assert.equal(payload.kind, 'plain');
  assert.equal(payload.expandBody, null);
});

test('classifyMessage — tag inline em texto livre não vira slash', () => {
  const payload = classifyMessage(userText(16, 'olha <command-name>/model</command-name> aqui'));
  assert.equal(payload.kind, 'plain');
});

test('classifyMessage — Skill usa nome e corpo da próxima resposta assistant', () => {
  const skillUse = assistantParts(20, [{
    type: 'tool_use',
    id: 'toolu-skill',
    name: 'Skill',
    input: {
      skill_name: 'imagegen',
      skill: 'Gerar imagem raster com prompt detalhado',
    },
  }]);
  const next = assistantParts(21, [{ type: 'text', text: 'Skill carregada e pronta.' }]);
  const payload = classifyMessage(skillUse, next);
  assert.equal(payload.kind, 'skill');
  assert.deepEqual(payload.chip, {
    icon: '🔧',
    label: 'Skill: imagegen',
    summary: 'Gerar imagem raster com prompt detalhado',
  });
  assert.equal(payload.expandBody, 'Skill carregada e pronta.');
});

test('classifyMessage — Skill cai para description quando skill não existe', () => {
  const payload = classifyMessage(assistantParts(22, [{
    type: 'tool_use',
    id: 'toolu-skill',
    name: 'Skill',
    input: { name: 'github', description: 'Inspecionar PRs e issues' },
  }]));
  assert.equal(payload.kind, 'skill');
  assert.equal(payload.chip.label, 'Skill: github');
  assert.equal(payload.chip.summary, 'Inspecionar PRs e issues');
});

test('classifyMessage — tool com resultado grande vira chip', () => {
  const use = assistantParts(30, [{
    type: 'tool_use',
    id: 'toolu-big',
    name: 'Bash',
    input: { command: 'pnpm test' },
  }]);
  const big = `Primeira linha do resultado\n${'x'.repeat(310)}`;
  const payload = classifyMessage(use, toolResult(31, 'toolu-big', big));
  assert.equal(payload.kind, 'tool');
  assert.equal(payload.chip.icon, '⚙️');
  assert.equal(payload.chip.label, 'Tool: Bash');
  assert.equal(payload.chip.summary, 'Primeira linha do resultado');
  assert.equal(payload.expandBody, big);
});

test('classifyMessage — tool com resultado pequeno não vira chip grande', () => {
  const use = assistantParts(32, [{
    type: 'tool_use',
    id: 'toolu-small',
    name: 'Read',
    input: { file_path: 'x.ts' },
  }]);
  const payload = classifyMessage(use, toolResult(33, 'toolu-small', 'ok'));
  assert.equal(payload.kind, 'plain');
});

test('classifyMessage — tool sem resultado pareado fica plain', () => {
  const use = assistantParts(34, [{
    type: 'tool_use',
    id: 'toolu-a',
    name: 'Read',
    input: { file_path: 'x.ts' },
  }]);
  const payload = classifyMessage(use, toolResult(35, 'toolu-b', 'x'.repeat(400)));
  assert.equal(payload.kind, 'plain');
});

test('classifyMessage — sidechain isolado vira cluster 1x', () => {
  const payload = classifyMessage(msg({
    id: 40,
    uuid: 'uuid-40',
    kind: 'assistant',
    is_sidechain: true,
    message: { role: 'assistant', content: [{ type: 'text', text: 'subagent terminou' }] },
  }));
  assert.equal(payload.kind, 'sidechain-cluster');
  assert.equal(payload.chip.label, 'Subagent (1x)');
  assert.equal(payload.chip.summary, 'subagent terminou');
});

test('classifyMessage — sidechain consecutivo agrega nextMsg', () => {
  const first = msg({
    id: 41,
    uuid: 'uuid-41',
    kind: 'assistant',
    is_sidechain: true,
    message: { role: 'assistant', content: [{ type: 'text', text: 'primeiro output' }] },
  });
  const second = msg({
    id: 42,
    uuid: 'uuid-42',
    kind: 'assistant',
    is_sidechain: true,
    message: { role: 'assistant', content: [{ type: 'text', text: 'segundo output' }] },
  });
  const payload = classifyMessage(first, second);
  assert.equal(payload.kind, 'sidechain-cluster');
  assert.equal(payload.chip.label, 'Subagent (2x)');
  assert.equal(payload.expandBody, 'primeiro output\n\nsegundo output');
});

test('classifyMessage — channel whatsapp vira envelope clicável', () => {
  const payload = classifyMessage(userText(50, [
    '<channel source="whatsapp" user="Rica" attachment_kind="audio" attachment_path="/tmp/a.ogg">',
    'manda status',
    '</channel>',
  ].join('')));
  assert.equal(payload.kind, 'channel-envelope');
  assert.deepEqual(payload.chip, {
    icon: '📱',
    label: 'whatsapp Rica',
    summary: 'manda status',
  });
  assert.equal(payload.expandBody, 'manda status\nattachment_kind: audio\nattachment_path: /tmp/a.ogg');
});

test('classifyMessage — channel telegram usa icon próprio', () => {
  const payload = classifyMessage(userText(
    51,
    '<channel source="telegram" user="Daniel">texto do telegram</channel>',
  ));
  assert.equal(payload.kind, 'channel-envelope');
  assert.equal(payload.chip.icon, '✈️');
  assert.equal(payload.chip.label, 'telegram Daniel');
});

test('classifyMessage — task-notification failed vira chip vermelho', () => {
  const payload = classifyMessage(userText(52, failedTaskNotificationXml));
  assert.equal(payload.kind, 'task-notification');
  assert.deepEqual(payload.chip, {
    icon: '🔴',
    label: 'Task: Background command \'pnpm test\' failed wi',
    summary: 'failed: Background command \'pnpm test\' failed with exit code 144',
  });
  assert.match(payload.expandBody, /"taskId": "bzubuuj01"/);
  assert.match(payload.expandBody, /<task-notification>/);
});

test('classifyMessage — task-notification done vira chip verde', () => {
  const payload = classifyMessage(userText(53, doneTaskNotificationXml));
  assert.equal(payload.kind, 'task-notification');
  assert.deepEqual(payload.chip, {
    icon: '🟢',
    label: 'Task: Background command completed successfull',
    summary: 'done: Background command completed successfully',
  });
  assert.match(payload.expandBody, /"status": "done"/);
  assert.match(payload.expandBody, /<output-file>\/tmp\/done12345\/output<\/output-file>/);
});

test('classifyMessage — task-notification inline em texto livre permanece plain', () => {
  const payload = classifyMessage(userText(
    54,
    `antes\n${failedTaskNotificationXml}\ndepois`,
  ));
  assert.equal(payload.kind, 'plain');
});

test('classifyMessage — rawRef usa uuid original', () => {
  const payload = classifyMessage(userText(60, 'texto'));
  assert.equal(payload.rawRef, 'uuid-60');
});
