// A chave de modo (`lib/modo.ts`): o painel do cliente corta peças da frota, e
// a frota — a tela do Rica — não pode perder nenhuma. Três provas: a tabela
// nos dois modos, o valor que o build grava chega à tabela, e cada peça
// cortada consulta a chave no lugar onde é desenhada.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { COMANDOS, comandosDo } from '../components/shell/comandos-do-painel.ts';
import { leModo, nomesDo, pecasDo, type Pecas } from './modo.ts';

const RAIZ = new URL('..', import.meta.url).pathname;
const ler = (f: string) => readFileSync(join(RAIZ, f), 'utf8');

const DA_FROTA: Array<keyof Pecas> = [
  'tropa', 'faxina', 'delegacoes', 'seletorDeMotor', 'bolhaDeComandos',
  'pesquisa', 'encerrar', 'blocoDeMotor', 'trocaDeConta', 'mcps',
];

test('só "cliente" liga o painel do cliente; ausente ou outro valor é frota', () => {
  assert.equal(leModo('cliente'), 'cliente');
  for (const valor of [undefined, '', 'frota', 'Cliente', 'cliente ', '1']) assert.equal(leModo(valor), 'frota');
});

test('frota desenha todas as peças e não tem login', () => {
  const pecas = pecasDo('frota');
  for (const peca of DA_FROTA) assert.equal(pecas[peca], true, peca);
  assert.equal(pecas.sessaoDoPortao, false);
  // Peça nova na tabela tem de entrar na lista acima — senão este teste não a vê.
  assert.deepEqual(Object.keys(pecas).sort(), [...DA_FROTA, 'sessaoDoPortao'].sort());
});

test('cliente corta o recorte aprovado e ganha o login', () => {
  const pecas = pecasDo('cliente');
  for (const peca of DA_FROTA) assert.equal(pecas[peca], false, peca);
  assert.equal(pecas.sessaoDoPortao, true);
});

test('comandos da gaveta: a frota segue com a lista inteira, o cliente só compacta', () => {
  assert.equal(comandosDo(pecasDo('frota')), COMANDOS);
  assert.deepEqual(comandosDo(pecasDo('cliente')).map((c) => c.id), ['compact']);
});

test('a frota mantém os nomes de sempre; o cliente não vê a marca da casa', () => {
  assert.deepEqual(nomesDo('frota'), {
    titulo: 'Cockpit — Grupo Borges',
    nome: 'Grupo Borges — Cockpit',
    nomeCurto: 'Cockpit',
    descricao: 'Painel da frota. Log de execução que às vezes conversa.',
  });
  for (const nome of Object.values(nomesDo('cliente'))) assert.doesNotMatch(nome, /Borges|Cockpit|frota/);
});

test('o valor do build chega à tabela (NEXT_PUBLIC_COCKPIT_MODO)', () => {
  const pecasCom = (modo: string | undefined) => {
    const env = { ...process.env };
    delete env.NEXT_PUBLIC_COCKPIT_MODO;
    if (modo !== undefined) env.NEXT_PUBLIC_COCKPIT_MODO = modo;
    const saida = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "import { MODO, PECAS } from './lib/modo.ts'; console.log(JSON.stringify({ MODO, PECAS }))"],
      { cwd: RAIZ, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return JSON.parse(saida) as { MODO: string; PECAS: Pecas };
  };
  assert.deepEqual(pecasCom(undefined), { MODO: 'frota', PECAS: pecasDo('frota') });
  assert.deepEqual(pecasCom('cliente'), { MODO: 'cliente', PECAS: pecasDo('cliente') });
});

// Onde cada peça cortada é desenhada — e o teste exige que ali ela consulte a
// chave. Desenho novo de uma peça fora destes arquivos escapa do corte; por isso
// os renderizadores das peças também são caçados no app inteiro (abaixo).
const AMARRAS: Array<[string, string]> = [
  ['app/agente/layout.tsx', 'PECAS.tropa'],
  ['components/shell/barra-de-telas.tsx', 'PECAS.tropa'],
  ['components/conversa/pager-do-agente.tsx', 'PECAS.tropa'],
  ['app/faxina/page.tsx', 'PECAS.faxina'],
  ['components/feed/delegacoes.tsx', 'PECAS.delegacoes'],
  ['components/shell/base-da-caixa.tsx', 'PECAS.seletorDeMotor'],
  ['components/shell/campo-do-composer.tsx', 'PECAS.bolhaDeComandos'],
  ['components/gaveta/gaveta-nova.tsx', 'PECAS.pesquisa'],
  ['components/gaveta/gaveta-nova.tsx', 'PECAS.blocoDeMotor'],
  ['components/gaveta/gaveta-nova.tsx', 'PECAS.mcps'],
  ['components/gaveta/gaveta-nova.tsx', 'PECAS.sessaoDoPortao'],
  ['app/agente/[slug]/page.tsx', 'PECAS.mcps'],
  ['components/shell/bloco-de-comandos.tsx', 'comandosDo(PECAS)'],
  ['components/shell/bloco-de-cota.tsx', 'PECAS.trocaDeConta'],
  ['app/entrar/page.tsx', 'PECAS.sessaoDoPortao'],
];

test('cada peça cortada consulta a chave onde é desenhada', () => {
  for (const [arquivo, consulta] of AMARRAS) assert.ok(ler(arquivo).includes(consulta), `${arquivo} sem ${consulta}`);
});

function telas(): string[] {
  return ['app', 'components', 'lib'].flatMap((pasta) =>
    readdirSync(join(RAIZ, pasta), { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.includes('.test.'))
      .map((e) => relative(RAIZ, join(e.parentPath, e.name))),
  );
}

test('as peças cortadas só são desenhadas nos lugares amarrados', () => {
  const desenhos: Array<[RegExp, string[]]> = [
    [/<SeletorMotor\b/, ['components/shell/base-da-caixa.tsx']],
    [/<BolhaDeComandos\b/, ['components/shell/campo-do-composer.tsx']],
    [/<BotaoNav\b/, ['components/shell/barra-de-telas.tsx']],
    [/<ArrastoDoChat\b/, ['components/conversa/pager-do-agente.tsx']],
    [/<BlocoDeMotor\b/, ['components/gaveta/gaveta-nova.tsx']],
    [/<SeletorDeConta\b/, ['components/shell/bloco-de-cota.tsx']],
    [/<LinhaDaPesquisa\b/, ['components/gaveta/gaveta-nova.tsx']],
    [/<VistaMcp\b/, ['app/agente/[slug]/page.tsx']],
    [/<TropaAoVivo\b/, ['app/agente/layout.tsx', 'app/page.tsx']],
    [/\/api\/delegacoes\?/, ['components/feed/delegacoes.tsx']],
  ];
  const todas = telas();
  for (const [desenho, permitidos] of desenhos) {
    const onde = todas.filter((f) => desenho.test(ler(f)));
    assert.deepEqual(onde.sort(), [...permitidos].sort(), String(desenho));
  }
});

test('o modo é lido num lugar só (mais a config do build, que não importa o bundle)', () => {
  const leitores = telas().filter((f) => ler(f).includes('NEXT_PUBLIC_COCKPIT_MODO'));
  assert.deepEqual(leitores, ['lib/modo.ts']);
});
