import {
  createCanarioStream,
  INITIAL_CANARIO_STREAM_STATE,
  type CanarioStreamController,
  type CanarioStreamOptions,
  type CanarioStreamState,
} from './canario-stream-controller.ts';

export type CachedCanarioStreamState = CanarioStreamState & { geracao: number };
export type CachedCanarioStreamOptions = Omit<CanarioStreamOptions, 'onSessionReset'>;

export type CachedCanarioStream = {
  getSnapshot(): CachedCanarioStreamState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

type TimerHandle = number;
type SetTimer = (callback: () => void, delayMs: number) => TimerHandle;
type ClearTimer = (handle: TimerHandle) => void;

type CanarioStreamCacheOptions = {
  idleTtlMs?: number;
  setTimeoutFn?: SetTimer;
  clearTimeoutFn?: ClearTimer;
};

export const CANARIO_STREAM_IDLE_TTL_MS = 5_000;

export const INITIAL_CACHED_CANARIO_STREAM_STATE: CachedCanarioStreamState = {
  ...INITIAL_CANARIO_STREAM_STATE,
  geracao: 0,
};

function streamKey(options: CachedCanarioStreamOptions): string {
  return JSON.stringify([
    options.slug,
    options.sessionId ?? null,
    options.limit ?? 500,
    options.recentes ?? false,
  ]);
}

function createCachedStream(
  options: CachedCanarioStreamOptions,
  idleTtlMs: number,
  schedule: SetTimer,
  cancel: ClearTimer,
  onDispose: () => void,
): CachedCanarioStream {
  let controller: CanarioStreamController | null = null;
  let unsubscribeController: (() => void) | null = null;
  let idleTimer: TimerHandle | undefined;
  let snapshot = INITIAL_CACHED_CANARIO_STREAM_STATE;
  let geracao = 0;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = (state: CanarioStreamState) => {
    snapshot = { ...state, geracao };
    for (const listener of listeners) listener();
  };

  const stopController = () => {
    unsubscribeController?.();
    unsubscribeController = null;
    controller?.dispose();
    controller = null;
  };

  const startController = () => {
    if (disposed || controller) return;
    controller = createCanarioStream({
      ...options,
      onSessionReset: () => {
        stopController();
        geracao += 1;
        publish(INITIAL_CANARIO_STREAM_STATE);
        startController();
      },
    });
    publish(controller.getSnapshot());
    unsubscribeController = controller.subscribe(() => {
      if (controller) publish(controller.getSnapshot());
    });
  };

  const cancelIdleDispose = () => {
    if (idleTimer === undefined) return;
    cancel(idleTimer);
    idleTimer = undefined;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelIdleDispose();
    stopController();
    listeners.clear();
    onDispose();
  };

  const scheduleIdleDispose = () => {
    cancelIdleDispose();
    idleTimer = schedule(() => {
      idleTimer = undefined;
      dispose();
    }, idleTtlMs);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      cancelIdleDispose();
      listeners.add(listener);
      startController();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        if (listeners.size === 0) scheduleIdleDispose();
      };
    },
    dispose,
  };
}

export function createCanarioStreamCache(options: CanarioStreamCacheOptions = {}) {
  const entries = new Map<string, CachedCanarioStream>();
  const idleTtlMs = options.idleTtlMs ?? CANARIO_STREAM_IDLE_TTL_MS;
  const schedule: SetTimer =
    options.setTimeoutFn ??
    ((callback, delayMs) =>
      setTimeout(callback, delayMs) as unknown as TimerHandle);
  const cancel: ClearTimer =
    options.clearTimeoutFn ??
    ((handle) => clearTimeout(handle));

  return {
    get(options: CachedCanarioStreamOptions): CachedCanarioStream {
      const key = streamKey(options);
      const cached = entries.get(key);
      if (cached) return cached;
      let stream: CachedCanarioStream;
      stream = createCachedStream(options, idleTtlMs, schedule, cancel, () => {
        if (entries.get(key) === stream) entries.delete(key);
      });
      entries.set(key, stream);
      return stream;
    },
    disposeAll() {
      for (const stream of entries.values()) stream.dispose();
      entries.clear();
    },
    size: () => entries.size,
  };
}

export const canarioStreamCache = createCanarioStreamCache();
