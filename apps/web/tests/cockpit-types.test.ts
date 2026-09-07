import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseModelFromPane,
  resolveContextPct,
  shortModelName,
} from '../lib/cockpit-types.ts';

test('shortModelName normaliza o id do Opus 5', () => {
  assert.equal(shortModelName('claude-opus-5'), 'Opus 5');
});

test('parseModelFromPane normaliza o id cru do Opus 5', () => {
  assert.equal(
    parseModelFromPane('claude-opus-5 - 02:50:23 - [##] 61%'),
    'Opus 5',
  );
});

test('parseModelFromPane mantém o formato amigável do Opus 5', () => {
  assert.equal(parseModelFromPane('Opus 5 - 02:50:23 - [##] 61%'), 'Opus 5');
});

test('resolveContextPct prioriza o percentual do painel', () => {
  const contextPct = resolveContextPct({
    pane_excerpt: 'Opus 4.8 - [███░░░░░░░] 32%',
    context_pct: 28,
  });

  assert.equal(contextPct, 32);
});

test('resolveContextPct usa o percentual da API quando a captura oscila', () => {
  const contextPct = resolveContextPct({
    pane_excerpt: 'captura parcial sem a linha de contexto',
    context_pct: 28,
  });

  assert.equal(contextPct, 28);
});

test('o rótulo do modelo sai da statusline, não de qualquer menção no pane', () => {
  // Mesmo defeito que o v2 tinha: o regex varria o pane INTEIRO e o último match
  // era a ajuda do `/effort`, que lista os modelos onde o nível existe. O card da
  // Tara mostrou "Sonnet 5" com ela em `gpt-5.6-terra[1m]`. A statusline dela não
  // casa (o id do proxy não é família Claude) — o certo é devolver null e deixar
  // o card cair no `state_model`.
  const pane = [
    '❯ /effort xhigh',
    '  ⎿  xhigh (saved as your default for new sessions): Deeper reasoning than high, just below maximum (Fable 5, Opus 4.7+, Sonnet 5)',
    '  gpt-5.6-terra[1m] - 27:41:19 - [█░░░░░░░░░] 15%',
  ].join('\n');

  assert.equal(parseModelFromPane(pane), null);
});

test('menção de modelo no texto não derruba a statusline que está embaixo', () => {
  const pane = [
    '  ⎿  o Opus 4.5 saiu do roteamento',
    '  Sonnet 4.6 (200k context) - [███░░░░░░░] 32%',
  ].join('\n');

  assert.equal(parseModelFromPane(pane), 'Sonnet 4.6');
});
