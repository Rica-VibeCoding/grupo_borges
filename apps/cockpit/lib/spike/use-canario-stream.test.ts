import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import {
  createCanarioStream,
  type EventSourceLike,
} from './use-canario-stream.ts';

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '../../../../fixtures/cockpit-v2/familias/borda__content_string.json',
    ),
    'utf8',
  ),
) as { evento: MessagePayload };

const ASSISTANT_END_TURN_FIXTURE = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '../../../../fixtures/cockpit-v2/familias/bloco__text.json',
    ),
    'utf8',
  ),
) as { evento: MessagePayload };

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
    runNext(): void {
      const entry = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;
      assert.ok(entry, 'nenhum timer pendente');
      callbacks.delete(entry[0]);
      entry[1]();
    },
    pending(): number {
      return callbacks.size;
    },
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

    addEventListener(
      type: string,
      listener: (event: { data: string }) => void,
    ): void {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type: string, data: unknown = {}): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ data: JSON.stringify(data) });
      }
    }

    fail(): void {
      this.onerror?.();
    }

    close(): void {
      this.closed = true;
    }
  }

  return { EventSource: FakeEventSource, instances };
}

test('replay real passa pelo coalescedor e expõe loading/running', () => {
  const clock = timers();
  const fake = eventSources();
  const controller = createCanarioStream({
    slug: 'canario teste',
    sessionId: 'sessão/1',
    limit: 321,
    eventSourceConstructor: fake.EventSource,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });
  const source = fake.instances[0];

  assert.match(source.url, /^\/api\/agents\/canario%20teste\/messages\/stream\?/);
  assert.match(source.url, /sessionId=sess%C3%A3o%2F1/);
  assert.match(source.url, /limit=321/);
  source.emit('replay-start', { session_id: 'sessão/1', total: 1 });
  source.emit('message', FIXTURE.evento);

  assert.deepEqual(controller.getSnapshot().messages, []);
  assert.equal(controller.getSnapshot().isLoading, true);
  source.emit('replay-end', { last_id: FIXTURE.evento.id });

  assert.deepEqual(controller.getSnapshot().messages, [FIXTURE.evento]);
  assert.equal(controller.getSnapshot().isLoading, false);
  assert.equal(controller.getSnapshot().isRunning, true);
  assert.equal(controller.getSnapshot().status, 'live');

  source.emit('message', ASSISTANT_END_TURN_FIXTURE.evento);
  source.emit('replay-start');
  source.emit('replay-end');
  assert.equal(controller.getSnapshot().isRunning, false);
  controller.dispose();
});

test('queda no meio do replay preserva o lote já cursado até o novo replay-end', () => {
  const clock = timers();
  const fake = eventSources();
  const controller = createCanarioStream({
    slug: 'canario',
    eventSourceConstructor: fake.EventSource,
    reconnectDelayMs: 1,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });
  const first = fake.instances[0];
  first.emit('replay-start');
  first.emit('message', FIXTURE.evento);
  first.fail();

  assert.deepEqual(controller.getSnapshot().messages, []);
  assert.equal(controller.getSnapshot().isLoading, false);
  clock.runNext();
  const second = fake.instances[1];
  assert.match(second.url, new RegExp(`since_id=${FIXTURE.evento.id}`));
  second.emit('replay-start');
  second.emit('replay-end');

  assert.deepEqual(controller.getSnapshot().messages, [FIXTURE.evento]);
  assert.equal(controller.getSnapshot().isLoading, false);
  controller.dispose();
});

test('reconecta com since_id, sem duplicar e com uma conexão aberta por vez', () => {
  const clock = timers();
  const fake = eventSources();
  const controller = createCanarioStream({
    slug: 'canario',
    eventSourceConstructor: fake.EventSource,
    reconnectDelayMs: 1,
    heartbeatTimeoutMs: 60_000,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });
  const first = fake.instances[0];
  first.emit('replay-start');
  first.emit('message', FIXTURE.evento);
  first.emit('replay-end');
  first.fail();

  assert.equal(controller.getSnapshot().status, 'reconnecting');
  assert.equal(first.closed, true);
  assert.equal(fake.instances.filter((source) => !source.closed).length, 0);

  clock.runNext();
  const second = fake.instances[1];
  assert.match(second.url, new RegExp(`since_id=${FIXTURE.evento.id}`));
  assert.equal(fake.instances.filter((source) => !source.closed).length, 1);

  second.emit('replay-start');
  second.emit('message', FIXTURE.evento);
  second.emit('replay-end');
  assert.equal(controller.getSnapshot().messages.length, 1);

  controller.dispose();
  assert.equal(fake.instances.filter((source) => !source.closed).length, 0);
  assert.equal(clock.pending(), 0);
});

