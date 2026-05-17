import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseLocalCommand } from '../lib/slash-command-wrapper.ts';

test('parseLocalCommand — /clear sem stdout', () => {
  assert.deepEqual(
    parseLocalCommand([
      '<command-name>/clear</command-name>',
      '<command-message>clear</command-message>',
      '<command-args></command-args>',
    ].join('\n')),
    {
      name: '/clear',
      args: '',
      stdout: '',
      kind: 'native',
    },
  );
});

test('parseLocalCommand — /reload-plugins com stdout', () => {
  assert.deepEqual(
    parseLocalCommand([
      '<command-name>/reload-plugins</command-name>',
      '<command-message>reload-plugins</command-message>',
      '<command-args></command-args>',
      '<local-command-stdout>Reloaded: 2 plugins · 0 skills · 6 agents · 0 hooks</local-command-stdout>',
    ].join('\n')),
    {
      name: '/reload-plugins',
      args: '',
      stdout: 'Reloaded: 2 plugins · 0 skills · 6 agents · 0 hooks',
      kind: 'native',
    },
  );
});

test('parseLocalCommand — /compact', () => {
  assert.deepEqual(
    parseLocalCommand([
      '<command-name>/compact</command-name>',
      '<command-message>compact</command-message>',
      '<command-args></command-args>',
      '<local-command-stdout>Compacted conversation.</local-command-stdout>',
    ].join('\n')),
    {
      name: '/compact',
      args: '',
      stdout: 'Compacted conversation.',
      kind: 'native',
    },
  );
});

test('parseLocalCommand — /model', () => {
  assert.deepEqual(
    parseLocalCommand([
      '<command-name>/model</command-name>',
      '<command-message>model</command-message>',
      '<command-args>gpt-5.5</command-args>',
      '<local-command-stdout>Set model to gpt-5.5.</local-command-stdout>',
    ].join('\n')),
    {
      name: '/model',
      args: 'gpt-5.5',
      stdout: 'Set model to gpt-5.5.',
      kind: 'native',
    },
  );
});

test('parseLocalCommand — múltiplos wrappers consecutivos', () => {
  assert.deepEqual(
    parseLocalCommand([
      '<local-command-caveat>Caveat: generated locally.</local-command-caveat>',
      '<command-name>/status</command-name>',
      '<command-message>status</command-message>',
      '<command-args></command-args>',
      '<local-command-stdout>All agents reachable.</local-command-stdout>',
      '<system-reminder>Do not respond to this reminder.</system-reminder>',
    ].join('\n')),
    {
      name: '/status',
      args: '',
      stdout: 'All agents reachable.',
      kind: 'native',
    },
  );
});

test('parseLocalCommand — comando custom', () => {
  assert.deepEqual(
    parseLocalCommand([
      '<command-name>/project:ship-it</command-name>',
      '<command-message>project:ship-it</command-message>',
      '<command-args>--dry-run</command-args>',
      '<local-command-stdout>Queued custom command.</local-command-stdout>',
    ].join('\n')),
    {
      name: '/project:ship-it',
      args: '--dry-run',
      stdout: 'Queued custom command.',
      kind: 'custom',
    },
  );
});

test('parseLocalCommand — system-reminder isolado retorna null', () => {
  assert.equal(
    parseLocalCommand('<system-reminder>Some reminder text.</system-reminder>'),
    null,
  );
});

test('parseLocalCommand — texto livre com tag inline retorna null', () => {
  assert.equal(
    parseLocalCommand('olha esse XML: <command-name>/model</command-name>'),
    null,
  );
});

test('parseLocalCommand — string vazia retorna null', () => {
  assert.equal(parseLocalCommand(''), null);
});
