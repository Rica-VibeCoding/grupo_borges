import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Conversa } from '@grupo_borges/cockpit-core/api';

import {
  casaBusca,
  contaTurnos,
  descreveTrava,
  filtraConversas,
  listaVazia,
  sabePendencia,
  separaAtual,
  tempoRelativo,
} from './conversas.ts';

const conversa = (campos: Partial<Conversa>): Conversa => ({
  id: 'x',
  titulo: 'Migração do cockpit v1',
  titulo_origem: 'ai',
  nota: null,
  atualizada_em: 0,
  turnos: 10,
  bytes: 1,
  estrela: false,
  atual: false,
  bloqueada: false,
  bloqueada_por: null,
  pendencia: null,
  ...campos,
});

// Quarta, 01/10/2026, 09:00 no fuso da máquina.
const AGORA = new Date(2026, 9, 1, 9, 0, 0).getTime();
const em = (dia: number, hora: number, mes = 9, ano = 2026) => new Date(ano, mes, dia, hora, 0, 0).getTime();

describe('tempo relativo', () => {
  it('menos de um minuto é "agora"', () => {
    assert.equal(tempoRelativo(AGORA - 20_000, AGORA), 'agora');
  });

  it('minutos e horas dentro do mesmo dia', () => {
    assert.equal(tempoRelativo(AGORA - 4 * 60_000, AGORA), '4 min');
    assert.equal(tempoRelativo(em(1, 6), AGORA), '3h');
  });

  it('a noite de ontem é "ontem", não "11h"', () => {
    assert.equal(tempoRelativo(em(30, 22, 8), AGORA), 'ontem');
  });

  it('dias até 30, depois a data curta', () => {
    assert.equal(tempoRelativo(em(27, 12, 8), AGORA), '4 dias');
    assert.equal(tempoRelativo(em(12, 12, 7), AGORA), '12 ago');
    assert.equal(tempoRelativo(em(12, 12, 7, 2025), AGORA), '12 ago 2025');
  });

  it('relógio do aparelho atrasado não vira tempo negativo', () => {
    assert.equal(tempoRelativo(AGORA + 90_000, AGORA), 'agora');
  });
});

describe('busca', () => {
  it('ignora caixa e acento', () => {
    assert.equal(casaBusca(conversa({}), 'MIGRACAO'), true);
  });

  it('procura na nota também', () => {
    assert.equal(casaBusca(conversa({ nota: 'Parei no proxy do SSE' }), 'proxy'), true);
  });

  it('toda palavra tem que aparecer, em qualquer ordem', () => {
    assert.equal(casaBusca(conversa({}), 'v1 cockpit'), true);
    assert.equal(casaBusca(conversa({}), 'cockpit v2'), false);
  });

  it('busca vazia deixa passar', () => {
    assert.equal(casaBusca(conversa({}), '   '), true);
  });
});

describe('filtro', () => {
  const lista = [
    conversa({ id: 'a', estrela: true }),
    conversa({ id: 'b', pendencia: 2 }),
    conversa({ id: 'c', titulo: 'Faxina dos MCPs', pendencia: 0 }),
  ];

  it('especiais são só as ⭐', () => {
    assert.deepEqual(filtraConversas(lista, 'estrela', '').map((c) => c.id), ['a']);
  });

  it('a que perdeu a ⭐ nos especiais fica segurada até trocar de filtro', () => {
    const seguradas = new Set(['b']);
    assert.deepEqual(filtraConversas(lista, 'estrela', '', seguradas).map((c) => c.id), ['a', 'b']);
    assert.deepEqual(filtraConversas(lista, 'estrela', 'faxina', seguradas).map((c) => c.id), []);
  });

  it('pendência zero não é pendência', () => {
    assert.deepEqual(filtraConversas(lista, 'pendencia', '').map((c) => c.id), ['b']);
  });

  it('filtro e busca valem juntos', () => {
    assert.deepEqual(filtraConversas(lista, 'todas', 'faxina').map((c) => c.id), ['c']);
  });

  it('o ⚠️ só aparece quando a API conta pendência', () => {
    assert.equal(sabePendencia([conversa({}), conversa({})]), false);
    assert.equal(sabePendencia(lista), true);
  });
});

describe('a de agora', () => {
  it('sobe para o cartão e sai da lista', () => {
    const { atual, outras } = separaAtual([conversa({ id: 'a' }), conversa({ id: 'b', atual: true })]);
    assert.equal(atual?.id, 'b');
    assert.deepEqual(outras.map((c) => c.id), ['a']);
  });

  it('sem conversa atual, o cartão some', () => {
    assert.equal(separaAtual([conversa({})]).atual, null);
  });
});

describe('textos', () => {
  it('o 🔒 nomeia a linha dona quando sabe', () => {
    const nome = (slug: string) => (slug === 'felipe' ? 'Felipe' : slug);
    assert.equal(descreveTrava(conversa({ bloqueada: true, bloqueada_por: 'felipe' }), nome), 'Em uso por Felipe');
    assert.equal(descreveTrava(conversa({ bloqueada: true }), nome), 'Em uso em outro lugar');
  });

  it('turno no singular', () => {
    assert.equal(contaTurnos(1), '1 turno');
    assert.equal(contaTurnos(42), '42 turnos');
  });

  it('lista vazia diz o porquê, a busca primeiro', () => {
    assert.match(listaVazia('estrela', 'proxy'), /proxy/);
    assert.match(listaVazia('estrela', ''), /estrela/);
    assert.match(listaVazia('todas', ''), /30 dias/);
  });
});
