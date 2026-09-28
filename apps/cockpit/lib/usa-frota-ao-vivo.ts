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
import {
  atrasoDaReleitura,
  eventoPedeReleitura,
  mesmaFrota,
  RELEITURA_ESPERA_MS,
} from './frota-releitura';

const POLL_INTERVAL_MS = 5_000;
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
  // O último snapshot do SERVIDOR (sem realce): é contra ele que um evento
  // decide se há o que reler (`frota-releitura.ts`).
  const fleetRef = useRef(initialFleet);

  const refetch = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const next = await fetchFleetClient();
    if (sequence !== requestSequence.current) return;
    if (mesmaFrota(fleetRef.current, next)) return;
    fleetRef.current = next;
    setFleet(next);
  }, []);

  useEffect(() => {
    let alive = true;
    let source: EventSource | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let ultimaReleituraPorEvento: number | null = null;

    const clearPoll = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    };
    const schedulePoll = () => {
      if (!alive || pollTimer) return;
      pollTimer = setTimeout(async () => {
        pollTimer = null;
        // Aba escondida não lê: cada leitura custa CPU na VPS, e ninguém está
        // olhando. Voltar pra aba relê na hora (ouvinte abaixo).
        if (!document.hidden) {
          try { await refetch(); } catch { /* a próxima rodada tenta de novo */ }
        }
        schedulePoll();
      }, POLL_INTERVAL_MS);
    };
    const scheduleRefetch = (atraso = RELEITURA_ESPERA_MS) => {
      if (document.hidden) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void refetch().catch(() => schedulePoll());
      }, atraso);
    };
    // Releitura por evento: só quando o evento contradiz o snapshot, e sem
    // empurrar a que já está marcada — rajada de eventos não adia a leitura.
    const refetchPorEvento = () => {
      if (document.hidden || debounceTimer) return;
      const agora = Date.now();
      const atraso = atrasoDaReleitura(agora, ultimaReleituraPorEvento);
      ultimaReleituraPorEvento = agora + atraso;
      scheduleRefetch(atraso);
    };
    const ingest = (raw: string, fallbackKind: string): boolean => {
      let partial: Partial<TaskEvent>;
      try { partial = JSON.parse(raw) as Partial<TaskEvent>; } catch { return false; }
      if (typeof partial.id !== 'number' || !partial.agent_slug) return false;
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
      if (!activity) return false;
      const statusNoSnapshot = fleetRef.current.agents
        .find((agent) => agent.slug === event.agent_slug)?.status;
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
      return eventoPedeReleitura(activity, statusNoSnapshot);
    };
    const handlers: Array<[string, EventListener]> = FLEET_SSE_EVENT_KINDS.map((kind) => [
      kind,
      ((event: MessageEvent) => {
        if (ingest(event.data, kind)) refetchPorEvento();
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

    const onVisibility = () => {
      if (!document.hidden) scheduleRefetch();
    };
    document.addEventListener('visibilitychange', onVisibility);

    connect();
    // Mesmo com SSE aberto, o snapshot periódico fecha lacunas de eventos que
    // o backend ainda não nomeia no protocolo global. É a rede de segurança
    // comprovada pelo v1; quando a SSE cai, passa a ser a fonte principal.
    schedulePoll();
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
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
