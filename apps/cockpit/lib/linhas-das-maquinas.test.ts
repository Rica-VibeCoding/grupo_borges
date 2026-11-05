import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RecursosDaVps } from '../components/shell/recursos-da-vps.ts';
import { idDoNome, maquinasDaCasa, trechosDaLocal, trechosDaRemota } from './linhas-das-maquinas.ts';
import type { ResumoOnline } from './maquinas.ts';

const VPS: RecursosDaVps = {
  cpu_pct: 23,
  carga_1m: 1.2,
  nucleos: 4,
  ram: { usado_mb: 13500, livre_mb: 11076, total_mb: 24576, pct: 54.9 },
  swap: { usado_mb: 1200, livre_mb: 2895, total_mb: 4095, pct: 29.3 },
  swap_troca_paginas_s: 0,
  disco: { usado_mb: 64466, livre_mb: 33655, total_mb: 98121, pct: 65.7 },
  vilao: { cpu: null, ram: null },
  no_ar_segundos: 4_400_000,
  medido_em: 1_793_900_000,
  nome: 'VPS',
  temperatura_c: null,
};

const ARSENAL: ResumoOnline = {
  online: true,
  cpu_pct: 4.2,
  ram: { usado_mb: 1790, livre_mb: 5992, total_mb: 7782, pct: 23 },
  disco: { usado_mb: 29100, livre_mb: 82900, total_mb: 112000, pct: 26 },
  temperatura_c: 34,
  parados_30min: 3,
  tela: { em_uso: null, ultimo_uso_s: null },
  medido_em: 1_793_900_000,
};

const textos = (t: { texto: string }[]) => t.map((x) => x.texto);

test('id da local sai do nome, sem acento nem espaço', () => {
  assert.equal(idDoNome('VPS'), 'vps');
  assert.equal(idDoNome('Estúdio 2'), 'estudio-2');
});

test('na VPS: as remotas primeiro, a local por último', () => {
  assert.deepEqual(maquinasDaCasa('VPS', [{ id: 'arsenal', nome: 'Arsenal' }]), [
    { id: 'arsenal', nome: 'Arsenal', local: false },
    { id: 'vps', nome: 'VPS', local: true },
  ]);
});

test('no Arsenal: a remota com o nome da local vence, sem diferenciar maiúscula', () => {
  assert.deepEqual(maquinasDaCasa('ARSENAL', [{ id: 'arsenal', nome: 'Arsenal' }]), [
    { id: 'arsenal', nome: 'Arsenal', local: false },
  ]);
});

test('sem leitura da local, só as remotas; sem nada, lista vazia', () => {
  assert.deepEqual(maquinasDaCasa(null, [{ id: 'arsenal', nome: 'Arsenal' }]).map((m) => m.id), ['arsenal']);
  assert.deepEqual(maquinasDaCasa(null, []), []);
});

test('linha da local sem sensor: RAM e Swap; com sensor: RAM e temperatura', () => {
  assert.deepEqual(textos(trechosDaLocal(VPS, false)), ['RAM 55%', 'Swap 29%']);
  assert.deepEqual(textos(trechosDaLocal({ ...VPS, temperatura_c: 34 }, true)), ['RAM 55%', '34 °C']);
  assert.deepEqual(textos(trechosDaLocal(VPS, true)), ['RAM 55%', '— °C']);
});

test('linha da local acende como o cartão: RAM > 85%, swap em troca, CPU e disco só em alerta', () => {
  const quente = {
    ...VPS,
    cpu_pct: 95,
    ram: { ...VPS.ram, pct: 91 },
    swap_troca_paginas_s: 900,
    disco: { ...VPS.disco, pct: 90 },
  };
  assert.deepEqual(trechosDaLocal(quente, false), [
    { texto: 'RAM 91% alta', alerta: true },
    { texto: 'Swap 29% em troca', alerta: true },
    { texto: 'CPU 95% alta', alerta: true },
    { texto: 'disco 90% cheio', alerta: true },
  ]);
});

test('linha da remota: RAM, temperatura e parados; acende acima do teto', () => {
  assert.deepEqual(textos(trechosDaRemota(ARSENAL)), ['RAM 23%', '34 °C', '3 parados']);
  const quente = trechosDaRemota({ ...ARSENAL, ram: { ...ARSENAL.ram, pct: 89 }, temperatura_c: 90, parados_30min: 1 });
  assert.deepEqual(quente, [
    { texto: 'RAM 89% alta', alerta: true },
    { texto: '90 °C quente', alerta: true },
    { texto: '1 parado', alerta: false },
  ]);
});

test('alerta vem primeiro: com a linha cortada, some o neutro', () => {
  const soQuente = trechosDaRemota({ ...ARSENAL, temperatura_c: 90 });
  assert.deepEqual(textos(soQuente), ['90 °C quente', 'RAM 23%', '3 parados']);
});
