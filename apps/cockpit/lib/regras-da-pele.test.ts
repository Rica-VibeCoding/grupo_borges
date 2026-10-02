// Três regras do CLAUDE.md do cockpit que até 02/10 só se conferiam no olho, e
// que voltaram a quebrar sem ninguém ver: token fantasma (`var(--ck-*)` que não
// existe no `globals.css` falha calado — sem cor, sem largura), cor solta fora
// do `globals.css` e arquivo acima do teto de 300 linhas.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const RAIZ = new URL('..', import.meta.url).pathname;
const PASTAS = ['app', 'components', 'lib'];

function arquivos(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(tsx?|css)$/.test(e.name))
    .map((e) => relative(RAIZ, join(e.parentPath, e.name)));
}

const TODOS = PASTAS.flatMap(arquivos);
const DE_TELA = TODOS.filter((f) => !f.includes('.test.'));
const ler = (f: string) => readFileSync(join(RAIZ, f), 'utf8');

/** Comentário fala de cor e de issue (`#2342`) sem pintar nada. */
function semComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((linha) => linha.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

test('todo var(--ck-*) usado existe no globals.css', () => {
  const definidos = new Set([...ler('app/globals.css').matchAll(/(--ck-[\w-]+)\s*:/g)].map((m) => m[1]));
  // Os que o JS escreve no elemento (`style.setProperty`) também existem.
  for (const f of DE_TELA) {
    for (const m of ler(f).matchAll(/setProperty\(\s*['"](--ck-[\w-]+)/g)) definidos.add(m[1]);
  }
  const fantasmas = DE_TELA.flatMap((f) =>
    [...semComentarios(ler(f)).matchAll(/var\(\s*(--ck-[\w-]+)/g)]
      .map((m) => m[1])
      // `var(--ck-tom-${tom})`: prefixo montado em runtime, não token.
      .filter((token) => !token.endsWith('-') && !definidos.has(token))
      .map((token) => `${f}: ${token}`),
  );
  assert.deepEqual(fantasmas, []);
});

/** Onde cor literal é obrigatória ou não é interface. */
const COR_LITERAL_PERMITIDA = new Set([
  // theme-color: o browser pinta a barra antes de ler CSS (estética §10).
  'app/layout.tsx',
  'app/manifest.ts',
  'app/page.tsx',
  'app/faxina/page.tsx',
  // A régua do `?diag=1`: instrumento de medida, fora do tema de propósito.
  'components/shell/regua.tsx',
]);

test('cor só no globals.css', () => {
  const cor = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/;
  const soltas = DE_TELA.filter((f) => f !== 'app/globals.css' && !COR_LITERAL_PERMITIDA.has(f))
    .flatMap((f) =>
      semComentarios(ler(f))
        .split('\n')
        .flatMap((linha, i) => (cor.test(linha) ? [`${f}:${i + 1}: ${linha.trim()}`] : [])),
    );
  assert.deepEqual(soltas, []);
});

/** Os que já passavam do teto em 02/10, esperando quem os fatie. Fatiou, sai
 *  daqui. Arquivo novo não entra na lista: nasce dentro do teto. */
const ACIMA_DO_TETO = new Set([
  'app/agente/[slug]/feed-da-conversa.tsx',
  'components/feed/corpo-do-item.tsx',
  'components/renderers/gramatica.ts',
  'components/renderers/linha-execucao.tsx',
  'components/shell/composer.tsx',
  'components/shell/superficie-otimista.tsx',
  'components/shell/voz.ts',
  'lib/spike/canario-stream-controller.ts',
]);

test('teto de 300 linhas por arquivo', () => {
  const linhas = (f: string) => ler(f).split('\n').length - 1;
  // O globals.css é o arquivo de tokens, um só por desenho.
  const medidos = DE_TELA.filter((f) => f !== 'app/globals.css');
  const novos = medidos.filter((f) => linhas(f) > 300 && !ACIMA_DO_TETO.has(f));
  assert.deepEqual(novos, [], 'passou de 300 linhas: está fazendo duas coisas — fatie');
  const jaCabem = [...ACIMA_DO_TETO].filter((f) => linhas(f) <= 300);
  assert.deepEqual(jaCabem, [], 'já cabe no teto: tire da lista ACIMA_DO_TETO');
});
