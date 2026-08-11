import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function lerArquivo(caminho: string): Promise<string> {
  return readFile(new URL(caminho, import.meta.url), 'utf8');
}

test('desenvolvimento usa porta e diretório separados da produção', async () => {
  const pacote = JSON.parse(await lerArquivo('../package.json')) as {
    scripts?: Record<string, string>;
  };
  const comando = pacote.scripts?.dev ?? '';

  assert.ok(comando.includes('COCKPIT_DIST_DIR=.next-dev'));
  assert.ok(comando.includes('--port 3009'));
  assert.ok(!comando.includes('--port 3008'));
});

test('documentação e procedimento apontam para a mesma operação', async () => {
  const [estado, stack, procedimento, guia] = await Promise.all([
    lerArquivo('../../../docs/cockpit-v2-ESTADO.md'),
    lerArquivo('../../../docs/cockpit-v2-stack.md'),
    lerArquivo('../.claude/skills/subir-cockpit/SKILL.md'),
    lerArquivo('../CLAUDE.md'),
  ]);

  assert.ok(estado.includes('desenvolvimento usa a porta `3009`'));
  assert.ok(stack.includes('Desenvolvimento: **3009**'));
  assert.ok(stack.includes('COCKPIT_DIST_DIR=.next-dev'));
  assert.ok(procedimento.includes('COCKPIT_DIST_DIR=.next-dev npx next dev --port 3009'));
  assert.ok(estado.includes('https://srv1061129.tailfe77db.ts.net:3446'));
  assert.ok(stack.includes('https://srv1061129.tailfe77db.ts.net:3446'));
  assert.ok(guia.includes('Dev na **3009**'));
  assert.ok(guia.includes('`:3446`→3008'));
});
