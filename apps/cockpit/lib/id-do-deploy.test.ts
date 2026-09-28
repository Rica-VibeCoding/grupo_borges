import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ENTRADAS_DO_BUILD, idDoCodigo, idGravadoNoBuild } from '../next.config.ts';

// Repo de mentira com a mesma forma do monorepo: o id tem de olhar só pro que
// entra no bundle. Commit de doc ou de API não pode recarregar a aba do Rica.
function repoDeMentira(): { raiz: string; cockpit: string; commit: (arquivo: string, texto: string) => void } {
  const raiz = mkdtempSync(join(tmpdir(), 'id-do-deploy-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: raiz, stdio: 'ignore' });
  const escreve = (arquivo: string, texto: string) => {
    mkdirSync(join(raiz, arquivo, '..'), { recursive: true });
    writeFileSync(join(raiz, arquivo), texto);
  };
  git('init', '-q');
  git('config', 'user.email', 'teste@teste');
  git('config', 'user.name', 'teste');
  for (const entrada of ENTRADAS_DO_BUILD) {
    escreve(entrada.includes('.') ? entrada : `${entrada}/index.ts`, `// ${entrada}\n`);
  }
  escreve('apps/cockpit/tsconfig.json', '{}\n');
  escreve('docs/leia.md', 'v1\n');
  escreve('apps/api/main.py', 'v1\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const commit = (arquivo: string, texto: string) => {
    escreve(arquivo, texto);
    git('add', arquivo);
    git('commit', '-qm', arquivo);
  };
  return { raiz, cockpit: join(raiz, 'apps/cockpit'), commit };
}

test('commit fora do que o build lê não muda o id; commit dentro muda', () => {
  const { raiz, cockpit, commit } = repoDeMentira();
  try {
    const base = idDoCodigo(cockpit);
    assert.match(base, /^[0-9a-f]{12}$/);

    commit('docs/leia.md', 'v2\n');
    commit('apps/api/main.py', 'v2\n');
    assert.equal(idDoCodigo(cockpit), base, 'doc e API não entram no bundle');

    commit('packages/cockpit-core/index.ts', '// mudou\n');
    const doCore = idDoCodigo(cockpit);
    assert.notEqual(doCore, base, 'o core entra como source');

    commit('apps/cockpit/index.ts', '// mudou\n');
    assert.notEqual(idDoCodigo(cockpit), doCore);

    commit('pnpm-lock.yaml', '# lib nova\n');
    assert.notEqual(idDoCodigo(cockpit), doCore);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('árvore suja no que entra no bundle ganha id único; o tsconfig do next dev não conta', () => {
  const { raiz, cockpit } = repoDeMentira();
  try {
    const limpo = idDoCodigo(cockpit);

    writeFileSync(join(cockpit, 'tsconfig.json'), '{"include":[".next-estagio-1"]}\n');
    assert.equal(idDoCodigo(cockpit), limpo, 'o tsconfig vive sujo no repo principal');

    mkdirSync(join(cockpit, '.next-estagio-20260928-120000'));
    writeFileSync(join(cockpit, '.next-estagio-20260928-120000', 'BUILD_ID'), 'x');
    assert.equal(idDoCodigo(cockpit), limpo, 'estágio de build no disco não é código');

    writeFileSync(join(cockpit, 'index.ts'), '// WIP que entra no bundle\n');
    const sujo = idDoCodigo(cockpit);
    assert.ok(sujo.startsWith(`${limpo}-wip`), sujo);

    writeFileSync(join(cockpit, 'novo.ts'), '// arquivo novo, fora do índice\n');
    assert.ok(idDoCodigo(cockpit).startsWith(`${limpo}-wip`));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('o start lê o id do build pelo SEU distDir, mesmo com o estágio renomeado', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'id-do-deploy-dist-'));
  try {
    const estagio = join(raiz, '.next-estagio-20260928-120000');
    mkdirSync(estagio);
    writeFileSync(
      join(estagio, 'required-server-files.json'),
      JSON.stringify({ config: { distDir: '.next-estagio-20260928-120000', deploymentId: 'abc123def456' } }),
    );
    const publicado = join(raiz, '.next');
    renameSync(estagio, publicado);

    assert.equal(idGravadoNoBuild(publicado), 'abc123def456');
    assert.equal(idGravadoNoBuild(join(raiz, '.next-que-nao-existe')), undefined);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
