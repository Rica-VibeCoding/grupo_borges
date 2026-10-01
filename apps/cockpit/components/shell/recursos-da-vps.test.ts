import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  descreve,
  emAlerta,
  formataNoAr,
  formataTamanho,
  fracaoDaBarra,
  linhasDeVilao,
  nomeLegivel,
  type RecursosDaVps,
} from './recursos-da-vps.ts';

/** A Oracle em 07/09/2026: 2 núcleos, 12 GB, swap de 4 GB a 73%, disco a 64%. */
const ORACLE: RecursosDaVps = {
  cpu_pct: 80,
  carga_1m: 2.62,
  nucleos: 2,
  ram: { usado_mb: 7467, livre_mb: 4460, total_mb: 11927, pct: 62.6 },
  swap: { usado_mb: 2983, livre_mb: 1112, total_mb: 4095, pct: 72.8 },
  disco: { usado_mb: 62641, livre_mb: 35464, total_mb: 98121, pct: 63.9 },
  vilao: {
    cpu: { nome: 'Daniel', pct: 41.5, usado_mb: 573 },
    ram: { nome: 'Daniel', pct: 4.8, usado_mb: 2234 },
  },
  no_ar_segundos: 3024031,
  medido_em: 1_788_000_000,
};

test('cor só acima do teto de cada medida — e a swap tem o teto mais baixo', () => {
  assert.equal(emAlerta('ram', 62.6), false);
  assert.equal(emAlerta('ram', 85), false);
  assert.equal(emAlerta('ram', 85.1), true);
  // 73% de swap é a máquina trocando página com o disco: alerta.
  assert.equal(emAlerta('swap', 72.8), true);
  assert.equal(emAlerta('cpu', 80), false);
  assert.equal(emAlerta('cpu', null), false);
});

test('a barra é linear e clampa nos dois lados', () => {
  assert.equal(fracaoDaBarra(62.6), 0.626);
  assert.equal(fracaoDaBarra(0), 0);
  assert.equal(fracaoDaBarra(null), 0);
  assert.equal(fracaoDaBarra(140), 1);
});

test('tamanho: MB abaixo de 1 GB, uma casa até 10 GB, inteiro depois — com vírgula', () => {
  assert.equal(formataTamanho(996), '996 MB');
  assert.equal(formataTamanho(7467), '7,3 GB');
  assert.equal(formataTamanho(35464), '35 GB');
  assert.equal(formataTamanho(98121), '96 GB');
});

test('no ar: a unidade maior basta', () => {
  assert.equal(formataNoAr(720), 'há 12 min');
  assert.equal(formataNoAr(3600 * 23), 'há 23 h');
  assert.equal(formataNoAr(3024031), 'há 35 d');
});

test('a descrição de cada linha é o absoluto que a barra resume', () => {
  assert.equal(descreve('cpu', ORACLE), 'carga 2,6 em 2 núcleos');
  assert.equal(descreve('ram', ORACLE), '7,3 GB de 12 GB');
  assert.equal(descreve('swap', ORACLE), '2,9 GB de 4,0 GB');
  assert.equal(descreve('disco', ORACLE), '35 GB livres de 96 GB');
  assert.equal(descreve('swap', { ...ORACLE, swap: null }), 'sem swap');
});

test('o mesmo dono comendo as duas coisas vira UMA linha', () => {
  assert.deepEqual(linhasDeVilao(ORACLE), [{ nome: 'Daniel', cpu: '42%', ram: '2,2 GB' }]);
});

test('donos diferentes ficam em linhas separadas', () => {
  const dois = {
    ...ORACLE,
    vilao: {
      cpu: { nome: 'cockpit-api', pct: 62, usado_mb: 127 },
      ram: { nome: 'Pavan', pct: 4.5, usado_mb: 537 },
    },
  };

  assert.deepEqual(linhasDeVilao(dois), [
    { nome: 'cockpit-api', cpu: '62%', ram: null },
    { nome: 'Pavan', cpu: null, ram: '537 MB' },
  ]);
});

test('sem medida de vilão a seção não inventa linha', () => {
  assert.deepEqual(linhasDeVilao({ ...ORACLE, vilao: { cpu: null, ram: null } }), []);
});

test('com a lista de consumidores, cada dono vira uma linha com CPU e RAM', () => {
  const comLista = {
    ...ORACLE,
    consumidores: [
      { nome: 'cockpit-api', cpu_pct: 10.5, ram_mb: 119 },
      { nome: 'Pavan', cpu_pct: 4.2, ram_mb: 668 },
    ],
  };
  assert.deepEqual(linhasDeVilao(comLista), [
    { nome: 'cockpit-api', cpu: '11%', ram: '119 MB' },
    { nome: 'Pavan', cpu: '4,2%', ram: '668 MB' },
  ]);
});

test('nome legível: agente pelo nome do painel, sistema na palavra curta', () => {
  const frota = [
    { slug: 'fluytcom', name: 'Fluyt' },
    { slug: 'pavan', name: 'José Pavan' },
    { slug: 'canarinho', name: 'Canário' },
  ];
  assert.equal(nomeLegivel('Fluytcom', frota), 'Fluyt');
  assert.equal(nomeLegivel('Pavan2', frota), 'José Pavan 2');
  assert.equal(nomeLegivel('Canarinho', frota), 'Canário');
  assert.equal(nomeLegivel('cockpit-api', frota), 'cockpit (API)');
  assert.equal(nomeLegivel('containerd', frota), 'containerd');
  assert.equal(nomeLegivel('claude', frota), 'Claude avulso');
  assert.equal(nomeLegivel('Sofia', frota), 'Sofia');
  assert.equal(nomeLegivel('cockpit-ideia-sidebar', frota), 'cockpit (prévia)');
});
