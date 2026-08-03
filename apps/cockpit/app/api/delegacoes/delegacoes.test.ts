import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { leDelegacoes, parseMarca, pidVivo, type Delegacao } from './delegacoes.ts';
import { GET } from './route.ts';

/** PID vivo de verdade: o do próprio processo de teste. */
const VIVO = process.pid;
/** Acima do pid_max padrão do Linux (4194304) — `kill` responde ESRCH sempre. */
const MORTO = 99_999_999;

function marca(overrides: Partial<Delegacao> = {}): Delegacao {
  return {
    quem: 'Tara',
    delegador: 'daniel',
    alvo: 'tara',
    inicio: 1_785_714_683,
    pid: VIVO,
    ...overrides,
  };
}

async function diretorioCom(entradas: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-deleg-teste-'));
  for (const [nome, conteudo] of Object.entries(entradas)) {
    await writeFile(join(dir, nome), conteudo, 'utf8');
  }
  return dir;
}

/* -------------------------------------------------------------------------- */
/* parseMarca — os cinco campos são obrigatórios                               */
/* -------------------------------------------------------------------------- */

test('marca completa e válida passa inteira', () => {
  assert.deepEqual(parseMarca(JSON.stringify(marca())), marca());
});

test('JSON corrompido vira null, nunca exceção', () => {
  assert.equal(parseMarca('{nao é json'), null);
  assert.equal(parseMarca(''), null);
});

test('delegador ausente ou vazio = sem dono conhecido = não mostra', () => {
  const { delegador: _omitido, ...semDelegador } = marca();
  assert.equal(parseMarca(JSON.stringify(semDelegador)), null);
  assert.equal(parseMarca(JSON.stringify(marca({ delegador: '' }))), null);
});

test('alvo ausente também descarta — sem alvo não há pra onde linkar', () => {
  const { alvo: _omitido, ...semAlvo } = marca();
  assert.equal(parseMarca(JSON.stringify(semAlvo)), null);
});

test('inicio ou pid com tipo errado descartam a marca', () => {
  assert.equal(parseMarca(JSON.stringify({ ...marca(), inicio: 'agora' })), null);
  assert.equal(parseMarca(JSON.stringify({ ...marca(), pid: 'muitos' })), null);
  assert.equal(parseMarca(JSON.stringify({ ...marca(), pid: -3 })), null);
});

/* -------------------------------------------------------------------------- */
/* pidVivo — o sinal 0 que só pergunta                                         */
/* -------------------------------------------------------------------------- */

test('pid do próprio processo existe; pid impossível, não', () => {
  assert.equal(pidVivo(VIVO), true);
  assert.equal(pidVivo(MORTO), false);
});

/* -------------------------------------------------------------------------- */
/* leDelegacoes — a varredura com as duas réguas de descarte                   */
/* -------------------------------------------------------------------------- */

test('diretório inexistente é lista vazia, não erro', async () => {
  assert.deepEqual(await leDelegacoes('/tmp/cc-deleg-que-nao-existe-9f8e7d'), []);
});

test('órfã de pid morto, corrompida e sem dono saem; a boa fica', async () => {
  const { delegador: _omitido, ...semDono } = marca({ alvo: 'hiro', quem: 'Hiro K3' });
  const dir = await diretorioCom({
    '111.json': JSON.stringify(marca()),
    '222.json': JSON.stringify(marca({ pid: MORTO, quem: 'Fantasma' })),
    '333.json': '{quebrado',
    '444.json': JSON.stringify(semDono),
    'nota.txt': JSON.stringify(marca({ quem: 'NaoSouJson' })),
  });
  try {
    const vivas = await leDelegacoes(dir);
    assert.equal(vivas.length, 1);
    assert.equal(vivas[0]?.quem, 'Tara');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('duas delegações empilham da mais antiga pra mais nova', async () => {
  const dir = await diretorioCom({
    '111.json': JSON.stringify(marca({ quem: 'Segunda', inicio: 200 })),
    '222.json': JSON.stringify(marca({ quem: 'Primeira', inicio: 100 })),
  });
  try {
    const vivas = await leDelegacoes(dir);
    assert.deepEqual(
      vivas.map((d) => d.quem),
      ['Primeira', 'Segunda'],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* GET — o filtro por delegador e o DELEG_DIR                                  */
/* -------------------------------------------------------------------------- */

async function comDelegDir<T>(dir: string, corpo: () => Promise<T>): Promise<T> {
  const anterior = process.env.DELEG_DIR;
  process.env.DELEG_DIR = dir;
  try {
    return await corpo();
  } finally {
    if (anterior === undefined) delete process.env.DELEG_DIR;
    else process.env.DELEG_DIR = anterior;
  }
}

test('?agente devolve só as daquele delegador, com inicio cru em segundos', async () => {
  const dir = await diretorioCom({
    '111.json': JSON.stringify(marca({ delegador: 'daniel', quem: 'Tara', inicio: 100 })),
    '222.json': JSON.stringify(
      marca({ delegador: 'hiro', quem: 'Hiro K3', alvo: 'hiro', inicio: 200 }),
    ),
  });
  try {
    await comDelegDir(dir, async () => {
      const res = await GET(new Request('http://localhost/api/delegacoes?agente=daniel'));
      assert.equal(res.status, 200);
      const corpo = (await res.json()) as { delegacoes: Delegacao[] };
      assert.equal(corpo.delegacoes.length, 1);
      assert.equal(corpo.delegacoes[0]?.quem, 'Tara');
      assert.equal(corpo.delegacoes[0]?.inicio, 100);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sem ?agente devolve todas as vivas; agente sem delegação recebe lista vazia', async () => {
  const dir = await diretorioCom({
    '111.json': JSON.stringify(marca({ delegador: 'daniel' })),
    '222.json': JSON.stringify(marca({ delegador: 'hiro', quem: 'Hiro K3' })),
  });
  try {
    await comDelegDir(dir, async () => {
      const todas = (await (await GET(new Request('http://localhost/api/delegacoes'))).json()) as {
        delegacoes: Delegacao[];
      };
      assert.equal(todas.delegacoes.length, 2);

      const nenhuma = (await (
        await GET(new Request('http://localhost/api/delegacoes?agente=pavan'))
      ).json()) as { delegacoes: Delegacao[] };
      assert.deepEqual(nenhuma.delegacoes, []);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
