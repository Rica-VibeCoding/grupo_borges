'use client';

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const STORAGE_KEY = 'cockpit-theme';

function readInitial(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const stored = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) as Theme | null;
  if (stored === 'dark' || stored === 'light') return stored;
  return (document.documentElement.getAttribute('data-theme') as Theme | null) ?? 'dark';
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    setThemeState(readInitial());
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore quota / private-mode
    }
  }, [theme]);

  return { theme, setTheme: setThemeState };
}
