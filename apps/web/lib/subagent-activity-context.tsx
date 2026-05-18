'use client';

// SubagentActivityContext — LB-9 Bloco 2
//
// Badge de subagent agora é alimentado pelo SseProvider global (1 EventSource
// por cliente) + polling REST 5s como reconcile. Não depende mais do ChatPanel
// estar aberto — badge funciona na fleet view com modal fechado.
//
// Providers e setters do JP-11 F3-2 mantidos pra backwards compat com code
// existente que importa (page.tsx, chat-panel.tsx). Podem ser removidos num
// cleanup posterior quando esses callers forem atualizados.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SubagentStatusEntry } from './messages-types';
import { useSseProvider } from '../components/sse-provider';

// ── Provider legado (mantido pra compat) ────────────────────────────────────

type SubagentActivityValue = {
  byAgent: Record<string, Map<string, SubagentStatusEntry>>;
  setForAgent(slug: string, statuses: Map<string, SubagentStatusEntry>): void;
};

const SubagentActivityContext = createContext<SubagentActivityValue | null>(null);

export function SubagentActivityProvider({ children }: { children: ReactNode }) {
  const [byAgent, setByAgent] = useState<Record<string, Map<string, SubagentStatusEntry>>>({});

  const setForAgent = useCallback(
    (slug: string, statuses: Map<string, SubagentStatusEntry>) => {
      setByAgent((prev) => {
        const current = prev[slug];
        if (current === statuses) return prev;
        if (statuses.size === 0 && !current) return prev;
        const next = { ...prev };
        if (statuses.size === 0) {
          delete next[slug];
        } else {
          next[slug] = statuses;
        }
        return next;
      });
    },
    [],
  );

  const value = useMemo<SubagentActivityValue>(
    () => ({ byAgent, setForAgent }),
    [byAgent, setForAgent],
  );

  return (
    <SubagentActivityContext.Provider value={value}>
      {children}
    </SubagentActivityContext.Provider>
  );
}

function useSubagentActivity(): SubagentActivityValue | null {
  return useContext(SubagentActivityContext);
}

/** Setter legado — no-op quando SseProvider está disponível (badge já é SSE-driven). */
export function useSetSubagentStatusForAgent(slug: string | null) {
  const ctx = useSubagentActivity();
  const setForAgent = ctx?.setForAgent ?? null;
  return useCallback(
    (statuses: Map<string, SubagentStatusEntry>) => {
      if (!setForAgent || !slug) return;
      setForAgent(slug, statuses);
    },
    [setForAgent, slug],
  );
}

// ── Hook principal — alimentado por SseProvider + polling REST ───────────────

const _POLLING_INTERVAL_MS = 5_000;
const _TERMINAL_TTL_MS = 10_000;

/** Quantidade de subagents em status 'active' pro slug.
 *
 * Fontes (em ordem de prioridade):
 * 1. SseProvider — eventos em tempo real via `GET /api/events/stream?slugs=...`
 * 2. Polling REST — `GET /api/agents/{slug}/subagents` a cada 5s (reconcile)
 *
 * Badge funciona com modal fechado (regressão JP-11 corrigida no LB-9 Bloco 2).
 */
export function useSubagentActiveCount(slug: string): number {
  const sseCtx = useSseProvider();
  const [statusMap, setStatusMap] = useState<Map<string, SubagentStatusEntry>>(
    () => new Map(),
  );
  // GC de entries terminais (completed/stalled): evita crescimento infinito da Map.
  const gcTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // SSE subscription — eventos em tempo real
  useEffect(() => {
    if (!sseCtx) return;
    const unsubscribe = sseCtx.subscribe(slug, (event) => {
      // Cancela GC pendente se mesmo parent voltar a aparecer (defensivo).
      const pending = gcTimersRef.current.get(event.parent_uuid);
      if (pending) {
        clearTimeout(pending);
        gcTimersRef.current.delete(event.parent_uuid);
      }
      setStatusMap((prev) => {
        const existing = prev.get(event.parent_uuid);
        if (existing?.status === event.status && existing?.last_seen_ms === event.last_seen_ms) {
          return prev;
        }
        const next = new Map(prev);
        next.set(event.parent_uuid, event);
        return next;
      });
      if (event.status === 'completed' || event.status === 'stalled') {
        const timer = setTimeout(() => {
          gcTimersRef.current.delete(event.parent_uuid);
          setStatusMap((prev) => {
            if (!prev.has(event.parent_uuid)) return prev;
            const next = new Map(prev);
            next.delete(event.parent_uuid);
            return next;
          });
        }, _TERMINAL_TTL_MS);
        gcTimersRef.current.set(event.parent_uuid, timer);
      }
    });
    return () => {
      unsubscribe();
      for (const t of gcTimersRef.current.values()) clearTimeout(t);
      gcTimersRef.current.clear();
    };
  }, [sseCtx, slug]);

  // Polling REST — reconcile a cada 5s (snapshot autoritativo do servidor)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/subagents`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as SubagentStatusEntry[];
        if (cancelled) return;
        setStatusMap((prev) => {
          const next = new Map(data.map((e) => [e.parent_uuid, e]));
          // Change-detection: sem mudança real, retorna referência anterior
          // pra não disparar useMemo e re-renders desnecessários.
          if (
            next.size === prev.size &&
            [...next.keys()].every((k) => prev.get(k)?.status === next.get(k)?.status)
          ) {
            return prev;
          }
          return next;
        });
      } catch {
        /* rede ou parse error: mantém estado SSE */
      }
    };
    poll();
    const timer = setInterval(poll, _POLLING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [slug]);

  return useMemo(() => {
    let n = 0;
    for (const entry of statusMap.values()) {
      if (
        (entry.status === 'active' || entry.status === 'starting') &&
        entry.visibility !== false
      ) {
        n += 1;
      }
    }
    return n;
  }, [statusMap]);
}
