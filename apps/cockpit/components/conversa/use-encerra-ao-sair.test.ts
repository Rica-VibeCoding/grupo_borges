import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requer = createRequire(import.meta.url);
const ts = requer('typescript');
const fonte = readFileSync(new URL('./use-encerra-ao-sair.ts', import.meta.url), 'utf8');
const compilado = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

// React falso: refs e efeitos guardados pela ordem da chamada; o efeito roda quando as deps mudam.
function monta() {
  const refs: { current: unknown }[] = [];
  const deps: (unknown[] | undefined)[] = [];
  let i = 0;
  let r = 0;
  const react = {
    useRef: (inicial: unknown) => (refs[r] ??= { current: inicial }, refs[r++]),
    useEffect: (fn: () => unknown, d?: unknown[]) => {
      const antes = deps[i];
      const mudou = antes === undefined || d === undefined || d.some((v, k) => v !== antes[k]);
      deps[i++] = d;
      if (mudou) fn();
    },
  };
  const modulo = { exports: {} as any };
  new Function('require', 'module', 'exports', compilado)(
    (nome: string) => { assert.equal(nome, 'react'); return react; }, modulo, modulo.exports,
  );
  const encerrados: boolean[] = [];
  const sessaoAtivaRef = { current: true };
  const render = (fora: boolean) => {
    i = 0;
    r = 0;
    modulo.exports.useEncerraAoSair((semFreio: boolean) => encerrados.push(semFreio), sessaoAtivaRef, { current: null }, fora);
  };
  return { render, encerrados, sessaoAtivaRef };
}

test('ir para o chat com a conversa ligada encerra sem frear o Zé, uma vez só', () => {
  const m = monta();
  m.render(false);
  assert.deepEqual(m.encerrados, []);
  m.render(true);
  assert.deepEqual(m.encerrados, [true]);
  m.render(true);
  assert.deepEqual(m.encerrados, [true]);
});

test('conversa parada: sair da tela não encerra nada', () => {
  const m = monta();
  m.sessaoAtivaRef.current = false;
  m.render(false);
  m.render(true);
  assert.deepEqual(m.encerrados, []);
});
