'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { SubagentStatusEntry } from '../lib/messages-types';

export type SseSubagentEvent = SubagentStatusEntry & { slug: string };
export type SseSubagentHandler = (event: SseSubagentEvent) => void;

type SseContextValue = {
  subscribe: (slug: string, handler: SseSubagentHandler) => () => void;
};

const SseContext = createContext<SseContextValue | null>(null);

export function useSseProvider(): SseContextValue | null {
  return useContext(SseContext);
}

// Backoff exponencial: 1s → 2s → 4s → 8s → 15s → 30s (cap). Evita
// reconect loop (regressão JP-11). Zera após reconexão bem-sucedida.
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

function buildUrl(slugs: Set<string>): string {
  if (slugs.size === 0) return '';
  const sorted = [...slugs].sort().join(',');
  return `/api/events/stream?slugs=${encodeURIComponent(sorted)}`;
}

export function SseProvider({ children }: { children: ReactNode }) {
  // handlers: slug → Set<handler>. Não é state — mutações não disparam render.
  const handlersRef = useRef<Map<string, Set<SseSubagentHandler>>>(new Map());
  const sourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Chave atual da URL (slugs sorted,joined) pra evitar reconnect desnecessário.
  const slugsKeyRef = useRef('');
  // Debounce de 200ms ao mudar o set de slugs (subscribe/unsubscribe em burst).
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openSource = useCallback((url: string) => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    if (!url || !mountedRef.current) return;

    const es = new EventSource(url);
    sourceRef.current = es;

    es.addEventListener('subagent_status', (ev) => {
      try {
        const event = JSON.parse((ev as MessageEvent).data) as SseSubagentEvent;
        if (!event?.slug || !event.parent_uuid || !event.status) return;
        // Reset backoff: servidor está respondendo.
        retryCountRef.current = 0;
        const handlers = handlersRef.current.get(event.slug);
        if (handlers) {
          for (const h of handlers) h(event);
        }
      } catch {
        /* payload mal-formado: ignora */
      }
    });

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close();
      sourceRef.current = null;
      const delay =
        RECONNECT_BACKOFF_MS[Math.min(retryCountRef.current, RECONNECT_BACKOFF_MS.length - 1)];
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (!mountedRef.current) return;
        openSource(url);
      }, delay);
    };
  }, []); // refs não são deps

  const rebuild = useCallback(() => {
    const slugs = new Set(handlersRef.current.keys());
    const url = buildUrl(slugs);
    const key = [...slugs].sort().join(',');
    if (key === slugsKeyRef.current) return;
    slugsKeyRef.current = key;
    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    openSource(url);
  }, [openSource]);

  const scheduleRebuild = useCallback(() => {
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
    rebuildTimerRef.current = setTimeout(rebuild, 200);
  }, [rebuild]);

  const subscribe = useCallback(
    (slug: string, handler: SseSubagentHandler): (() => void) => {
      let set = handlersRef.current.get(slug);
      if (!set) {
        set = new Set();
        handlersRef.current.set(slug, set);
      }
      set.add(handler);
      scheduleRebuild();
      return () => {
        const s = handlersRef.current.get(slug);
        if (s) {
          s.delete(handler);
          if (s.size === 0) handlersRef.current.delete(slug);
        }
        scheduleRebuild();
      };
    },
    [scheduleRebuild],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, []);

  const value = useMemo<SseContextValue>(() => ({ subscribe }), [subscribe]);

  return <SseContext.Provider value={value}>{children}</SseContext.Provider>;
}
