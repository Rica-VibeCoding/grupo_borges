import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContextPct } from '../lib/cockpit-types.ts';

test('resolveContextPct prioriza o percentual do painel', () => {
  const contextPct = resolveContextPct({
    executor_kind: null,
    pane_excerpt: 'Opus 4.8 - [███░░░░░░░] 32%',
    context_pct: 28,
  });

  assert.equal(contextPct, 32);
});

test('resolveContextPct usa o percentual da API quando a captura oscila', () => {
  const contextPct = resolveContextPct({
    executor_kind: null,
    pane_excerpt: 'captura parcial sem a linha de contexto',
    context_pct: 28,
  });

  assert.equal(contextPct, 28);
});

test('resolveContextPct mantém Codex sem percentual estimado', () => {
  const contextPct = resolveContextPct({
    executor_kind: 'codex',
    pane_excerpt: 'Opus 4.8 - [███░░░░░░░] 32%',
    context_pct: 28,
  });

  assert.equal(contextPct, null);
});
