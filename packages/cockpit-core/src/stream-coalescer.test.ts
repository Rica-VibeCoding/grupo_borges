import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStreamCoalescer } from './stream-coalescer.ts';

function manualScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();

  return {
    schedule(callback: () => void): number {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle: number): void {
      callbacks.delete(handle);
    },
    runFrame(): void {
      const frame = [...callbacks.values()];
      callbacks.clear();
      for (const callback of frame) callback();
    },
    scheduled(): number {
      return callbacks.size;
    },
  };
}

test('live: agrupa todos os pushes em no máximo um flush por frame', () => {
  const clock = manualScheduler();
  const batches: number[][] = [];
  const stream = createStreamCoalescer<number>({
    onFlush: (batch) => batches.push(batch),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  stream.push(1);
  stream.push(2);
  stream.push(3);

  assert.equal(clock.scheduled(), 1);
  assert.deepEqual(batches, []);
  clock.runFrame();
  assert.deepEqual(batches, [[1, 2, 3]]);
});

test('replay não flusha entre beginReplay e endReplay', () => {
  const clock = manualScheduler();
  const batches: string[][] = [];
  const stream = createStreamCoalescer<string>({
    onFlush: (batch) => batches.push(batch),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  stream.beginReplay();
  stream.push('a');
  clock.runFrame();
  stream.push('b');
  clock.runFrame();

  assert.deepEqual(batches, []);
  stream.endReplay();
  assert.deepEqual(batches, [['a', 'b']]);
});

test('preserva ordem em live, replay e na transição entre ambos', () => {
  const clock = manualScheduler();
  const delivered: string[] = [];
  const stream = createStreamCoalescer<string>({
    onFlush: (batch) => delivered.push(...batch),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  stream.push('live-1');
  stream.beginReplay();
  stream.push('replay-1');
  stream.push('replay-2');
  stream.endReplay();
  stream.push('live-2');
  clock.runFrame();

  assert.deepEqual(delivered, ['live-1', 'replay-1', 'replay-2', 'live-2']);
});

test('lastId só cresce, sem descartar itens de id repetido ou menor', () => {
  const clock = manualScheduler();
  const delivered: Array<{ id: number; value: string }> = [];
  const stream = createStreamCoalescer<{ id: number; value: string }>({
    onFlush: (batch) => delivered.push(...batch),
    schedule: clock.schedule,
    cancel: clock.cancel,
    idOf: (item) => item.id,
  });

  stream.push({ id: 10, value: 'maior' });
  stream.push({ id: 10, value: 'igual' });
  stream.push({ id: 3, value: 'menor' });

  assert.equal(stream.lastId(), 10);
  clock.runFrame();
  assert.deepEqual(delivered.map((item) => item.value), ['maior', 'igual', 'menor']);
  assert.equal(stream.lastId(), 10);
});

test('dispose é idempotente, cancela o frame e descarta sem flush', () => {
  const clock = manualScheduler();
  const batches: number[][] = [];
  const stream = createStreamCoalescer<number>({
    onFlush: (batch) => batches.push(batch),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  stream.push(1);
  stream.dispose();
  stream.dispose();
  stream.push(2);

  assert.equal(clock.scheduled(), 0);
  assert.equal(stream.pending(), 0);
  clock.runFrame();
  assert.deepEqual(batches, []);
});

test('flushNow é síncrono e cancela o frame agendado', () => {
  const clock = manualScheduler();
  const batches: number[][] = [];
  const stream = createStreamCoalescer<number>({
    onFlush: (batch) => batches.push(batch),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  stream.push(1);
  stream.push(2);
  stream.flushNow();

  assert.deepEqual(batches, [[1, 2]]);
  assert.equal(clock.scheduled(), 0);
  clock.runFrame();
  assert.deepEqual(batches, [[1, 2]]);
});

test('push reentrante feito por onFlush segue para o próximo lote', () => {
  const clock = manualScheduler();
  const batches: number[][] = [];
  let stream: ReturnType<typeof createStreamCoalescer<number>>;
  stream = createStreamCoalescer<number>({
    onFlush(batch) {
      batches.push(batch);
      if (batch[0] === 1) stream.push(2);
    },
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  stream.push(1);
  clock.runFrame();

  assert.deepEqual(batches, [[1]]);
  assert.equal(stream.pending(), 1);
  assert.equal(clock.scheduled(), 1);
  clock.runFrame();
  assert.deepEqual(batches, [[1], [2]]);
});

test('beginReplay cancela frame live já agendado e impede vazamento', () => {
  const clock = manualScheduler();
  const batches: string[][] = [];
  const stream = createStreamCoalescer<string>({
    onFlush: (batch) => batches.push(batch),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  stream.push('live-pendente');
  stream.beginReplay();
  stream.push('replay');
  clock.runFrame();

  assert.deepEqual(batches, []);
  assert.equal(stream.pending(), 2);
  stream.endReplay();
  assert.deepEqual(batches, [['live-pendente', 'replay']]);
});
