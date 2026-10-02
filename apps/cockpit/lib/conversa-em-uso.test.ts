import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Conversa, ConversasResponse } from '@grupo_borges/cockpit-core/api';

import { leConversaEmUso, rotuloDaConversa } from './conversa-em-uso.ts';

const conversa = (campos: Partial<Conversa>): Conversa => ({
  id: 'a5b2f30c',
  titulo: 'Conversa a5b2f30c',
  titulo_origem: 'primeira',
  nota: null,
  atualizada_em: 0,
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
    });
    assert.equal(leConversaEmUso(lista(conversa({ atual: false }))), null);
    assert.equal(leConversaEmUso(null), null);
  });

  it('conversa com nome dado e sem turno não é "nova"', () => {
    assert.deepEqual(leConversaEmUso(lista(conversa({ titulo: 'Financeiro', titulo_origem: 'renomeada' }))), {
      id: 'a5b2f30c',
      rotulo: 'Financeiro',
      nova: false,
    });
  });
});
