import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContextPct, type Agent } from './cockpit-types.ts';

function agente(campos: Partial<Agent>): Agent {
  return { slug: 'daniel', pane_excerpt: null, context_pct: null, ...campos } as Agent;
}

test('o que a API mediu vence a barra desenhada no terminal', () => {
  // Depois de um `/clear` o pane fica com a statusline da sessão MORTA até o
  // CC redesenhar — foi o 16% que o Rica viu no Canário com a conversa já
  // apagada. A API responde pela sessão que está no ar; o pane não sabe de
  // qual sessão é o que ele mostra.
  const pct = resolveContextPct(
    agente({ pane_excerpt: 'Opus 5 - 33:03 - [█░░░░░░░░░] 16%', context_pct: 0 }),
  );

  assert.equal(pct, 0);
});

test('sem número da API, a barra do terminal ainda serve', () => {
  const pct = resolveContextPct(
    agente({ pane_excerpt: 'Opus 5 - 33:03 - [███░░░░░░░] 31%', context_pct: null }),
  );

  assert.equal(pct, 31);
});

test('sem nenhuma das duas fontes não se inventa número', () => {
  assert.equal(resolveContextPct(agente({})), null);
});

test('no Codex a API é a única fonte — ele não tem statusline no pane', () => {
  const pct = resolveContextPct(
    agente({
      executor_kind: 'codex',
      pane_excerpt: 'Opus 5 - 33:03 - [█░░░░░░░░░] 16%',
      context_pct: 62.7,
    }),
  );

  assert.equal(pct, 62.7);
});
