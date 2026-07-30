export interface StreamCoalescerOptions<T> {
  onFlush: (batch: T[]) => void;
  schedule?: (cb: () => void) => number;
  cancel?: (handle: number) => void;
  idOf?: (item: T) => number | undefined;
}

export interface StreamCoalescer<T> {
  push(item: T): void;
  beginReplay(): void;
  endReplay(): void;
  flushNow(): void;
  lastId(): number | undefined;
  pending(): number;
  dispose(): void;
}

type Scheduler = {
  schedule: (cb: () => void) => number;
  cancel: (handle: number) => void;
};

function defaultScheduler(): Scheduler {
  if (typeof requestAnimationFrame === 'function') {
    return {
      schedule: (cb) => requestAnimationFrame(cb),
      cancel: (handle) => cancelAnimationFrame(handle),
    };
  }

  return {
    schedule: (cb) => setTimeout(cb, 16) as unknown as number,
    cancel: (handle) => clearTimeout(handle),
  };
}

export function createStreamCoalescer<T>(
  opts: StreamCoalescerOptions<T>,
): StreamCoalescer<T> {
  const fallback = defaultScheduler();
  const schedule = opts.schedule ?? fallback.schedule;
  // Cancel default só vale para o schedule default: cancelar handle de um
  // scheduler custom com cancelAnimationFrame acerta um id alheio. Sem cancel
  // próprio, quem segura o flush indevido é a checagem de token no callback.
  const cancel = opts.cancel ?? (opts.schedule ? () => {} : fallback.cancel);
  const idOf = opts.idOf ?? (() => undefined);

  let buffer: T[] = [];
  let scheduledHandle: number | undefined;
  let scheduledToken: number | undefined;
  let nextToken = 1;
  let replaying = false;
  let disposed = false;
  let watermark: number | undefined;

  function cancelScheduled(): void {
    if (scheduledToken === undefined) return;
    scheduledToken = undefined;
    if (scheduledHandle !== undefined) cancel(scheduledHandle);
    scheduledHandle = undefined;
  }

  function flush(): void {
    if (disposed || replaying || buffer.length === 0) return;

    // Troca antes do callback: push reentrante pertence ao próximo lote.
    const batch = buffer;
    buffer = [];
    opts.onFlush(batch);
  }

  function scheduleFlush(): void {
    if (disposed || replaying || scheduledToken !== undefined) return;

    const token = nextToken++;
    scheduledToken = token;
    const handle = schedule(() => {
      // Canceladores custom podem não remover callback já enfileirado.
      if (scheduledToken !== token) return;
      scheduledToken = undefined;
      scheduledHandle = undefined;
      flush();
    });
    if (scheduledToken === token) scheduledHandle = handle;
  }

  return {
    push(item) {
      if (disposed) return;

      const id = idOf(item);
      if (id !== undefined && (watermark === undefined || id > watermark)) {
        watermark = id;
      }

      buffer.push(item);
      scheduleFlush();
    },

    beginReplay() {
      if (disposed) return;
      replaying = true;
      cancelScheduled();
    },

    endReplay() {
      if (disposed || !replaying) return;
      replaying = false;
      flush();
    },

    flushNow() {
      if (disposed || replaying) return;
      cancelScheduled();
      flush();
    },

    lastId() {
      return watermark;
    },

    pending() {
      return buffer.length;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      cancelScheduled();
      buffer = [];
    },
  };
}
