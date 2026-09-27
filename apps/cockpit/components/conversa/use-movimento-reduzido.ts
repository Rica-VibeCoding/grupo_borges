'use client';

import { useSyncExternalStore } from 'react';

const CONSULTA = '(prefers-reduced-motion: reduce)';

function inscreve(aviso: () => void) {
  const consulta = window.matchMedia(CONSULTA);
  consulta.addEventListener('change', aviso);
  return () => consulta.removeEventListener('change', aviso);
}

/** `prefers-reduced-motion` como estado de React; no servidor, sem movimento reduzido. */
export function useMovimentoReduzido(): boolean {
  return useSyncExternalStore(inscreve, () => window.matchMedia(CONSULTA).matches, () => false);
}
