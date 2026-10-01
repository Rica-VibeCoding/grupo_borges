import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  assinaTrocaNoChat,
  assumeTroca,
  concluiTroca,
  leTrocaNoChat,
  limpaTrocasNoChat,
  publicaTrocaNoChat,
  temDono,
  type TrocaNoChat,
} from './troca-em-curso.ts';

beforeEach(() => limpaTrocasNoChat());

const trocando = (inicio: number): Extract<TrocaNoChat, { fase: 'trocando' }> => ({
  fase: 'trocando',
  tipo: 'retomar',
  alvoTitulo: 'Voz em tempo real',
  etapa: 'estacionando',
  inicio,
  desligado: false,
  forcar: false,
});

describe('troca em curso — o Histórico publica, o chat lê (F13)', () => {
  it('publica e avisa quem ouve', () => {
    let avisos = 0;
    assinaTrocaNoChat('canarinho', () => avisos++);
    publicaTrocaNoChat('canarinho', trocando(10));
    assert.equal(leTrocaNoChat('canarinho')?.fase, 'trocando');
    assert.equal(avisos, 1);
    assert.equal(leTrocaNoChat('pavan'), null);
  });

  it('o aviso do stream encerra; a mesma troca republicada não volta', () => {
    publicaTrocaNoChat('canarinho', trocando(10));
    concluiTroca('canarinho', 50);
    assert.equal(leTrocaNoChat('canarinho'), null);
    publicaTrocaNoChat('canarinho', { ...trocando(10), etapa: 'religando' });
    assert.equal(leTrocaNoChat('canarinho'), null, 'o Histórico ainda conferindo não reescurece o chat');
    publicaTrocaNoChat('canarinho', trocando(60));
    assert.equal(leTrocaNoChat('canarinho')?.fase, 'trocando', 'troca nova, depois do fim, vale');
  });

  it('pronta só sucede uma troca de pé', () => {
    publicaTrocaNoChat('canarinho', { fase: 'pronta', emMs: 5 });
    assert.equal(leTrocaNoChat('canarinho'), null);
    publicaTrocaNoChat('canarinho', trocando(1));
    publicaTrocaNoChat('canarinho', { fase: 'pronta', emMs: 5 });
    assert.equal(leTrocaNoChat('canarinho')?.fase, 'pronta');
  });

  it('o dono solta uma vez só', () => {
    const solta = assumeTroca('canarinho');
    assert.equal(temDono('canarinho'), true);
    solta();
    solta();
    assert.equal(temDono('canarinho'), false);
  });
});
