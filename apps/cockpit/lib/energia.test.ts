import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  abasDaCasa,
  energiaDe,
  faixaDaEnergia,
  intervaloDaEnergia,
  textoDoImpacto,
  trechosDaEnergia,
  type EnergiaMaquina,
} from './energia.ts';

function maq(parcial: Partial<EnergiaMaquina> & Pick<EnergiaMaquina, 'id' | 'nome'>): EnergiaMaquina {
  return { ligado: true, ligar: { pode: false, motivo: 'falta a tomada' }, em_andamento: null, ...parcial };
}

const ARSENAL = maq({ id: 'arsenal', nome: 'Arsenal' });
const PC = maq({ id: 'pc', nome: 'PC', ligado: false, ligar: { pode: true, motivo: null } });
const NOTE = maq({ id: 'note', nome: 'Note', ligado: false, ligar: { pode: false, motivo: 'liga só na mão' } });

test('faixa ligada oferece Desligar; desligada oferece Ligar', () => {
  assert.deepEqual(faixaDaEnergia(ARSENAL), { estado: 'Ligado', ligado: true, acao: 'desligar', motivo: null });
  assert.deepEqual(faixaDaEnergia(PC), { estado: 'Desligado', ligado: false, acao: 'ligar', motivo: null });
});

test('sem caminho de ligar, o Ligar fica desabilitado com o motivo escrito', () => {
  assert.equal(faixaDaEnergia({ ...ARSENAL, ligado: false }).motivo, 'falta a tomada');
  assert.equal(faixaDaEnergia(NOTE).motivo, 'liga só na mão');
  assert.equal(faixaDaEnergia({ ...NOTE, ligar: { pode: false, motivo: null } }).motivo, 'sem caminho para ligar');
});

test('ação em curso: sem botão, palavra com reticências, e a leitura acelera para 5 s', () => {
  assert.deepEqual(faixaDaEnergia({ ...ARSENAL, em_andamento: 'desligando' }).acao, null);
  assert.equal(faixaDaEnergia({ ...PC, em_andamento: 'ligando' }).estado, 'Ligando…');
  assert.equal(intervaloDaEnergia([ARSENAL, { ...PC, em_andamento: 'ligando' }]), 5_000);
  assert.equal(intervaloDaEnergia([ARSENAL, PC]), 15_000);
  assert.equal(intervaloDaEnergia(null), 15_000);
});

test('o que cai junto, em frases', () => {
  const agentes = ['Canário', 'Estúdio', 'Fluyt Com', 'Fluyt Fin', 'Fluyt Pós', 'Note'];
  assert.deepEqual(textoDoImpacto({ agentes, chromes: 1, em_uso: true, aviso: null }), [
    '6 agentes',
    '1 Chrome',
  ]);
  assert.deepEqual(textoDoImpacto({ agentes: [], chromes: 0, em_uso: null, aviso: null }), []);
});

test('linha da home: só ligado ou desligado', () => {
  assert.deepEqual(trechosDaEnergia(PC), [{ texto: 'desligado', alerta: false }]);
  assert.deepEqual(trechosDaEnergia(ARSENAL), [{ texto: 'ligado', alerta: false }]);
  assert.equal(trechosDaEnergia({ ...PC, em_andamento: 'ligando' })[0].texto, 'ligando…');
});

test('abas: remota com painel, depois as que só têm energia, a local por último', () => {
  const casa = [
    { id: 'arsenal', nome: 'Arsenal', local: false },
    { id: 'vps', nome: 'VPS', local: true },
  ];
  assert.deepEqual(
    abasDaCasa(casa, [ARSENAL, PC, NOTE]).map((a) => [a.id, a.energia, a.local]),
    [
      ['arsenal', true, false],
      ['pc', true, false],
      ['note', true, false],
      ['vps', false, true],
    ],
  );
  assert.equal(energiaDe({ id: 'x', nome: 'ARSENAL' }, [ARSENAL])?.id, 'arsenal');
  assert.equal(energiaDe({ id: 'vps', nome: 'VPS' }, [ARSENAL]), null);
});
