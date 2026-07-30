'use client';

import { useEffect, useState } from 'react';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { createStreamCoalescer } from '@grupo_borges/cockpit-core/stream-coalescer';

export type CanarioStreamStatus =
  | 'connecting'
  | 'replaying'
  | 'live'
  | 'reconnecting';

export type CanarioStreamState = {
  messages: MessagePayload[];
  isRunning: boolean;
  isLoading: boolean;
  status: CanarioStreamStatus;
  /**
   * Eventos descartados pelo filtro de id não-crescente. O descarte protege
   * contra duplicata de reconexão, mas o item 5 do comportamento observável
   * exige paridade sem evento perdido — então o silêncio tem de ser contável.
   * Diferente de zero num teste de paridade é sinal, não ruído.
   */
  descartados: number;
};

type StreamEvent = { data: string };
type StreamListener = (event: StreamEvent) => void;

export interface EventSourceLike {
  addEventListener(type: string, listener: StreamListener): void;
  close(): void;
  onerror: (() => void) | null;
}

export interface EventSourceConstructor {
  new (url: string): EventSourceLike;
}

type TimerHandle = number;
type SetTimer = (callback: () => void, delayMs: number) => TimerHandle;
type ClearTimer = (handle: TimerHandle) => void;

type CanarioStreamOptions = {
  slug: string;
  sessionId?: string | null;
  limit?: number;
  eventSourceConstructor: EventSourceConstructor;
  reconnectDelayMs?: number;
  heartbeatTimeoutMs?: number;
  setTimeoutFn?: SetTimer;
  clearTimeoutFn?: ClearTimer;
  /**
   * Agendador de frame do coalescedor, separado do `setTimeoutFn` de propósito:
   * watchdog e reconexão querem delay em milissegundos, o coalescedor quer o
   * próximo frame. Sem injetar isto, o caminho LIVE é intestável — e live é
   * exatamente o que o gate G1/G4 mede. Default fica o do coalescedor (rAF).
   */
  scheduleFrameFn?: (callback: () => void) => number;
  cancelFrameFn?: (handle: number) => void;
};

