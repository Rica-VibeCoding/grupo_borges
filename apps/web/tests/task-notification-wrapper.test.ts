import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTaskNotification } from '../lib/task-notification-wrapper.ts';
import { monitorTaskNotificationXml } from '../lib/__fixtures__/task-notification.fixtures.ts';

// A3: cobertura unitária pro parser de `<task-notification>`. Foca em
// shapes que o classifier delega cegamente — tag ausente, ordem variável,
// caracteres especiais no summary, whitespace anômalo.

const FULL_ENVELOPE = [
  '<task-notification>',
  '<task-id>tsk-001</task-id>',
  '<tool-use-id>toolu_01abc</tool-use-id>',
  '<output-file>/tmp/tsk-001/output</output-file>',
  '<status>done</status>',
  '<summary>command completed successfully</summary>',
  '</task-notification>',
].join('\n');

test('parseTaskNotification — envelope completo (5 campos) retorna ParsedTaskNotification', () => {
  const parsed = parseTaskNotification(FULL_ENVELOPE);
  assert.ok(parsed);
  assert.equal(parsed.kind, 'background');
  assert.equal(parsed.taskId, 'tsk-001');
  if (parsed.kind === 'background') {
    assert.equal(parsed.toolUseId, 'toolu_01abc');
    assert.equal(parsed.outputFile, '/tmp/tsk-001/output');
    assert.equal(parsed.status, 'done');
  }
  assert.equal(parsed.summary, 'command completed successfully');
});

test('parseTaskNotification — campo status ausente retorna null', () => {
  const missingStatus = [
    '<task-notification>',
    '<task-id>tsk-002</task-id>',
    '<tool-use-id>toolu_02</tool-use-id>',
    '<output-file>/tmp/x</output-file>',
    '<summary>sem status</summary>',
    '</task-notification>',
  ].join('\n');
  assert.equal(parseTaskNotification(missingStatus), null);
});

test('parseTaskNotification — tags fora de ordem ainda parseiam (ordem não importa)', () => {
  const reordered = [
    '<task-notification>',
    '<summary>ordem invertida</summary>',
    '<status>failed</status>',
    '<output-file>/tmp/y</output-file>',
    '<tool-use-id>toolu_03</tool-use-id>',
    '<task-id>tsk-003</task-id>',
    '</task-notification>',
  ].join('\n');
  const parsed = parseTaskNotification(reordered);
  assert.ok(parsed);
  assert.equal(parsed.kind, 'background');
  assert.equal(parsed.taskId, 'tsk-003');
  if (parsed.kind === 'background') {
    assert.equal(parsed.status, 'failed');
  }
  assert.equal(parsed.summary, 'ordem invertida');
});

test('parseTaskNotification — summary com "<" / ">" no corpo (não fecha tag) parseia', () => {
  const withAngleBrackets = [
    '<task-notification>',
    '<task-id>tsk-004</task-id>',
    '<tool-use-id>toolu_04</tool-use-id>',
    '<output-file>/tmp/z</output-file>',
    '<status>done</status>',
    '<summary>5 > 3 && 2 < 4 (math test)</summary>',
    '</task-notification>',
  ].join('\n');
  const parsed = parseTaskNotification(withAngleBrackets);
  assert.ok(parsed);
  assert.equal(parsed.summary, '5 > 3 && 2 < 4 (math test)');
});

test('parseTaskNotification — whitespace anômalo entre tags parseia', () => {
  const noisyWhitespace = '<task-notification>\n\n\n   <task-id>  tsk-005   </task-id>\n\t\t<tool-use-id>\ntoolu_05\n</tool-use-id>\n   <output-file>/tmp/w</output-file>\n<status>\trunning\t</status>\n<summary>   trimmed   </summary>\n\n</task-notification>';
  const parsed = parseTaskNotification(noisyWhitespace);
  assert.ok(parsed);
  assert.equal(parsed.kind, 'background');
  assert.equal(parsed.taskId, 'tsk-005');
  if (parsed.kind === 'background') {
    assert.equal(parsed.toolUseId, 'toolu_05');
    assert.equal(parsed.status, 'running');
  }
  assert.equal(parsed.summary, 'trimmed');
});

test('parseTaskNotification — monitor event com texto livre após tags parseia', () => {
  const parsed = parseTaskNotification(monitorTaskNotificationXml);
  assert.ok(parsed);
  assert.equal(parsed.kind, 'monitor');
  assert.equal(parsed.taskId, 'bvhvvwlz8');
  assert.equal(parsed.summary, 'Monitor event: "Tara bmac929z9 — eventos-chave (v2)"');
  if (parsed.kind === 'monitor') {
    assert.equal(parsed.event, 'REPORT_READY: /tmp/tara-ios-form-bar.md (5882 bytes)');
  }
});

test('parseTaskNotification — string vazia retorna null', () => {
  assert.equal(parseTaskNotification(''), null);
  assert.equal(parseTaskNotification('   \n\t  '), null);
});
