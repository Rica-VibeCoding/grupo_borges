'use client';

// SubagentActivityContext — JP-11 F3-2
//
// Espelha o `subagentStatusByParentUuid` do `useMessagesStream` num contexto
// global indexado por `slug`. Quem cria a stream (ChatPanel quando o modal de
// um agente está aberto) publica via `setForAgent`; consumidores (AgentCard
// na fleet view) leem via `useSubagentActiveCount` / `useSubagentStatusMap`.
//
// Caveat: o contexto só tem dados pros slugs cuja stream está montada agora.
// Sem chat-panel aberto pra um slug = sem badge (badge fica fora de tela).
// Resolver isso exigiria endpoint snapshot global no backend; fora do escopo
// da F3-2 (Pavan cravou: "não mexer no backend").

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SubagentStatusEntry } from './messages-types';

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
        // No-op se referência da Map não mudou (useMessagesStream cria nova
        // Map a cada update real — comparar por referência é suficiente).
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

/** Setter pra um slug. Provider ausente = no-op (componente fora do tree).
 *
 * Importante: deps fechadas em `setForAgent` (que é `useCallback([])` no
 * provider, logo referencialmente estável) e `slug`. Não depender do `ctx`
 * inteiro — `ctx.value` muda a cada mutação em `byAgent` e geraria loop
 * de re-render no consumidor (effect cleanup recria, dispara setState,
 * muda ctx, recria, ad infinitum). */
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

/** Quantidade de subagents em status 'active' pro slug. 0 quando sem dado. */
export function useSubagentActiveCount(slug: string): number {
  const ctx = useSubagentActivity();
  return useMemo(() => {
    const m = ctx?.byAgent[slug];
    if (!m) return 0;
    let n = 0;
    for (const entry of m.values()) {
      if (entry.status === 'active') n += 1;
    }
    return n;
  }, [ctx, slug]);
}
