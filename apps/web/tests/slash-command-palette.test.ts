import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applySlashSelection,
  detectSlashContext,
  filterSlashCommands,
  getSlashCommands,
} from '../lib/slash-command-palette-logic.ts';

// A4: cobertura pros helpers puros do palette. Ignora render React — focam
// nas funções de detecção (caret/cursor), filtragem (prefix match) e
// aplicação (string slicing). Bug aqui = palette dispara em URL ou
// silencia quando deveria abrir.

test('detectSlashContext — caret no meio de "/cle|ar" retorna query="cle"', () => {
  const text = '/clear';
  const ctx = detectSlashContext(text, 4);
  assert.ok(ctx);
  assert.equal(ctx.sliceStart, 0);
  assert.equal(ctx.query, 'cle');
});

test('detectSlashContext — "/" precedido de char não-whitespace (URL http://) não dispara', () => {
  const text = 'http://example.com';
  const ctx = detectSlashContext(text, text.length);
  assert.equal(ctx, null);
});

test('detectSlashContext — caret=0 retorna null', () => {
  assert.equal(detectSlashContext('/clear', 0), null);
});

test('getSlashCommands — injeta nome do agente em todos exceto reload-plugins', () => {
  const cmds = getSlashCommands('Pavan');
  const byValue = Object.fromEntries(cmds.map((c) => [c.value, c.desc]));
  for (const value of ['clear', 'compact', 'memory', 'restart', 'skill', 'status']) {
    assert.match(
      byValue[value],
      /Pavan/,
      `comando /${value} deveria conter "Pavan" na descrição, mas é: "${byValue[value]}"`,
    );
  }
  assert.doesNotMatch(byValue['reload-plugins'], /Pavan/);
});

test('filterSlashCommands — agentName vazio cai no fallback "agente"', () => {
  const filtered = filterSlashCommands('clear', '');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].value, 'clear');
  assert.match(filtered[0].desc, /\bagente\b/);
});

test('applySlashSelection — cmd com value vazio resulta em "/ " (reverte payload)', () => {
  const text = '/cle';
  const result = applySlashSelection(text, 4, 0, { value: '', label: '', desc: '' });
  assert.equal(result.text, '/ ');
  assert.equal(result.caret, 2);
});
