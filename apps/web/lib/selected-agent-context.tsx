'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type SelectedAgentContextValue = {
  selectedSlug: string | null;
  select: (slug: string) => void;
  close: () => void;
};

const SelectedAgentContext = createContext<SelectedAgentContextValue | null>(null);

export function SelectedAgentProvider({ children }: { children: ReactNode }) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const select = useCallback((slug: string) => setSelectedSlug(slug), []);
  const close = useCallback(() => setSelectedSlug(null), []);

  return (
    <SelectedAgentContext.Provider value={{ selectedSlug, select, close }}>
      {children}
    </SelectedAgentContext.Provider>
  );
}

export function useSelectedAgent(): SelectedAgentContextValue {
  const ctx = useContext(SelectedAgentContext);
  if (!ctx) throw new Error('useSelectedAgent must be used inside <SelectedAgentProvider>');
  return ctx;
}
