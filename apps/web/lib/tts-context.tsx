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
  /** Sintetiza `text`; `slug` resolve a voz do agente no backend (frota). */
  synthText: (text: string, slug?: string) => Promise<string | null>;
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

  const synthText = useCallback(async (text: string, slug?: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/tts/synth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // voice vazio → backend resolve pela voz da frota via slug do agente.
        body: JSON.stringify({ text, slug: slug ?? '', voice: settings.voice }),
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

// Singleton de reprodução — só UM áudio toca por vez em toda a aba. Tocar um
// novo pausa o anterior, eliminando a "emboliada" de vários players juntos.
let activeAudio: HTMLAudioElement | null = null;

export function playExclusive(el: HTMLAudioElement): void {
  if (activeAudio && activeAudio !== el) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  }
  activeAudio = el;
  el.currentTime = 0;
  void el.play().catch(() => { /* navegador pode bloquear sem gesto */ });
}

export function stopExclusive(el: HTMLAudioElement): void {
  el.pause();
  if (activeAudio === el) activeAudio = null;
}
