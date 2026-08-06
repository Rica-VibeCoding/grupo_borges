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

function createCachedStream(options: CachedCanarioStreamOptions): CachedCanarioStream {
  let controller: CanarioStreamController | null = null;
  let unsubscribeController: (() => void) | null = null;
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

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      startController();
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopController();
      listeners.clear();
    },
  };
}

export function createCanarioStreamCache() {
  const entries = new Map<string, CachedCanarioStream>();

  return {
    get(options: CachedCanarioStreamOptions): CachedCanarioStream {
      const key = streamKey(options);
      const cached = entries.get(key);
      if (cached) return cached;
      const stream = createCachedStream(options);
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
