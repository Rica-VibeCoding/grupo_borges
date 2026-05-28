'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Set de slugs com ask_user pendente. Poll a cada 2s no /api/ask_user/pending.
// Card externo da frota usa pra piscar laranja quando o agente está esperando
// resposta humana via MCP ask-user.
const Ctx = createContext<Set<string>>(new Set());

export function AskUserPendingProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/ask_user/pending', { cache: 'no-store' });
        if (!r.ok) return;
        const data = (await r.json()) as { slugs?: string[] };
        if (!alive) return;
        const next = new Set(data.slugs ?? []);
        setPending((prev) => {
          if (prev.size === next.size && [...prev].every((s) => next.has(s))) return prev;
          return next;
        });
      } catch { /* ignora — próxima tentativa cobre */ }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return <Ctx.Provider value={pending}>{children}</Ctx.Provider>;
}

export function useAskUserPending(slug: string): boolean {
  return useContext(Ctx).has(slug);
}
