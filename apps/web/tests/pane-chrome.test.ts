// Rodar: `node --test tests/pane-chrome.test.ts` (Node 22.22+, strip-types default).
//
// JP-11 Fase 1 — DS-58.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isChromeLine,
  stripChrome,
  endsWithActiveSpinner,
  parseAnsi,
} from '../lib/pane-chrome.ts';
import {
  CHROME_FIXTURES,
  ACTIVE_SPINNER_FIXTURES,
  ANSI_FIXTURES,
} from '../lib/__fixtures__/pane-chrome.fixtures.ts';

test('isChromeLine — fixtures cobrem chrome vs prosa', () => {
  const failed: string[] = [];
  for (const fx of CHROME_FIXTURES) {
    const got = isChromeLine(fx.line);
    if (got !== fx.chrome) {
      failed.push(`${fx.name}: esperado chrome=${fx.chrome}, got ${got} (${JSON.stringify(fx.line)})`);
    }
  }
  assert.equal(failed.length, 0, `\n${failed.join('\n')}`);
});

test('stripChrome — preserva prosa, remove chrome, colapsa em linhas vazias', () => {
  const input = [
    'Opus 4.7 - 12:00 - [██░] 22%',
    '',
    'olá Daniel, esperando for 30 segundos',
    '✻ Brewed for 5m 23s',
    'segue o relatório:',
  ].join('\n');
  const out = stripChrome(input);
  assert.match(out, /esperando for 30 segundos/);
  assert.match(out, /segue o relatório:/);
  assert.doesNotMatch(out, /Opus 4\.7/);
  assert.doesNotMatch(out, /Brewed for 5m/);
});

test('endsWithActiveSpinner — só true quando última linha não-vazia é spinner ativo', () => {
  for (const fx of ACTIVE_SPINNER_FIXTURES) {
    assert.equal(endsWithActiveSpinner(fx.line), fx.chrome, fx.name);
  }
});

test('parseAnsi — cores básicas + bold + reset, ignora 256-color/cursor moves', () => {
  for (const fx of ANSI_FIXTURES) {
    const segs = parseAnsi(fx.input);
    assert.equal(segs.length, fx.expect.length, `${fx.name}: segments=${segs.length}, esperado=${fx.expect.length}`);
    for (let i = 0; i < segs.length; i++) {
      const got = segs[i];
      const want = fx.expect[i];
      assert.equal(got.text, want.text, `${fx.name}[${i}] text`);
      if (want.bold !== undefined) assert.equal(got.bold === true, want.bold === true, `${fx.name}[${i}] bold`);
      if (want.hasColor !== undefined) assert.equal(typeof got.color === 'string', want.hasColor, `${fx.name}[${i}] hasColor`);
    }
  }
});

test('parseAnsi — string vazia retorna array vazio', () => {
  assert.deepEqual(parseAnsi(''), []);
});
