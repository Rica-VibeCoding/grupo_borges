'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'warn';

export type Toast = {
  id: string;
  kind: ToastKind;
  msg: string;
  sub?: string;
  ttlMs: number;
  createdAt: number;
};

type ToastContextValue = {
  toasts: Toast[];
  fire: (opts: { kind?: ToastKind; msg: string; sub?: string; ttlMs?: number }) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_TTL_MS = 3800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fire = useCallback<ToastContextValue['fire']>(
    ({ kind = 'info', msg, sub, ttlMs = DEFAULT_TTL_MS }) => {
      const id = `t-${Date.now()}-${++seq.current}`;
      setToasts((prev) => [...prev, { id, kind, msg, sub, ttlMs, createdAt: Date.now() }]);
    },
    [],
  );

  useEffect(() => {
    if (toasts.length === 0) return undefined;
    const timers = toasts.map((t) => {
      const remaining = Math.max(0, t.ttlMs - (Date.now() - t.createdAt));
      return setTimeout(() => dismiss(t.id), remaining);
    });
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  return <ToastContext.Provider value={{ toasts, fire, dismiss }}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
