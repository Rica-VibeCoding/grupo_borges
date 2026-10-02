import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { createStreamCoalescer } from '@grupo_borges/cockpit-core/stream-coalescer';

import { corridaEmVoo } from './corrida-em-voo.ts';
import { criaPrazoDePublicacao } from './prazo-de-publicacao.ts';
import type {
  CanarioStreamController,
  CanarioStreamOptions,
  CanarioStreamState,
  ClearTimer,
  EventSourceLike,
  SetTimer,
  TimerHandle,
} from './tipos-do-stream.ts';

export type {
  CanarioStreamController,
  CanarioStreamOptions,
  CanarioStreamState,
  CanarioStreamStatus,
  EventSourceConstructor,
  EventSourceLike,
} from './tipos-do-stream.ts';

/** Teto por RESULTADO DE FERRAMENTA, em caracteres (09/08). Não corta nada que
 *  a tela mostre: todo renderer para em `LINHAS_DE_PRIMEIRA = 120`. O porquê
 *  medido está em `_corta_resultados_grandes`, no `apps/api/routers/agents.py`;
 *  quem não passa o parâmetro — o v1 — recebe tudo, como sempre. */
const TETO_RESULTADO_CHARS = 32_000;

export const INITIAL_CANARIO_STREAM_STATE: CanarioStreamState = {
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
  recentes: boolean,
): string {
  const params = new URLSearchParams({
    limit: String(limit),
    maxResultChars: String(TETO_RESULTADO_CHARS),
    // Sem `signature` do thinking nem `message.usage`: ~20% do replay que
    // nenhuma tela lê (28/09). O porquê está em `services/feed_enxuto.py`.
    enxuto: '1',
  });
  if (sessionId) params.set('sessionId', sessionId);
  if (sinceId !== undefined) params.set('since_id', String(sinceId));
  // Só na PRIMEIRA conexão. Em reconexão existe cursor, e aí o que se quer é
  // tudo o que passou desde ele, em ordem — pedir "a cauda" abriria um buraco.
  if (recentes && sinceId === undefined) params.set('recentes', '1');
  return `/api/agents/${encodeURIComponent(slug)}/messages/stream?${params}`;
}

/** O iPhone congela a página fora do app e a conexão morre sem `error`; sem isto a volta
 *  esperava o vigia (até 35 s). Reabrir no `pageshow` e na volta da aba é o que o MDN manda. */
function ouveAVoltaDaPagina(retoma: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const aoMudarVisibilidade = () => {
    if (document.visibilityState === 'visible') retoma();
  };
  const aoMostrar = (evento: PageTransitionEvent) => {
    if (evento.persisted) retoma();
  };
  document.addEventListener('visibilitychange', aoMudarVisibilidade);
  window.addEventListener('pageshow', aoMostrar);
  return () => {
    document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    window.removeEventListener('pageshow', aoMostrar);
  };
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

  let state = INITIAL_CANARIO_STREAM_STATE;
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

  // Janela coberta no Chrome pausa rAF; texto para voz não pode esperar o próximo desenho.
  const prazo = criaPrazoDePublicacao(() => coalescer.flushNow(), schedule, cancel);
  const coalescer = createStreamCoalescer<MessagePayload>({
    schedule: options.scheduleFrameFn,
    cancel: options.cancelFrameFn,
    idOf: (message) => message.id,
    onFlush(batch) {
      prazo.cancela();
      publish({
        ...state,
        messages: state.messages.concat(batch),
        isRunning: corridaEmVoo(state.isRunning, batch),
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
    prazo.cancela();
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
      options.recentes ?? false,
    );
    const nextSource = new options.eventSourceConstructor(streamUrl);
    source = nextSource;

    const isCurrent = () =>
      !disposed && generation === connectionGeneration && source === nextSource;

    nextSource.addEventListener('replay-start', () => {
      if (!isCurrent()) return;
      coalescer.beginReplay();
      prazo.cancela();
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
          // re-render por evento. O contador sai no próximo flush natural.
          state = { ...state, descartados: state.descartados + 1 };
          return;
        }
        coalescer.push(payload);
        if (state.status === 'live') prazo.agenda();
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

    nextSource.addEventListener('session-reset', () => {
      if (isCurrent()) options.onSessionReset?.();
    });

    nextSource.addEventListener('conversa-trocada', (event) => {
      if (!isCurrent()) return;
      let dado: unknown = null;
      try {
        dado = JSON.parse(event.data);
      } catch {
        // Aviso ilegível ainda é aviso: a conversa mudou, o stream recomeça sem marco.
      }
      options.onConversaTrocada?.(dado);
    });

    nextSource.addEventListener('heartbeat', () => {
      if (isCurrent()) armWatchdog();
    });

    nextSource.onerror = () => {
      if (isCurrent()) reconnect();
    };

    armWatchdog();
  }

  connect();

  const paraDeOuvirAVolta = (options.aoVoltarDoFundo ?? ouveAVoltaDaPagina)(() => {
    if (disposed) return;
    if (reconnectTimer !== undefined) {
      cancel(reconnectTimer);
      reconnectTimer = undefined;
    }
    connect();
  });

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
      prazo.cancela();
      paraDeOuvirAVolta();
      listeners.clear();
    },
  };
}
