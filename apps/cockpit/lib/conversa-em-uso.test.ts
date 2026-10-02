import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Conversa, ConversasResponse } from '@grupo_borges/cockpit-core/api';

import { dataCurtaDaConversa, leConversaEmUso, linhaDaConversa, rotuloDaConversa } from './conversa-em-uso.ts';

const conversa = (campos: Partial<Conversa>): Conversa => ({
  id: 'a5b2f30c',
  titulo: 'Conversa a5b2f30c',
  titulo_origem: 'primeira',
  nota: null,
  atualizada_em: 0,
  iniciada_em: null,
  turnos: 0,
  bytes: 0,
  estrela: false,
  concluida: false,
  atual: true,
  bloqueada: false,
  bloqueada_por: null,
  pendencia: null,
  ...campos,
});

const lista = (...conversas: Conversa[]): ConversasResponse => ({ suportado: true, conversas, escondidas_curtas: 0 });

describe('conversa em uso — o nome que a pílula do topo mostra', () => {
  it('sentinela da API (origem `primeira`, zero turnos) vira "Conversa nova"', () => {
    assert.equal(rotuloDaConversa(conversa({ titulo: 'Conversa a5b2f30c', titulo_origem: 'primeira', turnos: 0 })), 'Conversa nova');
  });

  it('título automático da primeira fala aparece como está', () => {
    assert.equal(rotuloDaConversa(conversa({ titulo: 'Arrumar o portão de cima', titulo_origem: 'primeira', turnos: 1 })), 'Arrumar o portão de cima');
    assert.equal(rotuloDaConversa(conversa({ titulo: 'Voz em tempo real', titulo_origem: 'prompt', turnos: 4 })), 'Voz em tempo real');
    assert.equal(rotuloDaConversa(conversa({ titulo: 'Troca de motor', titulo_origem: 'ai', turnos: 2 })), 'Troca de motor');
  });

  it('nome dado pelo Rica vence mesmo sem turno nenhum', () => {
    assert.equal(rotuloDaConversa(conversa({ titulo: 'Financeiro', titulo_origem: 'renomeada', turnos: 0 })), 'Financeiro');
    assert.equal(rotuloDaConversa(conversa({ titulo: 'Guardada no estacionar', titulo_origem: 'estacionada', turnos: 0 })), 'Guardada no estacionar');
  });

  it('a lista aponta a conversa da linha; sem `atual`, não há o que mostrar', () => {
    assert.deepEqual(leConversaEmUso(lista(conversa({}), conversa({ id: 'outra', atual: false }))), {
      id: 'a5b2f30c',
      rotulo: 'Conversa nova',
      nova: true,
      iniciadaEm: null,
      turnos: 0,
    });
    assert.equal(leConversaEmUso(lista(conversa({ atual: false }))), null);
    assert.equal(leConversaEmUso(null), null);
  });

  it('conversa com nome dado e sem turno não é "nova"', () => {
    assert.deepEqual(leConversaEmUso(lista(conversa({ titulo: 'Financeiro', titulo_origem: 'renomeada' }))), {
      id: 'a5b2f30c',
      rotulo: 'Financeiro',
      nova: false,
      iniciadaEm: null,
      turnos: 0,
    });
  });

  it('passa adiante quando começou e quantos turnos tem', () => {
    const emUso = leConversaEmUso(lista(conversa({ titulo: 'Portão', titulo_origem: 'prompt', iniciada_em: 1_000, turnos: 12 })));
    assert.equal(emUso?.iniciadaEm, 1_000);
    assert.equal(emUso?.turnos, 12);
  });
});

describe('conversa em uso — a linha do cartão', () => {
  const qui = Date.parse('2026-10-01T17:10:00Z'); // qui 01/10, 14:10 BRT
  const sex = Date.parse('2026-10-02T13:00:00Z'); // sex 02/10, 10:00 BRT

  it('outro dia leva dia da semana, data e hora em BRT, mais os turnos', () => {
    assert.equal(linhaDaConversa({ iniciadaEm: qui, turnos: 12 }, sex), 'Aberta qui 01/10, 14:10 · 12 turnos');
  });

  it('hoje vira "hoje"', () => {
    assert.equal(linhaDaConversa({ iniciadaEm: qui, turnos: 3 }, qui + 3_600_000), 'Aberta hoje, 14:10 · 3 turnos');
  });

  it('o dia é o de São Paulo, não o UTC', () => {
    const madrugadaZ = Date.parse('2026-10-02T02:30:00Z'); // ainda 01/10, 23:30 BRT
    assert.equal(linhaDaConversa({ iniciadaEm: madrugadaZ, turnos: 0 }, qui), 'Aberta hoje, 23:30');
  });

  it('zero turnos some; um turno no singular', () => {
    assert.equal(linhaDaConversa({ iniciadaEm: qui, turnos: 0 }, sex), 'Aberta qui 01/10, 14:10');
    assert.equal(linhaDaConversa({ iniciadaEm: qui, turnos: 1 }, sex), 'Aberta qui 01/10, 14:10 · 1 turno');
  });

  it('sem data, só os turnos; sem nada, nenhuma linha', () => {
    assert.equal(linhaDaConversa({ iniciadaEm: null, turnos: 4 }, sex), '4 turnos');
    assert.equal(linhaDaConversa({ iniciadaEm: null, turnos: 0 }, sex), null);
  });

  it('a pílula fechada mostra só dia/mês, ou "hoje" — sem hora, semana nem turnos', () => {
    assert.equal(dataCurtaDaConversa({ iniciadaEm: qui, nova: false }, sex), '01/10');
    assert.equal(dataCurtaDaConversa({ iniciadaEm: qui, nova: false }, qui + 3_600_000), 'hoje');
  });

  it('data curta: o "hoje" é o de São Paulo, não o UTC', () => {
    const madrugadaZ = Date.parse('2026-10-02T02:30:00Z'); // ainda 01/10, 23:30 BRT
    assert.equal(dataCurtaDaConversa({ iniciadaEm: madrugadaZ, nova: false }, qui), 'hoje');
    assert.equal(dataCurtaDaConversa({ iniciadaEm: madrugadaZ, nova: false }, sex), '01/10');
  });

  it('data curta some sem data e na "Conversa nova"', () => {
    assert.equal(dataCurtaDaConversa({ iniciadaEm: null, nova: false }, sex), null);
    assert.equal(dataCurtaDaConversa({ iniciadaEm: qui, nova: true }, qui), null);
  });
});
