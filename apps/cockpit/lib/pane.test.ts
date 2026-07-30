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
