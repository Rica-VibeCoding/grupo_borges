// A frota de um do painel do cliente (`lib/frota-do-cliente.ts`). O status é
// cópia de `derive_agent_status` (`apps/api/db/store.py`) — os casos abaixo são
// os ramos daquela função, na mesma ordem.

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  LIFECYCLE_FRESCO_S,
  agenteDoCliente,
  esperaParaReligar,
  frotaDoCliente,
  leEstado,
  statusDoCliente,
  type AgenteCru,
} from './frota-do-cliente.ts';

const AGORA = 1_000_000;
const NO_AR = { sessao: true, processo: true };

test('lifecycle offline fresco vence a presença', () => {
  assert.equal(statusDoCliente({ lifecycle_status: 'offline', lifecycle_updated_at: AGORA - 10 }, NO_AR, AGORA), 'offline');
});

test('sem sessão ou sem processo é offline, mesmo com lifecycle fresco', () => {
  const vivo = { lifecycle_status: 'trabalhando' as const, lifecycle_updated_at: AGORA - 10 };
  assert.equal(statusDoCliente(vivo, { sessao: false, processo: false }, AGORA), 'offline');
  assert.equal(statusDoCliente(vivo, { sessao: true, processo: false }, AGORA), 'offline');
});

test('lifecycle fresco decide entre ocioso, trabalhando e aguardando', () => {
  for (const status of ['ocioso', 'trabalhando', 'aguardando'] as const) {
    assert.equal(statusDoCliente({ lifecycle_status: status, lifecycle_updated_at: AGORA - LIFECYCLE_FRESCO_S }, NO_AR, AGORA), status);
  }
});

test('lifecycle velho ou ausente cai em ocioso', () => {
  assert.equal(statusDoCliente({ lifecycle_status: 'trabalhando', lifecycle_updated_at: AGORA - LIFECYCLE_FRESCO_S - 1 }, NO_AR, AGORA), 'ocioso');
  assert.equal(statusDoCliente({ lifecycle_status: null, lifecycle_updated_at: null }, NO_AR, AGORA), 'ocioso');
});

test('sem /painel ainda, presença desconhecida não vira offline', () => {
  assert.equal(statusDoCliente({ lifecycle_status: 'trabalhando', lifecycle_updated_at: AGORA }, null, AGORA), 'trabalhando');
});

const CRU = {
  slug: 'teste', name: 'Teste', lifecycle_status: 'trabalhando', lifecycle_updated_at: AGORA,
  context_pct: null, context_tokens: null, context_updated_at: null, context_stale: false,
} as unknown as AgenteCru;

test('o contexto vem do /painel, com os tokens só quando disponíveis', () => {
  const painel = {
    vida: NO_AR,
    contexto: { pct: 21, updated_at: AGORA - 5, stale: false, available: true, tokens: { input: 1, output: 2, cache_creation: 3, cache_read: 4, total: 10 } },
  } as unknown as AgentPainelResponse;
  const agente = agenteDoCliente(CRU, painel, AGORA);
  assert.equal(agente.status, 'trabalhando');
  assert.equal(agente.context_pct, 21);
  assert.equal(agente.context_tokens, 10);
  assert.equal(agente.pergunta_motor, null);
  const semMedida = agenteDoCliente(CRU, { ...painel, contexto: { ...painel.contexto, available: false } }, AGORA);
  assert.equal(semMedida.context_tokens, null);
});

test('a frota de um conta o agente no status dele', () => {
  const frota = frotaDoCliente([agenteDoCliente(CRU, null, AGORA)], AGORA);
  assert.equal(frota.agents.length, 1);
  assert.equal(frota.kpis.total, 1);
  assert.equal(frota.kpis.trabalhando, 1);
  assert.equal(frotaDoCliente([], AGORA).kpis.total, 0);
});

const ESTADO = {
  agent: { slug: 'teste', lifecycle_status: 'trabalhando', lifecycle_updated_at: AGORA, pane_excerpt: 'Opus 4.8 - 00:03:12 - [████░░░░░░] 40%', pane_session_started_at: AGORA - 192 },
  painel: { vida: NO_AR, contexto: { pct: 40, tokens: { total: 80000 }, updated_at: AGORA, stale: false, available: true } },
  status: 'aguardando',
  generated_at: AGORA,
};

test('o state do /events vira retrato, e o status do servidor vence a cópia local', () => {
  const estado = leEstado(JSON.stringify(ESTADO));
  assert.ok(estado);
  const agente = agenteDoCliente(estado.agent, estado.painel, AGORA, estado.status);
  // O lifecycle diria "trabalhando"; quem decide é o back.
  assert.equal(agente.status, 'aguardando');
  assert.equal(agente.context_pct, 40);
  assert.equal(agente.context_tokens, 80000);
});

test('state torto é descartado, não apaga o agente', () => {
  assert.equal(leEstado('não é json'), null);
  assert.equal(leEstado(JSON.stringify({ ...ESTADO, status: 'dormindo' })), null);
  assert.equal(leEstado(JSON.stringify({ ...ESTADO, agent: {} })), null);
  assert.equal(leEstado(JSON.stringify({ ...ESTADO, painel: { vida: NO_AR } })), null);
});

test('religar o /events recusado espera mais a cada falha, até 30 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(esperaParaReligar), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
});
