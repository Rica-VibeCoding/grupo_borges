'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FleetResponse, Task } from './cockpit-types';

export type SseStatus = 'connecting' | 'open' | 'closed';

export type FleetState = {
  fleet: FleetResponse;
  tasks: Task[];
  sseStatus: SseStatus;
};

export type FleetStreamState = FleetState & {
  reconnect: () => void;
};

const REFETCH_INTERVAL_MS = 5_000;
const SSE_TRIGGERED_REFETCH_DEBOUNCE_MS = 250;
const SSE_MAX_BACKOFF_SECONDS = 60;

async function fetchSnapshot(): Promise<{ fleet: FleetResponse; tasks: Task[] }> {
  const [fleetRes, tasksRes] = await Promise.all([
    fetch('/api/fleet', { cache: 'no-store' }),
    fetch('/api/tasks', { cache: 'no-store' }),
  ]);
  if (!fleetRes.ok) throw new Error(`/api/fleet ${fleetRes.status}`);
  if (!tasksRes.ok) throw new Error(`/api/tasks ${tasksRes.status}`);
  const [fleet, tasks] = await Promise.all([fleetRes.json(), tasksRes.json()]);
  return { fleet, tasks };
}

function getReconnectDelay(attempt: number): number {
  const baseMs = Math.min(2 ** (attempt - 1), SSE_MAX_BACKOFF_SECONDS) * 1000;
  const jitter = 0.9 + Math.random() * 0.2;
  return baseMs * jitter;
}

export function useFleetStream(initial: FleetState): FleetStreamState {
  const [state, setState] = useState<FleetState>(initial);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSource = useRef<EventSource | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectRef = useRef<() => void>(() => {});
  const reqSeq = useRef(0);
  const reconnect = useCallback(() => reconnectRef.current(), []);

  useEffect(() => {
    let alive = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const refetch = async () => {
      const mySeq = ++reqSeq.current;
      try {
        const snapshot = await fetchSnapshot();
        if (!alive || mySeq !== reqSeq.current) return;
        setState((prev) => ({ ...snapshot, sseStatus: prev.sseStatus }));
      } catch {
        if (!alive || mySeq !== reqSeq.current) return;
        setState((prev) => ({ ...prev, sseStatus: 'closed' }));
      }
    };

    const schedulePoll = () => {
      if (!alive) return;
      pollTimer = setTimeout(async () => {
        await refetch();
        schedulePoll();
      }, REFETCH_INTERVAL_MS);
    };

    const triggerRefetchDebounced = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        void refetch();
      }, SSE_TRIGGERED_REFETCH_DEBOUNCE_MS);
    };

    const onOpen = () => {
      if (!alive) return;
      reconnectAttempt.current = 0;
      clearReconnectTimer();
      setState((prev) => ({ ...prev, sseStatus: 'open' }));
    };
    const onAnyEvent = () => triggerRefetchDebounced();

    const removeEventListeners = (es: EventSource) => {
      es.removeEventListener('open', onOpen);
      es.removeEventListener('error', onError);
      es.removeEventListener('message', onAnyEvent);
      es.removeEventListener('PostToolUse', onAnyEvent);
      es.removeEventListener('UserPromptSubmit', onAnyEvent);
      es.removeEventListener('Stop', onAnyEvent);
      es.removeEventListener('SessionStart', onAnyEvent);
    };

    const closeEventSource = () => {
      if (!eventSource.current) return;
      removeEventListeners(eventSource.current);
      eventSource.current.close();
      eventSource.current = null;
    };

    const clearReconnectTimer = () => {
      if (!reconnectTimer.current) return;
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    };

    const connect = () => {
      if (!alive) return;
      closeEventSource();
      setState((prev) => ({ ...prev, sseStatus: 'connecting' }));

      const es = new EventSource('/api/stream');
      eventSource.current = es;
      es.addEventListener('open', onOpen);
      es.addEventListener('error', onError);
      es.addEventListener('message', onAnyEvent);
      es.addEventListener('PostToolUse', onAnyEvent);
      es.addEventListener('UserPromptSubmit', onAnyEvent);
      es.addEventListener('Stop', onAnyEvent);
      es.addEventListener('SessionStart', onAnyEvent);
    };

    const scheduleReconnect = () => {
      if (!alive || reconnectTimer.current) return;
      const attempt = reconnectAttempt.current + 1;
      reconnectAttempt.current = attempt;
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        connect();
      }, getReconnectDelay(attempt));
    };

    function onError() {
      if (!alive) return;
      closeEventSource();
      setState((prev) => ({ ...prev, sseStatus: 'closed' }));
      scheduleReconnect();
    }

    reconnectRef.current = () => {
      if (!alive) return;
      clearReconnectTimer();
      reconnectAttempt.current = 0;
      connect();
    };

    connect();

    schedulePoll();

    return () => {
      alive = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      clearReconnectTimer();
      closeEventSource();
      reconnectRef.current = () => {};
    };
  }, []);

  return { ...state, reconnect };
}
