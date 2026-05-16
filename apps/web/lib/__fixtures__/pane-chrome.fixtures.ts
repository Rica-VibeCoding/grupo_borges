// Fixtures pra teste de pane-chrome.ts.
//
// Cada caso: `line` (string que aparece no excerpt) + `chrome` (bool —
// true: filtrar; false: preservar). JP-11 Fase 1.

export type FixtureCase = { name: string; line: string; chrome: boolean };

export const CHROME_FIXTURES: FixtureCase[] = [
  // ----- chrome real (DEVE filtrar) ---------------------------------------
  { name: 'statusline-opus', line: 'Opus 4.7 - 32:13 - [████░] 16%', chrome: true },
  { name: 'statusline-sonnet-1m', line: 'Sonnet 4.6 (1M context) - 05:42 - [...] 9%', chrome: true },
  { name: 'statusline-with-remote', line: 'Opus 4.7 - 12:00 - [█░░] 7% Remote Control active', chrome: true },
  { name: 'spinner-finished-with-glyph', line: '✻ Brewed for 5m 23s', chrome: true },
  { name: 'spinner-finished-with-bullet', line: '⏺ Cogitated for 1m · ↑ 2.7k tokens', chrome: true },
  { name: 'spinner-finished-bullet-thought', line: 'Boogieing for 12s · thought for 3s', chrome: true },
  { name: 'spinner-active-tokens', line: '· Boogieing… (1m 8s · ↓ 2.7k tokens · thought for 33s)', chrome: true },
  { name: 'spinner-active-flibbertigibbeting', line: '✻ Flibbertigibbeting… (45s · ↑ 1.2k tokens)', chrome: true },
  // Primeiros ticks antes do contador acumular `tokens` — caso pego no review.
  { name: 'spinner-active-no-tokens-yet', line: '✻ Thinking… (45s)', chrome: true },
  { name: 'spinner-active-time-only', line: '· Cogitating… (3s)', chrome: true },
  { name: 'remote-control-connecting', line: 'Remote Control connecting…', chrome: true },
  { name: 'bypass-permissions', line: '⏵⏵ bypass permissions on for this session', chrome: true },
  { name: 'separator-long', line: '────────────────────────────────', chrome: true },
  { name: 'separator-with-name', line: '── Daniel ──────────────────────', chrome: true },

  // ----- prosa do assistant (NÃO filtrar) ---------------------------------
  // Gap exato citado pelo Pavan: regex antiga bateria por causa de "X for Ns".
  { name: 'prosa-esperando-for-30s', line: 'esperando for 30 segundos antes de tentar de novo', chrome: false },
  { name: 'prosa-espera-for-2-min', line: 'espera for 2 min e me avisa', chrome: false },
  { name: 'prosa-aguardando-for', line: 'Aguardando for um momento o backend responder', chrome: false },
  { name: 'prosa-rodando-for', line: 'rodando for em loop em 30 iterações', chrome: false },
  // Verb-ed/ing sem glifo nem cauda — conservador: preservar.
  { name: 'prosa-Brewed-for-coffee', line: 'Brewed for 5 minutes the coffee is ready', chrome: false },
  // Conteúdo normal CC (resposta do assistant).
  { name: 'prosa-assistant-resposta', line: 'A função `parseAnsi` retorna um array de segmentos.', chrome: false },
  { name: 'prosa-codigo-bullet', line: '• fix(api): line_limit 80 → 200', chrome: false },
  { name: 'prosa-bullet-puro', line: '· implementar Fix #1', chrome: false },
  { name: 'prosa-vazio', line: '', chrome: false },
  { name: 'prosa-numero-percent', line: 'CPU em 16% no pico da consulta', chrome: false },
  { name: 'prosa-com-dash', line: 'O comando `tmux - capture-pane` exporta o histórico', chrome: false },
  { name: 'prosa-codigo-glifo', line: 'no manual o `⏺` significa parado', chrome: false },
];

export const ACTIVE_SPINNER_FIXTURES: FixtureCase[] = [
  // Última linha do excerpt — spinner ATIVO bate.
  { name: 'tail-active', line: 'foo\nbar\n· Boogieing… (10s · ↑ 500 tokens)', chrome: true },
  // Tail é spinner FINISHED — frame estável, não bate.
  { name: 'tail-finished', line: 'foo\nbar\n✻ Brewed for 5m 23s', chrome: false },
  // Tail é prosa normal — frame estável.
  { name: 'tail-prose', line: 'foo\nbar\nresposta normal aqui', chrome: false },
  // Empty trailing newlines — pula até achar linha não-vazia.
  { name: 'tail-empty-newlines', line: '· Boogieing… (5s · ↓ 100 tokens)\n\n\n', chrome: true },
  // Tail vazio total.
  { name: 'tail-empty', line: '\n\n\n', chrome: false },
];

export const ANSI_FIXTURES: Array<{ name: string; input: string; expect: Array<{ text: string; bold?: boolean; hasColor?: boolean }> }> = [
  { name: 'plain-text', input: 'hello world', expect: [{ text: 'hello world' }] },
  {
    name: 'red-then-reset',
    input: '\x1b[31merror\x1b[0m: ok',
    expect: [
      { text: 'error', hasColor: true },
      { text: ': ok' },
    ],
  },
  {
    name: 'bold-cyan',
    input: '\x1b[1;36mDaniel\x1b[0m',
    expect: [{ text: 'Daniel', bold: true, hasColor: true }],
  },
  {
    name: 'strip-cursor-moves',
    input: '\x1b[2J\x1b[H\x1b[31mhello\x1b[0m',
    expect: [{ text: 'hello', hasColor: true }],
  },
  // 256-color: code 38 consumido sem efeito (sem dep externa).
  {
    name: 'ignore-256-color',
    input: '\x1b[38;5;202mlaranja\x1b[0m',
    expect: [{ text: 'laranja' }],
  },
];
