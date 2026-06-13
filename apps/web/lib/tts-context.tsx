'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type TtsTrigger = 'always' | 'on_voice_input' | 'never';

export type TtsSettings = {
  enabled: boolean;
  trigger: TtsTrigger;
  voice: string;
};

const LS_KEY = 'cockpit_tts_v1';
const DEFAULTS: TtsSettings = { enabled: false, trigger: 'always', voice: '' };

type TtsContextValue = {
  settings: TtsSettings;
  update: (patch: Partial<TtsSettings>) => void;
  synthText: (text: string) => Promise<string | null>;
};

const TtsContext = createContext<TtsContextValue | null>(null);

export function TtsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<TtsSettings>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch { /* ignore */ }
  }, []);

  const update = useCallback((patch: Partial<TtsSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const synthText = useCallback(async (text: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/tts/synth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: settings.voice }),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [settings.voice]);

  return (
    <TtsContext.Provider value={{ settings, update, synthText }}>
      {children}
    </TtsContext.Provider>
  );
}

export function useTts(): TtsContextValue {
  const ctx = useContext(TtsContext);
  if (!ctx) throw new Error('useTts: TtsProvider ausente na árvore');
  return ctx;
}
