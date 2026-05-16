'use client';

import { useEffect, useRef, useState } from 'react';
import type { MessagePayload, SubagentStatusEntry } from './messages-types';

export type MessagesStreamStatus = 'idle' | 'connecting' | 'replaying' | 'live' | 'error' | 'closed';

export type MessagesStreamState = {
  messages: MessagePayload[];
  status: MessagesStreamStatus;
  replayTotal: number | null;
  errorDetail: string | null;
  /** Status ao vivo de subagents (parent_uuid → entrada). JP-11 F3-2. */
  subagentStatusByParentUuid: Map<string, SubagentStatusEntry>;
};

// Factory ao invés de constante: cada slot recebe Map própria. Compartilhar
// uma sentinela mutável vira footgun se algum consumer fizer `.set()` por
// engano — poluiria o estado inicial de todos.
const emptySubagentMap = (): Map<string, SubagentStatusEntry> => new Map();

const makeInitialState = (): MessagesStreamState => ({
  messages: [],
  status: 'idle',
  replayTotal: null,
  errorDetail: null,
  subagentStatusByParentUuid: emptySubagentMap(),
});

// Entries terminais (completed / stalled) são removidas após este TTL pra
// não inflar a Map quando o agente roda 100+ subagents numa sessão longa.
// Janela curta o bastante pra UX (chip "concluído (Xs)" pisca e some), longa
// o suficiente pra render ver o estado final antes de sumir.
const SUBAGENT_TERMINAL_TTL_MS = 10_000;

const USE_FIXTURES =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_USE_FIXTURES === '1';

// Backoff exponencial (cap 30s) pra reconexão após `error`. EventSource
// reconecta sozinho, mas precisamos re-abrir com `?since_id=<lastId>` pra
// resume sem buracos no histórico — então fechamos e abrimos manualmente.
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

// Contrato: heartbeat a cada 15s. Sem dois consecutivos (30s) e a stream
// virou zumbi — força reconexão pra evitar UI "live" sem dados (NAT timeout
// em mobile, switch de rede silencioso).
const HEARTBEAT_WATCHDOG_MS = 30_000;

function buildUrl(slug: string, sessionId?: string | null, sinceId?: number | null): string {
  const params = new URLSearchParams();
  if (sessionId) params.set('sessionId', sessionId);
  if (sinceId !== null && sinceId !== undefined) params.set('since_id', String(sinceId));
  const qs = params.toString();
  return `/api/agents/${encodeURIComponent(slug)}/messages/stream${qs ? `?${qs}` : ''}`;
}

