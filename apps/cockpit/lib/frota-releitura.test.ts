import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FleetResponse, TaskEvent } from '@grupo_borges/cockpit-core/cockpit-types';

import { activityFromTaskEvent } from './frota-activity.ts';
import {
  atrasoDaReleitura,
  EVENTO_RELEIA_FROTA,
  eventoPedeReleitura,
  mesmaFrota,
  RELEITURA_ESPERA_MS,
  RELEITURA_INTERVALO_MIN_MS,
} from './frota-releitura.ts';

function evento(kind: string, payload: TaskEvent['payload'] = null): TaskEvent {
  return { id: 1, task_id: null, agent_slug: 'daniel', instance_id: null, kind, payload, created_at: 0 };
}

const TOOL_USE = { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } };
const PEDIDO = { message: { role: 'user', content: 'roda a suíte' } };

test('turno comum: relê na virada, não a cada evento do meio', () => {
  // O agente estava ocioso; chega o pedido, uma rajada de tool_use, e o fim.
  const turno: Array<[TaskEvent, 'ocioso' | 'trabalhando']> = [
    [evento('jsonl:user', PEDIDO), 'ocioso'],
    [evento('hook:UserPromptSubmit'), 'trabalhando'],
    [evento('jsonl:assistant', TOOL_USE), 'trabalhando'],
    [evento('hook:PreToolUse'), 'trabalhando'],
    [evento('hook:PostToolUse'), 'trabalhando'],
    [evento('jsonl:assistant', TOOL_USE), 'trabalhando'],
    [evento('jsonl:file-history-snapshot'), 'trabalhando'],
    [evento('hook:Stop'), 'trabalhando'],
    [evento('jsonl:system', { subtype: 'turn_duration' }), 'ocioso'],
  ];
  const releituras = turno
    .filter(([ev, noSnapshot]) => eventoPedeReleitura(activityFromTaskEvent(ev), noSnapshot))
    .map(([ev]) => ev.kind);
  assert.deepEqual(releituras, ['jsonl:user', 'hook:Stop']);
});

test('evento sem estado não relê — o back não mexe no lifecycle por ele', () => {
  for (const kind of ['jsonl:attachment', 'jsonl:summary', 'jsonl:queue-operation', 'message']) {
    assert.equal(eventoPedeReleitura(activityFromTaskEvent(evento(kind)), 'ocioso'), false, kind);
  }
});

test('agente offline que acorda relê: o snapshot precisa ver a sessão no ar', () => {
  assert.equal(eventoPedeReleitura('trabalhando', 'offline'), true);
});

test('falha que pede atenção relê mesmo com o card trabalhando', () => {
  const estado = activityFromTaskEvent(evento('hook:PostToolUseFailure'));
  assert.equal(eventoPedeReleitura(estado, 'trabalhando'), true);
});

test('agente fora do snapshot não relê', () => {
  assert.equal(eventoPedeReleitura('trabalhando', undefined), false);
});

test('primeira releitura sai na espera de sempre; a seguinte respeita o intervalo', () => {
  assert.equal(atrasoDaReleitura(10_000, null), RELEITURA_ESPERA_MS);
  assert.equal(atrasoDaReleitura(10_300, 10_000), RELEITURA_INTERVALO_MIN_MS - 300);
  assert.equal(atrasoDaReleitura(20_000, 10_000), RELEITURA_ESPERA_MS);
});

function frota(status: 'ocioso' | 'trabalhando', serverNow: number): FleetResponse {
  return {
    agents: [{ slug: 'daniel', status } as FleetResponse['agents'][number]],
    kpis: { total: 1 } as FleetResponse['kpis'],
    health: { server_now: serverNow } as FleetResponse['health'],
  };
}

test('snapshot igual (só o relógio do servidor andou) não vira estado novo', () => {
  assert.equal(mesmaFrota(frota('ocioso', 1), frota('ocioso', 2)), true);
  assert.equal(mesmaFrota(frota('ocioso', 1), frota('trabalhando', 1)), false);
});

test('ação no agente pede releitura mesmo quando falha', async () => {
  const alvo = new EventTarget();
  (globalThis as { window?: EventTarget }).window = alvo;
  let pedidos = 0;
  alvo.addEventListener(EVENTO_RELEIA_FROTA, () => { pedidos += 1; });
  try {
    const { postAgentModel } = await import('./acoes-no-agente.ts');
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
    try {
      await assert.rejects(postAgentModel('daniel', 'haiku'));
    } finally {
      globalThis.fetch = fetchOriginal;
    }
    assert.equal(pedidos, 1);
  } finally {
    delete (globalThis as { window?: EventTarget }).window;
  }
});