type CanarioStreamController = {
  getSnapshot(): CanarioStreamState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

const INITIAL_STATE: CanarioStreamState = {
  messages: [],
  isRunning: false,
  isLoading: false,
  status: 'connecting',
  descartados: 0,
};

function buildStreamUrl(
  slug: string,
  sessionId: string | null | undefined,
  limit: number,
  sinceId: number | undefined,
): string {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  if (sessionId) params.set('sessionId', sessionId);
  if (sinceId !== undefined) params.set('since_id', String(sinceId));
  return `/api/agents/${encodeURIComponent(slug)}/messages/stream?${params}`;
}

function responseIsRunning(
  previous: boolean,
  messages: readonly MessagePayload[],
): boolean {
  let running = previous;
  for (const payload of messages) {
    if (payload.message?.role === 'user') {
      running = true;
    } else if (payload.message?.role === 'assistant') {
      running = payload.message.stop_reason !== 'end_turn';
    }
  }
  return running;
}

export function createCanarioStream(
  options: CanarioStreamOptions,
): CanarioStreamController {
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 35_000;
  const schedule: SetTimer =
    options.setTimeoutFn ??
    ((callback, delayMs) =>
      setTimeout(callback, delayMs) as unknown as TimerHandle);
  const cancel: ClearTimer =
    options.clearTimeoutFn ??
    ((handle) => clearTimeout(handle));

  let state = INITIAL_STATE;
  let source: EventSourceLike | null = null;
  let reconnectTimer: TimerHandle | undefined;
  let watchdogTimer: TimerHandle | undefined;
  let disposed = false;
  let generation = 0;
  const listeners = new Set<() => void>();

  function publish(next: CanarioStreamState): void {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener();
  }

  const coalescer = createStreamCoalescer<MessagePayload>({
    schedule: options.scheduleFrameFn,
    cancel: options.cancelFrameFn,
    idOf: (message) => message.id,
    onFlush(batch) {
      publish({
        ...state,
        messages: state.messages.concat(batch),
        isRunning: responseIsRunning(state.isRunning, batch),
      });
    },
  });

  function clearWatchdog(): void {
    if (watchdogTimer !== undefined) {
      cancel(watchdogTimer);
      watchdogTimer = undefined;
    }
  }

  function armWatchdog(): void {
    clearWatchdog();
    watchdogTimer = schedule(() => {
      watchdogTimer = undefined;
      reconnect();
    }, heartbeatTimeoutMs);
  }

  function closeSource(): void {
    if (source !== null) {
      source.close();
      source = null;
    }
  }

  function reconnect(): void {
    if (disposed || reconnectTimer !== undefined) return;
    generation += 1;
    closeSource();
    clearWatchdog();
    publish({ ...state, isLoading: false, status: 'reconnecting' });
    reconnectTimer = schedule(() => {
      reconnectTimer = undefined;
      connect();
    }, reconnectDelayMs);
  }

  function connect(): void {
    if (disposed) return;

    // Fecha defensivamente antes de criar: a invariável é no máximo uma
    // conexão EventSource aberta, inclusive durante troca de rede/retry.
    closeSource();
    const connectionGeneration = ++generation;
    const streamUrl = buildStreamUrl(
      options.slug,
      options.sessionId,
      options.limit ?? 500,
      coalescer.lastId(),
    );
    const nextSource = new options.eventSourceConstructor(streamUrl);
    source = nextSource;

    const isCurrent = () =>
      !disposed &&
      generation === connectionGeneration &&
      source === nextSource;

    nextSource.addEventListener('replay-start', () => {
      if (!isCurrent()) return;
      coalescer.beginReplay();
      publish({ ...state, isLoading: true, status: 'replaying' });
      armWatchdog();
    });

    nextSource.addEventListener('message', (event) => {
      if (!isCurrent()) return;
      try {
        const payload = JSON.parse(event.data) as MessagePayload;
        const lastId = coalescer.lastId();
        if (
          typeof payload.id !== 'number' ||
          !Number.isSafeInteger(payload.id) ||
          (lastId !== undefined && payload.id <= lastId)
        ) {
          // Incrementa sem publicar: um publish por evento descartado geraria
          // re-render por evento, que é exatamente o que o coalescedor existe
          // para evitar. O contador sai no próximo flush natural.
          state = { ...state, descartados: state.descartados + 1 };
          return;
        }
        coalescer.push(payload);
        armWatchdog();
      } catch {
        // Evento malformado não deve derrubar o transporte nem mover o cursor.
      }
    });

    nextSource.addEventListener('replay-end', () => {
      if (!isCurrent()) return;
      coalescer.endReplay();
      publish({ ...state, isLoading: false, status: 'live' });
      armWatchdog();
    });

    nextSource.addEventListener('heartbeat', () => {
      if (!isCurrent()) return;
      armWatchdog();
    });

    nextSource.onerror = () => {
      if (isCurrent()) reconnect();
    };

    armWatchdog();
  }

  connect();

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      closeSource();
      clearWatchdog();
      if (reconnectTimer !== undefined) {
        cancel(reconnectTimer);
        reconnectTimer = undefined;
      }
      coalescer.dispose();
      listeners.clear();
    },
  };
}

export type UseCanarioStreamOptions = {
  slug: string;
  sessionId?: string | null;
  limit?: number;
  eventSourceConstructor?: EventSourceConstructor;
};

export function useCanarioStream({
  slug,
  sessionId,
  limit = 500,
  eventSourceConstructor,
}: UseCanarioStreamOptions): CanarioStreamState {
  const [state, setState] = useState<CanarioStreamState>(INITIAL_STATE);

  useEffect(() => {
    const EventSourceImpl =
      eventSourceConstructor ??
      (globalThis.EventSource as unknown as EventSourceConstructor | undefined);
    if (!EventSourceImpl) {
      throw new Error('EventSource não está disponível neste ambiente');
    }

    const controller = createCanarioStream({
      slug,
      sessionId,
      limit,
      eventSourceConstructor: EventSourceImpl,
    });
    setState(controller.getSnapshot());
    const unsubscribe = controller.subscribe(() => {
      setState(controller.getSnapshot());
    });

    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [eventSourceConstructor, limit, sessionId, slug]);

  return state;
}
