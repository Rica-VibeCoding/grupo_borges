'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AgentActivityOverride, FleetResponse, TaskEvent } from '@grupo_borges/cockpit-core/cockpit-types';
import {
  ACTIVE_STATES,
  ACTIVITY_MIN_VISIBLE_MS,
  activityFromTaskEvent,
  applyActivityOverrides,
  eventDetail,
  FLEET_SSE_EVENT_KINDS,
  pruneActivityOverrides,
} from './frota-activity';

const POLL_INTERVAL_MS = 5_000;
const REFETCH_DEBOUNCE_MS = 250;
const MAX_BACKOFF_SECONDS = 60;

async function fetchFleetClient(): Promise<FleetResponse> {
  const response = await fetch('/api/fleet', { cache: 'no-store' });
  if (!response.ok) throw new Error(`/api/fleet ${response.status}`);
  return response.json();
}

function reconnectDelay(attempt: number): number {
  const base = Math.min(2 ** (attempt - 1), MAX_BACKOFF_SECONDS) * 1_000;
  return base * (0.9 + Math.random() * 0.2);
}

export function useFrotaAoVivo(initialFleet: FleetResponse): FleetResponse {
  const [fleet, setFleet] = useState(initialFleet);
  const [overrides, setOverrides] = useState<Record<string, AgentActivityOverride>>({});
  const requestSequence = useRef(0);

  const refetch = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const next = await fetchFleetClient();
    if (sequence === requestSequence.current) setFleet(next);
  }, []);

  useEffect(() => {
    let alive = true;
    let source: EventSource | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    const clearPoll = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    };
    const schedulePoll = () => {
      if (!alive || pollTimer) return;
      pollTimer = setTimeout(async () => {
        pollTimer = null;
        try { await refetch(); } catch { /* a próxima rodada tenta de novo */ }
        schedulePoll();
      }, POLL_INTERVAL_MS);
    };
    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void refetch().catch(() => schedulePoll()), REFETCH_DEBOUNCE_MS);
    };
    const ingest = (raw: string, fallbackKind: string) => {
      let partial: Partial<TaskEvent>;
      try { partial = JSON.parse(raw) as Partial<TaskEvent>; } catch { return; }
      if (typeof partial.id !== 'number' || !partial.agent_slug) return;
      const kind = typeof partial.kind === 'string' ? partial.kind : fallbackKind;
      const event: TaskEvent = {
        id: partial.id,
        task_id: partial.task_id ?? null,
        agent_slug: partial.agent_slug,
        instance_id: partial.instance_id ?? null,
        kind,
        payload: partial.payload ?? null,
        created_at: partial.created_at ?? Math.floor(Date.now() / 1_000),
      };
      const activity = activityFromTaskEvent(event);
      if (!activity) return;
      setOverrides((current) => {
        const now = Date.now();
        const existing = current[event.agent_slug!];
        const downgrade = existing && ACTIVE_STATES.includes(existing.state) && activity === 'ocioso';
        if (existing && existing.visible_until_ms > now && downgrade) return current;
        return {
          ...pruneActivityOverrides(current, now),
          [event.agent_slug!]: {
            state: activity,
            visible_until_ms: Math.max(
              existing?.visible_until_ms ?? 0,
              now + ACTIVITY_MIN_VISIBLE_MS[activity],
            ),
            detail: eventDetail(event),
          },
        };
      });
    };
    const handlers: Array<[string, EventListener]> = FLEET_SSE_EVENT_KINDS.map((kind) => [
      kind,
      ((event: MessageEvent) => {
        ingest(event.data, kind);
        scheduleRefetch();
      }) as EventListener,
    ]);
    const closeSource = () => {
      source?.close();
      source = null;
    };
    const connect = () => {
      if (!alive) return;
      closeSource();
      const nextSource = new EventSource('/api/stream');
      source = nextSource;
      nextSource.addEventListener('open', () => {
        if (source !== nextSource) return;
        reconnectAttempt = 0;
      });
      for (const [kind, handler] of handlers) nextSource.addEventListener(kind, handler);
      nextSource.onerror = () => {
        if (source !== nextSource) return;
        closeSource();
        schedulePoll();
        if (reconnectTimer) return;
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelay(reconnectAttempt));
      };
    };

    connect();
    // Mesmo com SSE aberto, o snapshot periódico fecha lacunas de eventos que
    // o backend ainda não nomeia no protocolo global. É a rede de segurança
    // comprovada pelo v1; quando a SSE cai, passa a ser a fonte principal.
    schedulePoll();
    return () => {
      alive = false;
      closeSource();
      clearPoll();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [refetch]);

  useEffect(() => {
    const expirations = Object.values(overrides).map((value) => value.visible_until_ms);
    if (expirations.length === 0) return;
    const timer = setTimeout(
      () => setOverrides((current) => pruneActivityOverrides(current)),
      Math.max(0, Math.min(...expirations) - Date.now() + 1),
    );
    return () => clearTimeout(timer);
  }, [overrides]);

  return useMemo(
    () => ({ ...fleet, agents: applyActivityOverrides(fleet.agents, overrides) }),
    [fleet, overrides],
  );
}
