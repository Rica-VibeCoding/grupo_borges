'use client';

import { useEffect, useSyncExternalStore } from 'react';

import type { Cena } from '../conversa/moldura-estado';
import { usaFrota } from './frota-provider';
import { estadoDaPilula, type EstadoDaPilula } from './estado-da-pilula';

/** A cena da tela de voz aberta, por agente — a gaveta e o pulso leem daqui. */
const cenas = new Map<string, Cena>();
const ouvintes = new Set<() => void>();

function publica(slug: string, cena: Cena | null) {
  if (cena) cenas.set(slug, cena);
  else cenas.delete(slug);
  for (const fn of ouvintes) fn();
}

function assina(fn: () => void) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

/** A tela de voz publica a cena enquanto está montada. */
export function usePublicaCenaDaVoz(slug: string, cena: Cena) {
  useEffect(() => {
    publica(slug, cena);
    return () => publica(slug, null);
  }, [slug, cena]);
}

/** A cena da voz aberta para este agente, ou `null` — a tropa já tem o status em mãos. */
export function usaCenaDaVoz(slug: string): Cena | null {
  return useSyncExternalStore(assina, () => cenas.get(slug) ?? null, () => null);
}

/** Palavra e tom do agente agora: frota viva + cena da voz (`estado-da-pilula.ts`). */
export function usaEstadoDaPilula(slug: string): EstadoDaPilula {
  const status = usaFrota().agents.find((a) => a.slug === slug)?.status;
  return estadoDaPilula(status, usaCenaDaVoz(slug));
}
