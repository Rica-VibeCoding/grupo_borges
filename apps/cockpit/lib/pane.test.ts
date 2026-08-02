import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lePane } from './pane.ts';

// Amostra real, colhida do /api/fleet em 30/07: o statusline do CC apontando a
// sessão no claude.ai. Repare que NÃO há byte ESC — o backend já o removeu, e é
// exatamente isso que fez o primeiro limpador (que exigia \x1b) virar no-op.
const REAL =
  '  Opus 5 (1M context) - 09:48:12 - [###] 21%\n' +
  ']8;id=h5o667;https://claude.ai/code/session_01G1qjYg4gSQ5G72M79iri92\\/rc]8;;\\\n' +
  '  bypass permissions on';

test('extrai o link OSC 8 e não deixa escape na tela', () => {
  const trechos = lePane(REAL);
  const juntos = trechos.map((t) => t.texto).join('');

  assert.ok(!juntos.includes(']8;'), 'sobrou abertura de OSC 8 no texto');
  assert.ok(!juntos.includes('\\\n'), 'sobrou o terminador órfão');

  const links = trechos.filter((t) => t.tipo === 'link');
  assert.equal(links.length, 1);
  assert.equal(
    links[0]!.href,
    'https://claude.ai/code/session_01G1qjYg4gSQ5G72M79iri92',
  );
  assert.equal(links[0]!.texto, '/rc');
});

test('texto sem OSC 8 atravessa intacto', () => {
  const cru = 'Bash(npx tsc --noEmit)\n  --- tsc ---\n';
  assert.deepEqual(lePane(cru), [{ tipo: 'texto', texto: cru }]);
});

test('abertura sem fechamento (pane truncado) não vaza', () => {
  const trechos = lePane('antes ]8;id=x;https://exemplo.test\\ depois');
  const juntos = trechos.map((t) => t.texto).join('');
  assert.ok(!juntos.includes(']8;'));
  assert.equal(juntos, 'antes  depois');
});

test('esquema perigoso não vira link', () => {
  const trechos = lePane(']8;id=x;javascript:alert(1)\\clique]8;;\\');
  assert.equal(trechos.filter((t) => t.tipo === 'link').length, 0);
  assert.ok(!trechos.map((t) => t.texto).join('').includes('javascript:'));
});

test('dois links na mesma captura', () => {
  const trechos = lePane(
    ']8;id=a;https://um.test\\A]8;;\\ meio ]8;id=b;https://dois.test\\B]8;;\\',
  );
  const links = trechos.filter((t) => t.tipo === 'link');
  assert.equal(links.length, 2);
  assert.deepEqual(
    links.map((l) => l.texto),
    ['A', 'B'],
  );
  assert.ok(trechos.some((t) => t.tipo === 'texto' && t.texto.includes('meio')));
});

/* ------------------------------------------------------------------------ */
/* O chrome do CLI não entra no feed — ordem do Rica, 02/08                  */
/* ------------------------------------------------------------------------ */

test('statusline, modo, dica e prompt vazio somem; o log fica', () => {
  const cru =
    '  Opus 5 (1M context) - 09:48:12 - [###] 21%\n' +
    '⏵⏵ accept edits on\n' +
    '  bypass permissions on\n' +
    'Tip: Use /btw to add a topic\n' +
    '✻ Worked for 3m 12s\n' +
    '❯ \n' +
    '  Esc to interrupt\n' +
    'total 48\n' +
    '-rw-r--r-- 1 clawd staff 231 Aug 2 09:41 README.md\n';
  const juntos = lePane(cru)
    .map((t) => t.texto)
    .join('');

  for (const chrome of ['[###]', '⏵⏵', 'bypass permissions', 'Tip:', 'Worked for', '❯', 'Esc to interrupt']) {
    assert.ok(!juntos.includes(chrome), `chrome vazou: ${chrome}`);
  }
  assert.ok(juntos.includes('total 48'));
  assert.ok(juntos.includes('README.md'));
});

test('o separador de caixa (U+2500) sai, mas hífen ASCII não é separador', () => {
  const cru = 'antes\n──────────────\n--- tsc ---\ndepois';
  const juntos = lePane(cru)
    .map((t) => t.texto)
    .join('');
  assert.ok(!juntos.includes('──────'), 'separador de caixa ficou');
  assert.ok(juntos.includes('--- tsc ---'), 'hífen de log foi confundido com caixa');
});

test('runs de linhas em branco colapsam em uma', () => {
  const cru = 'primeiro\n\n\n\n\nsegundo\n';
  const [trecho] = lePane(cru);
  assert.deepEqual(trecho, { tipo: 'texto', texto: 'primeiro\n\nsegundo\n' });
});

test('o link OSC 8 sobrevive mesmo morando numa linha de chrome', () => {
  // A statusline inteira é chrome — menos o link da sessão, que é a única
  // ponte da tela para o claude.ai.
  const links = lePane(REAL).filter((t) => t.tipo === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0]!.href, 'https://claude.ai/code/session_01G1qjYg4gSQ5G72M79iri92');
});
