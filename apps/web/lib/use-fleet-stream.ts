'use client';

import { useEffect, useRef, useState } from 'react';
import type { FleetResponse, Task } from './cockpit-types';

export type SseStatus = 'connecting' | 'open' | 'closed';

export type FleetState = {
  fleet: FleetResponse;
  tasks: Task[];
  sseStatus: SseStatus;
};

const REFETCH_INTERVAL_MS = 5_000;
const SSE_TRIGGERED_REFETCH_DEBOUNCE_MS = 250;

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

export function useFleetStream(initial: FleetState): FleetState {
  const [state, setState] = useState<FleetState>(initial);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

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

    const es = new EventSource('/api/stream');
    const onOpen = () => {
      if (!alive) return;
      setState((prev) => ({ ...prev, sseStatus: 'open' }));
    };
    const onError = () => {
      if (!alive) return;
      setState((prev) => ({ ...prev, sseStatus: 'closed' }));
    };
    const onAnyEvent = () => triggerRefetchDebounced();

    es.addEventListener('open', onOpen);
    es.addEventListener('error', onError);
    es.addEventListener('message', onAnyEvent);
    es.addEventListener('PostToolUse', onAnyEvent);
    es.addEventListener('UserPromptSubmit', onAnyEvent);
    es.addEventListener('Stop', onAnyEvent);
    es.addEventListener('SessionStart', onAnyEvent);

    schedulePoll();

    return () => {
      alive = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      es.removeEventListener('open', onOpen);
      es.removeEventListener('error', onError);
      es.removeEventListener('message', onAnyEvent);
      es.removeEventListener('PostToolUse', onAnyEvent);
      es.removeEventListener('UserPromptSubmit', onAnyEvent);
      es.removeEventListener('Stop', onAnyEvent);
      es.removeEventListener('SessionStart', onAnyEvent);
      es.close();
    };
  }, []);

  return state;
}
