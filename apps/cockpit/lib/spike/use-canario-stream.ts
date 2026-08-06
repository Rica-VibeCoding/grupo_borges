'use client';

import { useMemo, useSyncExternalStore } from 'react';

import {
  canarioStreamCache,
  INITIAL_CACHED_CANARIO_STREAM_STATE,
} from './canario-stream-cache.ts';
import type {
  EventSourceConstructor,
} from './canario-stream-controller.ts';

export {
  createCanarioStream,
  type CanarioStreamState,
  type CanarioStreamStatus,
  type EventSourceConstructor,
  type EventSourceLike,
} from './canario-stream-controller.ts';

export type UseCanarioStreamOptions = {
  slug: string;
  sessionId?: string | null;
  limit?: number;
  /** Faz o limite morder na cauda do histórico; ver o controller. */
  recentes?: boolean;
  eventSourceConstructor?: EventSourceConstructor;
};

const SERVER_STORE = {
  getSnapshot: () => INITIAL_CACHED_CANARIO_STREAM_STATE,
  subscribe: () => () => {},
};

export function useCanarioStream({
  slug,
  sessionId,
  limit = 500,
  recentes = false,
  eventSourceConstructor,
}: UseCanarioStreamOptions) {
  const EventSourceImpl = eventSourceConstructor ??
    (globalThis.EventSource as unknown as EventSourceConstructor | undefined);

  const store = useMemo(() => {
    if (!EventSourceImpl) return SERVER_STORE;
    return canarioStreamCache.get({
      slug,
      sessionId,
      limit,
      recentes,
      eventSourceConstructor: EventSourceImpl,
    });
  }, [EventSourceImpl, limit, recentes, sessionId, slug]);

  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => INITIAL_CACHED_CANARIO_STREAM_STATE,
  );
}
