'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FleetResponse, Task, TaskEvent } from './cockpit-types';

export type SseStatus = 'connecting' | 'open' | 'closed';

export type FleetState = {
  fleet: FleetResponse;
  tasks: Task[];
  events: TaskEvent[];
  sseStatus: SseStatus;
};

export type FleetStreamState = FleetState & {
  reconnect: () => void;
};

const REFETCH_INTERVAL_MS = 5_000;
const SSE_TRIGGERED_REFETCH_DEBOUNCE_MS = 250;
const SSE_MAX_BACKOFF_SECONDS = 60;
const EVENT_BUFFER_CAP = 200;
const INITIAL_EVENT_FETCH_LIMIT = 50;

function mergeEvents(a: TaskEvent[], b: TaskEvent[]): TaskEvent[] {
  const seen = new Set<number>();
  const merged: TaskEvent[] = [];
  for (const ev of [...a, ...b]) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    merged.push(ev);
  }
  merged.sort((x, y) => y.id - x.id);
  return merged.slice(0, EVENT_BUFFER_CAP);
}

async function fetchSnapshot(): Promise<{ fleet: FleetResponse; tasks: Task[]; events: TaskEvent[] }> {
  const [fleetRes, tasksRes, eventsRes] = await Promise.all([
    fetch('/api/fleet', { cache: 'no-store' }),
    fetch('/api/tasks', { cache: 'no-store' }),
    fetch(`/api/events?limit=${INITIAL_EVENT_FETCH_LIMIT}`, { cache: 'no-store' }),
  ]);
  if (!fleetRes.ok) throw new Error(`/api/fleet ${fleetRes.status}`);
  if (!tasksRes.ok) throw new Error(`/api/tasks ${tasksRes.status}`);
  if (!eventsRes.ok) throw new Error(`/api/events ${eventsRes.status}`);
  const [fleet, tasks, events] = await Promise.all([fleetRes.json(), tasksRes.json(), eventsRes.json()]);
  return { fleet, tasks, events };
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
        setState((prev) => ({
          fleet: snapshot.fleet,
          tasks: snapshot.tasks,
          events: mergeEvents(prev.events, snapshot.events),
          sseStatus: prev.sseStatus,
        }));
      } catch {
        if (!alive || mySeq !== reqSeq.current) return;
        setState((prev) => ({ ...prev, sseStatus: 'closed' }));
      }
    };

    const ingestEvent = (raw: string, kind: string) => {
      let obj: Partial<TaskEvent> & { id?: number };
      try {
        obj = JSON.parse(raw) as Partial<TaskEvent> & { id?: number };
      } catch {
        return;
      }
      if (typeof obj.id !== 'number') return;
      const ev: TaskEvent = {
        id: obj.id,
        task_id: obj.task_id ?? null,
        agent_slug: obj.agent_slug ?? null,
        instance_id: obj.instance_id ?? null,
        kind: typeof obj.kind === 'string' ? obj.kind : kind,
        payload: (obj.payload as Record<string, unknown> | null | undefined) ?? null,
        created_at: typeof obj.created_at === 'number'
          ? obj.created_at
          : Math.floor(Date.now() / 1000),
      };
      setState((prev) => {
        if (prev.events.length && prev.events[0]!.id === ev.id) return prev;
        const next = [ev, ...prev.events.filter((e) => e.id !== ev.id)].slice(0, EVENT_BUFFER_CAP);
        return { ...prev, events: next };
      });
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

    // 5 listeners distintos por design — sse-starlette emite event types específicos.
    // Cada um faz o mesmo trabalho (ingest + debounced refetch), mas precisa ser
    // registrado por nome pra capturar o `event:` SSE corretamente.
    const SSE_EVENT_KINDS = ['message', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart'] as const;
    const sseHandlers: Array<[string, EventListener]> = SSE_EVENT_KINDS.map((kind) => [
      kind,
      ((e: MessageEvent) => {
        ingestEvent(e.data, kind);
        triggerRefetchDebounced();
      }) as EventListener,
    ]);

    const removeEventListeners = (es: EventSource) => {
      es.removeEventListener('open', onOpen);
      es.removeEventListener('error', onError);
      for (const [kind, handler] of sseHandlers) es.removeEventListener(kind, handler);
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
      for (const [kind, handler] of sseHandlers) es.addEventListener(kind, handler);
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