async function loadFixtures(signal: AbortSignal): Promise<MessagePayload[]> {
  const res = await fetch('/__fixtures__/messages.jsonl', { cache: 'no-store', signal });
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
  const [state, setState] = useState<MessagesStreamState>(makeInitialState);
  const lastIdRef = useRef<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const aliveRef = useRef(true);
  // Replay vem em rajada de N eventos antes de virar live. Sem buffer, cada
  // append faz setState separado (microtask por evento), forçando N renders
  // do consumidor + N reconstruções dos useMemo. Bufferizamos e damos 1
  // setState no replay-end.
  const replayBufferRef = useRef<MessagePayload[] | null>(null);
  // Watchdog: marca cada heartbeat/message recebido. setInterval verifica.
  const lastHeartbeatRef = useRef<number>(0);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // GC dos status terminais (completed/stalled). 1 timer por parent_uuid.
  const subagentGcTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!slug || !enabled) {
      setState(makeInitialState());
      lastIdRef.current = null;
      return;
    }

    aliveRef.current = true;
    setState({ ...makeInitialState(), status: 'connecting' });
    lastIdRef.current = null;
    replayBufferRef.current = null;
    retryCountRef.current = 0;
    lastHeartbeatRef.current = Date.now();

    // --- Modo fixture: dispensa SSE, carrega arquivo local. -----------------
    if (USE_FIXTURES) {
      const ctrl = new AbortController();
      loadFixtures(ctrl.signal)
        .then((messages) => {
          if (!aliveRef.current) return;
          setState({
            messages,
            status: 'live',
            replayTotal: messages.length,
            errorDetail: null,
            subagentStatusByParentUuid: emptySubagentMap(),
          });
        })
        .catch((err) => {
          if (!aliveRef.current) return;
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setState({
            messages: [],
            status: 'error',
            replayTotal: null,
            errorDetail: err instanceof Error ? err.message : String(err),
            subagentStatusByParentUuid: emptySubagentMap(),
          });
        });
      return () => {
        aliveRef.current = false;
        ctrl.abort();
      };
    }

    // --- Modo real: EventSource com replay + live. --------------------------

    function noteActivity() {
      lastHeartbeatRef.current = Date.now();
      // Qualquer atividade real (mensagem, heartbeat, replay-end) zera o
      // backoff. Sem isso o contador fica grudado no max em sessões que
      // não emitem replay-end na reconexão (cursor em dia).
      if (retryCountRef.current !== 0) retryCountRef.current = 0;
    }

    function scheduleReconnect(reason: string) {
      if (!aliveRef.current) return;
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      // Não-blocker: timers GC pré-queda podem disparar entre close() e
      // o evento re-emitido pelo backend (ring buffer), causando flicker
      // do entry. Zerar timers — o snapshot pós-replay vai re-popular.
      for (const timer of subagentGcTimersRef.current.values()) {
        clearTimeout(timer);
      }
      subagentGcTimersRef.current.clear();
      setState((prev) => ({ ...prev, status: 'error', errorDetail: reason }));
      const attempt = retryCountRef.current;
      const delay =
        RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
      retryCountRef.current += 1;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (!aliveRef.current) return;
        setState((prev) => ({ ...prev, status: 'connecting' }));
        connect();
      }, delay);
    }

    function flushReplayBuffer() {
      const buf = replayBufferRef.current;
      replayBufferRef.current = null;
      if (!buf || buf.length === 0) {
        setState((prev) => ({ ...prev, status: 'live' }));
        return;
      }
      setState((prev) => ({
        ...prev,
        messages: prev.messages.concat(buf),
        status: 'live',
      }));
    }

    function connect() {
      if (!slug || !aliveRef.current) return;
      const url = buildUrl(slug, sessionId, lastIdRef.current);
      const source = new EventSource(url);
      sourceRef.current = source;

      source.addEventListener('replay-start', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { total?: number };
          replayBufferRef.current = [];
          setState((prev) => ({
            ...prev,
            status: 'replaying',
            replayTotal: data.total ?? null,
            errorDetail: null,
          }));
        } catch {
          /* schema inesperado — segue, replay-end ainda flusha */
          replayBufferRef.current = [];
        }
      });

      source.addEventListener('message', (ev) => {
        try {
          const payload = JSON.parse(ev.data) as MessagePayload;
          if (typeof payload.id === 'number') {
            if (lastIdRef.current === null || payload.id > lastIdRef.current) {
              lastIdRef.current = payload.id;
            }
          }
          noteActivity();
          if (replayBufferRef.current !== null) {
            // Em replay: buffer cresce, sem setState — flush dispara no replay-end
            replayBufferRef.current.push(payload);
          } else {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.concat(payload),
            }));
          }
        } catch {
          /* payload mal-formado: ignora linha, mantém stream */
        }
      });

      source.addEventListener('replay-end', () => {
        noteActivity();
        flushReplayBuffer();
      });

      source.addEventListener('heartbeat', () => {
        noteActivity();
      });

      // Named event do backend (sse-starlette). Payload: SubagentStatusEntry.
      // Backend já dedup via `seq` e emite snapshot pós-replay (active vistos
      // antes de subir o consumer aparecem aqui). Stalled é emitido 1×.
      source.addEventListener('subagent_status', (ev) => {
        try {
          const entry = JSON.parse((ev as MessageEvent).data) as SubagentStatusEntry;
          if (!entry?.parent_uuid || !entry.status) return;
          noteActivity();
          // Cancela GC pendente se mesmo parent voltar a aparecer (defensivo —
          // backend não re-emite active depois de terminal, mas evita race).
          const pendingTimer = subagentGcTimersRef.current.get(entry.parent_uuid);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            subagentGcTimersRef.current.delete(entry.parent_uuid);
          }
          setState((prev) => {
            const next = new Map(prev.subagentStatusByParentUuid);
            next.set(entry.parent_uuid, entry);
            return { ...prev, subagentStatusByParentUuid: next };
          });
          if (entry.status === 'completed' || entry.status === 'stalled') {
            const timer = setTimeout(() => {
              subagentGcTimersRef.current.delete(entry.parent_uuid);
              if (!aliveRef.current) return;
              setState((prev) => {
                if (!prev.subagentStatusByParentUuid.has(entry.parent_uuid)) return prev;
                const next = new Map(prev.subagentStatusByParentUuid);
                next.delete(entry.parent_uuid);
                return { ...prev, subagentStatusByParentUuid: next };
              });
            }, SUBAGENT_TERMINAL_TTL_MS);
            subagentGcTimersRef.current.set(entry.parent_uuid, timer);
          }
        } catch {
          /* payload mal-formado: ignora */
        }
      });

      // Named event do contrato (recoverable) — distinto do onerror nativo
      // (transport drop). MessageEvent só existe aqui; transport drop é Event puro.
      source.addEventListener('error', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { detail?: string };
          if (data?.detail) {
            setState((prev) => ({ ...prev, errorDetail: data.detail ?? null }));
          }
        } catch {
          /* sem .data: é o onerror nativo bubbling — ignorado aqui */
        }
      });

      // Transport-level error (rede caiu, 5xx, parse fail). Browser reconectaria
      // sozinho, mas perderíamos a janela do since_id — então fechamos e
      // re-abrimos manualmente com cursor.
      source.onerror = () => {
        scheduleReconnect('transport-drop');
      };
    }

    connect();

    // Watchdog — verifica a cada 10s se passou >30s sem heartbeat/message.
    // Cobre zombie connection (NAT timeout em mobile, switch de rede silencioso).
    watchdogRef.current = setInterval(() => {
      if (!aliveRef.current) return;
      const since = Date.now() - lastHeartbeatRef.current;
      if (since > HEARTBEAT_WATCHDOG_MS && sourceRef.current) {
        scheduleReconnect('heartbeat-timeout');
      }
    }, 10_000);

    return () => {
      aliveRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      for (const timer of subagentGcTimersRef.current.values()) {
        clearTimeout(timer);
      }
      subagentGcTimersRef.current.clear();
      replayBufferRef.current = null;
      setState((prev) => ({ ...prev, status: 'closed' }));
    };
  }, [slug, enabled, sessionId]);

  return state;
}
