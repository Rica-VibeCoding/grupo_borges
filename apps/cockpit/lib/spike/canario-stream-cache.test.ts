import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { createCanarioStreamCache } from './canario-stream-cache.ts';
import type { EventSourceLike } from './canario-stream-controller.ts';

const MESSAGE = (JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias/borda__content_string.json'),
    'utf8',
  ),
) as { evento: MessagePayload }).evento;

function timers() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  return {
    setTimeout(callback: () => void): number {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    clearTimeout(handle: number): void {
      callbacks.delete(handle);
    },
    pending: () => callbacks.size,
  };
}

function eventSources() {
  const instances: FakeEventSource[] = [];
  class FakeEventSource implements EventSourceLike {
    readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();
    onerror: (() => void) | null = null;
    closed = false;
    readonly url: string;
    constructor(url: string) {
      this.url = url;
      instances.push(this);
    }
    addEventListener(type: string, listener: (event: { data: string }) => void): void {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    emit(type: string, data: unknown = {}): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ data: JSON.stringify(data) });
      }
    }
    close(): void { this.closed = true; }
  }
  return { EventSource: FakeEventSource, instances };
}

test('cache por slug preserva histórico e conexão depois do unmount', () => {
  const clock = timers();
  const fake = eventSources();
  const cache = createCanarioStreamCache();
  const options = {
    slug: 'pavan',
    limit: 1000,
    recentes: true,
    eventSourceConstructor: fake.EventSource,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  };

  const stream = cache.get(options);
  const unsubscribe = stream.subscribe(() => {});
  fake.instances[0].emit('replay-start');
  fake.instances[0].emit('message', MESSAGE);
  fake.instances[0].emit('replay-end');
  unsubscribe();

  const revisita = cache.get(options);
  assert.equal(revisita, stream);
  assert.deepEqual(revisita.getSnapshot().messages, [MESSAGE]);
  const unsubscribeAgain = revisita.subscribe(() => {});
  assert.equal(fake.instances.length, 1, 'revisita não abre outro EventSource');

  const outro = cache.get({ ...options, slug: 'hiro' });
  const unsubscribeOther = outro.subscribe(() => {});
  assert.equal(fake.instances.length, 2, 'outro slug ganha conexão própria');
  assert.deepEqual(outro.getSnapshot().messages, []);

  unsubscribeAgain();
  unsubscribeOther();
  cache.disposeAll();
  assert.ok(fake.instances.every((source) => source.closed));
  assert.equal(clock.pending(), 0);
});

test('session-reset zera e reconecta só o slug atingido', () => {
  const clock = timers();
  const fake = eventSources();
  const cache = createCanarioStreamCache();
  const base = {
    limit: 1000,
    recentes: true,
    eventSourceConstructor: fake.EventSource,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  };
  const pavan = cache.get({ ...base, slug: 'pavan' });
  const hiro = cache.get({ ...base, slug: 'hiro' });
  pavan.subscribe(() => {});
  hiro.subscribe(() => {});
  for (const source of fake.instances) {
    source.emit('replay-start');
    source.emit('message', MESSAGE);
    source.emit('replay-end');
  }

  fake.instances[0].emit('session-reset');

  assert.equal(pavan.getSnapshot().geracao, 1);
  assert.deepEqual(pavan.getSnapshot().messages, []);
  assert.equal(hiro.getSnapshot().geracao, 0);
  assert.deepEqual(hiro.getSnapshot().messages, [MESSAGE]);
  assert.equal(fake.instances.length, 3);
  assert.equal(fake.instances[0].closed, true);
  assert.equal(fake.instances[1].closed, false);
  cache.disposeAll();
});
