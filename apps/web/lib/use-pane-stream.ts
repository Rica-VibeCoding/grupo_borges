'use client';

import { useEffect, useState } from 'react';

export type PaneStreamStatus = 'idle' | 'connecting' | 'open' | 'error' | 'closed';

export type PaneStreamState = {
  excerpt: string | null;
  capturedAt: number | null;
  executorKind: string | null;
  status: PaneStreamStatus;
};

const INITIAL: PaneStreamState = {
  excerpt: null,
  capturedAt: null,
  executorKind: null,
  status: 'idle',
};

/**
 * Stream SSE do pane do agente — DS-2.
 *
 * Abre EventSource em `mount` quando `enabled=true`, fecha em unmount.
 * Reconexão fica por conta do EventSource (já tenta sozinho com backoff).
 *
 * Smoke test pré-merge: abrir/fechar modal 10× e checar com
 * `lsof -p <pid> | grep stream` que nenhum descritor sobrou. Cleanup do
 * useEffect garante .close() sempre que slug muda ou modal fecha.
 */
export function usePaneStream(slug: string | null, enabled: boolean): PaneStreamState {
  const [state, setState] = useState<PaneStreamState>(INITIAL);

  useEffect(() => {
    if (!slug || !enabled) {
      setState(INITIAL);
      return;
    }
    setState({ ...INITIAL, status: 'connecting' });
    const source = new EventSource(`/api/agents/${encodeURIComponent(slug)}/pane/stream`);

    const onPane = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as {
          excerpt: string;
          captured_at: number;
          executor_kind: string;
        };
        setState({
          excerpt: data.excerpt,
          capturedAt: data.captured_at,
          executorKind: data.executor_kind,
          status: 'open',
        });
      } catch {
        // payload mal-formado: mantém último estado, vira "error" leve
        setState((prev) => ({ ...prev, status: 'error' }));
      }
    };

    const onOpen = () => {
      setState((prev) => ({ ...prev, status: 'open' }));
    };

    const onError = () => {
      // EventSource já reconecta sozinho; só marca status pra UI sinalizar
      setState((prev) => ({ ...prev, status: 'error' }));
    };

    source.addEventListener('pane', onPane);
    source.addEventListener('open', onOpen);
    source.addEventListener('error', onError);

    return () => {
      source.removeEventListener('pane', onPane);
      source.removeEventListener('open', onOpen);
      source.removeEventListener('error', onError);
      source.close();
      setState((prev) => ({ ...prev, status: 'closed' }));
    };
  }, [slug, enabled]);

  return state;
}
