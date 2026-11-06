import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RecursosDaVps } from '../components/shell/recursos-da-vps.ts';
import { idDoNome, leituraDaLocal, leituraDaRemota, maquinasDaCasa } from './linhas-das-maquinas.ts';
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

test('local: CPU, RAM e temperatura nessa ordem; sem sensor a temperatura some, sem Swap no lugar', () => {
  assert.deepEqual(textos(leituraDaLocal(VPS, false).medidas), ['CPU 23%', 'RAM 55%']);
  assert.deepEqual(textos(leituraDaLocal({ ...VPS, temperatura_c: 34 }, true).medidas), ['CPU 23%', 'RAM 55%', '34 °C']);
});

test('local: sensor que falha numa rodada e CPU sem leitura guardam o lugar', () => {
  assert.deepEqual(textos(leituraDaLocal(VPS, true).medidas), ['CPU 23%', 'RAM 55%', '— °C']);
  assert.deepEqual(textos(leituraDaLocal({ ...VPS, cpu_pct: null }, false).medidas), ['CPU —', 'RAM 55%']);
  assert.deepEqual(leituraDaLocal(VPS, true).medidas.map((t) => t.curto), ['23%', '55%', '—']);
});

test('local em alerta: a ordem não muda; disco cheio e swap em troca viram aviso', () => {
  const quente = leituraDaLocal(
    { ...VPS, cpu_pct: 95, ram: { ...VPS.ram, pct: 91 }, swap_troca_paginas_s: 900, disco: { ...VPS.disco, pct: 90 } },
    false,
  );
  assert.deepEqual(quente.medidas, [
    { texto: 'CPU 95%!', curto: '95%!', alerta: true, falado: 'CPU 95% alta' },
    { texto: 'RAM 91%!', curto: '91%!', alerta: true, falado: 'RAM 91% alta' },
  ]);
  assert.deepEqual(quente.avisos, [
    { texto: 'disco!', curto: '!', alerta: true, falado: 'disco 90% cheio' },
    { texto: 'swap!', curto: '!', alerta: true, falado: 'swap em troca' },
  ]);
});

test('swap ocupada sem troca não aparece', () => {
  assert.deepEqual(leituraDaLocal(VPS, false).avisos, []);
});

test('remota: mesmo formato da local, sem parados', () => {
  assert.deepEqual(leituraDaRemota(ARSENAL), {
    medidas: [
      { texto: 'CPU 4%', curto: '4%', alerta: false },
      { texto: 'RAM 23%', curto: '23%', alerta: false },
      { texto: '34 °C', curto: '34°', alerta: false },
    ],
    avisos: [],
  });
});

test('remota sem temperatura: a medida some', () => {
  assert.deepEqual(textos(leituraDaRemota({ ...ARSENAL, temperatura_c: null }).medidas), ['CPU 4%', 'RAM 23%']);
});

test('remota acende só o trecho acima do teto: CPU > 90%, RAM > 85%, > 85 °C', () => {
  const noTeto = leituraDaRemota({ ...ARSENAL, cpu_pct: 90, ram: { ...ARSENAL.ram, pct: 85 }, temperatura_c: 85 });
  assert.deepEqual(noTeto.medidas.map((t) => t.alerta), [false, false, false]);
  const quente = leituraDaRemota({ ...ARSENAL, cpu_pct: 91, temperatura_c: 90, disco: { ...ARSENAL.disco, pct: 90 } });
  assert.deepEqual(textos(quente.medidas), ['CPU 91%!', 'RAM 23%', '90 °C!']);
  assert.equal(quente.medidas[2].falado, '90 °C quente');
  assert.deepEqual(quente.medidas.map((t) => t.curto), ['91%!', '23%', '90°!']);
  assert.deepEqual(textos(quente.avisos), ['disco!']);
});
