import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import {
  buildRenderItems,
  coalesceSidechainGroups,
} from '@grupo_borges/cockpit-core/render-items';

import {
  createIncrementalRenderItems,
  incrementalRenderItemsStats,
} from './render-items-incremental.ts';

const FIXTURE_DIR = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');
type Fixture = { familia: string; ocorrencias: number; evento: MessagePayload };
const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith('.json') && file !== '_indice.json')
  .sort()
  .map((file) => JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture);

function full(messages: readonly MessagePayload[]) {
  return coalesceSidechainGroups(buildRenderItems([...messages]));
}

test('é idêntico ao rebuild completo em cada prefixo das 52 famílias reais', () => {
  assert.equal(fixtures.length, 52);
  const incremental = createIncrementalRenderItems();
  const messages = fixtures.map((fixture) => fixture.evento);

  for (let length = 0; length <= messages.length; length++) {
    assert.deepEqual(
      incremental.update(messages.slice(0, length)),
      full(messages.slice(0, length)),
      `divergência no prefixo ${length} (${fixtures[length - 1]?.familia ?? 'vazio'})`,
    );
  }
});

test('preserva as duas bordas obrigatórias: corpo null (199) e content string (87)', () => {
  const selected = ['borda__content_none', 'borda__content_string'].map((name) => {
    const fixture = fixtures.find((candidate) => candidate.familia === name);
    assert.ok(fixture, `fixture ausente: ${name}`);
    return fixture;
  });
  assert.equal(selected[0].ocorrencias, 199);
  assert.equal(selected[0].evento.message, null);
  assert.equal(selected[1].ocorrencias, 87);
  assert.equal(typeof selected[1].evento.message?.content, 'string');

  const incremental = createIncrementalRenderItems();
  for (let length = 1; length <= selected.length; length++) {
    const prefix = selected.slice(0, length).map((fixture) => fixture.evento);
    assert.deepEqual(incremental.update(prefix), full(prefix));
  }
});

test('reabre lookahead de Skill e o item seguinte consumido', () => {
  const skill = fixtures.find((fixture) => fixture.familia === 'tool__Skill')?.evento;
  const next = fixtures.find(
    (fixture) => fixture.evento.kind === 'assistant' && !fixture.evento.is_sidechain,
  )?.evento;
  assert.ok(skill);
  assert.ok(next);
  const incremental = createIncrementalRenderItems();
  assert.deepEqual(incremental.update([skill]), full([skill]));
  assert.deepEqual(incremental.update([skill, next]), full([skill, next]));
});

test('novo grupo lateral estende run já coalescido', () => {
  const sidechains = fixtures
    .filter((fixture) => fixture.evento.is_sidechain)
    .slice(0, 3)
    .map((fixture) => fixture.evento);
  assert.equal(sidechains.length, 3);
  const incremental = createIncrementalRenderItems();
  for (let length = 1; length <= sidechains.length; length++) {
    const prefix = sidechains.slice(0, length);
    assert.deepEqual(incremental.update(prefix), full(prefix));
  }
});

test('reprocessa somente a cauda em 1.040+ mensagens', () => {
  const source = fixtures.find((fixture) => !fixture.evento.is_sidechain)?.evento;
  assert.ok(source);
  const messages = Array.from({ length: 1_041 }, (_, index): MessagePayload => ({
    ...source,
    id: 1_000_000 + index,
    uuid: `incremental-cost-${index}`,
    parent_uuid: null,
  }));
  const incremental = createIncrementalRenderItems();
  incremental.update(messages.slice(0, 1_040));
  incremental.update(messages);

  const stats = incrementalRenderItemsStats(incremental);
  assert.ok(stats);
  assert.deepEqual(stats, { reprocessedMessages: 2, totalMessages: 1_041 });
  assert.deepEqual(incremental.update(messages), full(messages));
  console.log(
    `medição incremental: ${stats.reprocessedMessages}/${stats.totalMessages} mensagens reprocessadas no flush`,
  );
});
