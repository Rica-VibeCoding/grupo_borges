'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { FleetResponse, Task, TaskEvent } from './cockpit-types';
import { useFleetStream, type FleetState, type SseStatus } from './use-fleet-stream';

type FleetContextValue = {
  fleet: FleetResponse;
  tasks: Task[];
  events: TaskEvent[];
  sseStatus: SseStatus;
  reconnect: () => void;
  mutate: () => Promise<void>;
};

const FleetContext = createContext<FleetContextValue | null>(null);

export function FleetProvider({ initial, children }: { initial: FleetState; children: ReactNode }) {
  const state = useFleetStream(initial);

  useEffect(() => {
    document.body.dataset.sse = state.sseStatus === 'closed' ? 'off' : 'on';
  }, [state.sseStatus]);

  return <FleetContext.Provider value={state}>{children}</FleetContext.Provider>;
}

export function useFleet(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleet must be used inside <FleetProvider>');
  return ctx;
}