test('watchdog força reconexão silenciosa e dispose cancela tudo', () => {
  const clock = timers();
  const fake = eventSources();
  const controller = createCanarioStream({
    slug: 'canario',
    eventSourceConstructor: fake.EventSource,
    reconnectDelayMs: 1,
    heartbeatTimeoutMs: 10,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  clock.runNext();
  assert.equal(controller.getSnapshot().status, 'reconnecting');
  assert.equal(fake.instances[0].closed, true);
  clock.runNext();
  assert.equal(fake.instances.length, 2);
  assert.equal(fake.instances.filter((source) => !source.closed).length, 1);

  controller.dispose();
  assert.equal(clock.pending(), 0);
  fake.instances[1].emit('message', FIXTURE.evento);
  assert.deepEqual(controller.getSnapshot().messages, []);
});

test('evento com id não-crescente é descartado, mas o descarte fica contado', () => {
  const clock = timers();
  const frames = timers();
  const fake = eventSources();
  const controller = createCanarioStream({
    slug: 'canario',
    sessionId: 's1',
    eventSourceConstructor: fake.EventSource,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    scheduleFrameFn: frames.setTimeout,
    cancelFrameFn: frames.clearTimeout,
  });
  const source = fake.instances[0];

  source.emit('replay-start', { session_id: 's1', total: 1 });
  source.emit('message', FIXTURE.evento);
  source.emit('replay-end', { last_id: FIXTURE.evento.id });
  assert.equal(controller.getSnapshot().descartados, 0);

  // Duplicata de reconexão (mesmo id) e um id menor: os dois somem da lista, e
  // é por isso que precisam aparecer no contador — o item 5 do comportamento
  // observável exige paridade sem evento perdido em silêncio.
  source.emit('message', FIXTURE.evento);
  source.emit('message', { ...FIXTURE.evento, id: (FIXTURE.evento.id as number) - 1 });
  source.emit('message', ASSISTANT_END_TURN_FIXTURE.evento);

  // Descartado não agenda frame; só o evento válido agenda. Um flush resolve.
  assert.equal(frames.pending(), 1);
  frames.runNext();

  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.descartados, 2);
  assert.deepEqual(
    snapshot.messages.map((m) => m.id),
    [FIXTURE.evento.id, ASSISTANT_END_TURN_FIXTURE.evento.id],
  );
  controller.dispose();
});

test('session-reset chama onSessionReset e nada mais — quem remonta é o hook', () => {
  const clock = timers();
  const fake = eventSources();
  let resets = 0;
  const controller = createCanarioStream({
    slug: 'canario',
    eventSourceConstructor: fake.EventSource,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    onSessionReset: () => {
      resets += 1;
    },
  });
  const source = fake.instances[0];

  source.emit('replay-start');
  source.emit('message', FIXTURE.evento);
  source.emit('replay-end');
  assert.equal(controller.getSnapshot().messages.length, 1);

  // O controller não limpa nada sozinho: estado intacto até o hook trocar a
  // geração e nascer um controller novo. Reset em conexão morta não conta.
  source.emit('session-reset', { slug: 'canario', reason: 'relaunch-fresh' });
  assert.equal(resets, 1);
  assert.equal(controller.getSnapshot().messages.length, 1);

  controller.dispose();
  source.emit('session-reset', {});
  assert.equal(resets, 1);
});

test('recentes só vai na primeira conexão — em reconexão manda since_id', () => {
  const clock = timers();
  const fake = eventSources();
  const controller = createCanarioStream({
    slug: 'canario',
    limit: 250,
    recentes: true,
    eventSourceConstructor: fake.EventSource,
    reconnectDelayMs: 1,
    heartbeatTimeoutMs: 60_000,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  // Primeira: sem cursor, então o cliente pede a CAUDA do histórico. É isto que
  // faz `limit` virar teto de verdade em vez de tamanho do primeiro lote.
  const first = fake.instances[0];
  assert.match(first.url, /limit=250/);
  assert.match(first.url, /recentes=1/);
  assert.ok(!first.url.includes('since_id'));

  first.emit('replay-start');
  first.emit('message', FIXTURE.evento);
  first.emit('replay-end');
  first.fail();
  clock.runNext();

  // Reconexão: com cursor na mão, pedir a cauda abriria buraco no meio do que o
  // cliente perdeu — então `recentes` sai da URL.
  const second = fake.instances[1];
  assert.match(second.url, new RegExp(`since_id=${FIXTURE.evento.id}`));
  assert.ok(!second.url.includes('recentes'));
  controller.dispose();
});
