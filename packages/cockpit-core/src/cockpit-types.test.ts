import assert from 'node:assert/strict';
import test from 'node:test';

import { parseModelFromPane, resolveContextPct, type Agent } from './cockpit-types.ts';

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

test('a API vence o pane — o texto do terminal não diz de qual sessão é', () => {
  const pct = resolveContextPct(
    agente({
      pane_excerpt: 'Opus 5 - 33:03 - [█░░░░░░░░░] 16%',
      context_pct: 62.7,
    }),
  );

  assert.equal(pct, 62.7);
});

test('o rótulo do modelo sai da statusline, não de qualquer menção no pane', () => {
  // O card da Tara mostrou "Sonnet 5" com ela rodando `gpt-5.6-terra[1m]`: o
  // regex varria o pane INTEIRO e o último match era a ajuda do `/effort`, que
  // lista os modelos onde o nível existe. A statusline dela não casa (o id do
  // proxy não é família Claude) — então o certo aqui é não achar nada e deixar
  // o card cair no `state_model`, que é quem sabe dizer "5.6 Terra".
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
