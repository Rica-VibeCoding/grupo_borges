'use client';

import { useEffect, useRef, useState } from 'react';
import type { MessagePayload } from './messages-types';

export type MessagesStreamStatus = 'idle' | 'connecting' | 'replaying' | 'live' | 'error' | 'closed';

export type MessagesStreamState = {
  messages: MessagePayload[];
  status: MessagesStreamStatus;
  replayTotal: number | null;
  errorDetail: string | null;
};

const INITIAL: MessagesStreamState = {
  messages: [],
  status: 'idle',
  replayTotal: null,
  errorDetail: null,
};

const USE_FIXTURES =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_USE_FIXTURES === '1';

// Backoff exponencial (cap 30s) pra reconexão após `error`. EventSource
// reconecta sozinho, mas precisamos re-abrir com `?since_id=<lastId>` pra
// resume sem buracos no histórico — então fechamos e abrimos manualmente.
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

function buildUrl(slug: string, sessionId?: string | null, sinceId?: number | null): string {
  const params = new URLSearchParams();
  if (sessionId) params.set('sessionId', sessionId);
  if (sinceId !== null && sinceId !== undefined) params.set('since_id', String(sinceId));
  const qs = params.toString();
  return `/api/agents/${encodeURIComponent(slug)}/messages/stream${qs ? `?${qs}` : ''}`;
}

async function loadFixtures(): Promise<MessagePayload[]> {
  const res = await fetch('/__fixtures__/messages.jsonl', { cache: 'no-store' });
  if (!res.ok) throw new Error(`fixtures HTTP ${res.status}`);
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as MessagePayload);
}

/**
 * Consome /api/agents/{slug}/messages/stream — JP-11 Fase 2.
 *
 * - replay-start → replay-end: bufferiza histórico, status='replaying'.
 * - message: appendix incremental, status='live' após replay-end.
 * - heartbeat: ignorado (só mantém conexão viva).
 * - error: backoff exponencial + re-open com since_id pra evitar buraco.
 *
 * Modo fixture (`NEXT_PUBLIC_USE_FIXTURES=1`): bypass do EventSource, lê
 * `/__fixtures__/messages.jsonl` e injeta tudo de uma vez.
 *
 * Smoke pré-merge: abrir/fechar modal 10× e checar `lsof | grep stream`
 * pra confirmar que cleanup fecha todos os descritores.
 */
export function useMessagesStream(
  slug: string | null,
  enabled: boolean,
  sessionId?: string | null,
): MessagesStreamState {
  const [state, setState] = useState<MessagesStreamState>(INITIAL);
  const lastIdRef = useRef<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    if (!slug || !enabled) {
      setState(INITIAL);
      lastIdRef.current = null;
      return;
    }

    aliveRef.current = true;
    setState({ ...INITIAL, status: 'connecting' });
    lastIdRef.current = null;

    // --- Modo fixture: dispensa SSE, carrega arquivo local. -----------------
    if (USE_FIXTURES) {
      loadFixtures()
        .then((messages) => {
          if (!aliveRef.current) return;
          setState({
            messages,
            status: 'live',
            replayTotal: messages.length,
            errorDetail: null,
          });
        })
        .catch((err) => {
          if (!aliveRef.current) return;
          setState({
            messages: [],
            status: 'error',
            replayTotal: null,
            errorDetail: err instanceof Error ? err.message : String(err),
          });
        });
      return () => {
        aliveRef.current = false;
      };
    }

    // --- Modo real: EventSource com replay + live. --------------------------
    function connect() {
      if (!slug || !aliveRef.current) return;
      const url = buildUrl(slug, sessionId, lastIdRef.current);
      const source = new EventSource(url);
      sourceRef.current = source;

      source.addEventListener('replay-start', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { total?: number };
          setState((prev) => ({
            ...prev,
            status: 'replaying',
            replayTotal: data.total ?? null,
            errorDetail: null,
          }));
        } catch {
          /* schema inesperado — segue */
        }
      });

      source.addEventListener('message', (ev) => {
        try {
          const payload = JSON.parse(ev.data) as MessagePayload;
          if (typeof payload.id === 'number') {
            // cursor pra resume; replay manda em ordem ASC, live só cresce
            if (lastIdRef.current === null || payload.id > lastIdRef.current) {
              lastIdRef.current = payload.id;
            }
          }
          setState((prev) => ({
            ...prev,
            messages: prev.messages.concat(payload),
          }));
        } catch {
          /* payload mal-formado: ignora linha, mantém stream */
        }
      });

      source.addEventListener('replay-end', () => {
        retryCountRef.current = 0;
        setState((prev) => ({ ...prev, status: 'live' }));
      });

      source.addEventListener('error', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { detail?: string };
          if (data?.detail) {
            setState((prev) => ({ ...prev, errorDetail: data.detail ?? null }));
          }
        } catch {
          /* error sem payload (drop de transporte) — segue pro retry */
        }
      });

      // EventSource emite `error` (sem detail) tanto na falha inicial quanto
      // em drop de transporte. Browser reconecta sozinho, mas perdemos a
      // janela entre last-event-id e since_id. Fechamos e re-abrimos.
      source.onerror = () => {
        if (!aliveRef.current) return;
        source.close();
        sourceRef.current = null;
        setState((prev) => ({ ...prev, status: 'error' }));
        const attempt = retryCountRef.current;
        const delay =
          RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          if (!aliveRef.current) return;
          setState((prev) => ({ ...prev, status: 'connecting' }));
          connect();
        }, delay);
      };
    }

    connect();

    return () => {
      aliveRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      setState((prev) => ({ ...prev, status: 'closed' }));
    };
  }, [slug, enabled, sessionId]);

  return state;
}
