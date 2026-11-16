'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { acompanhaTroca } from './leitor-da-troca.ts';
import { assinaTrocaNoChat, leTroca } from './troca-em-curso.ts';

export function usaTrocaEmCurso(slug: string, conferirAoMontar = false) {
  const assina = useMemo(() => (fn: () => void) => assinaTrocaNoChat(slug, fn), [slug]);
  const troca = useSyncExternalStore(assina, () => leTroca(slug), () => null);
  useEffect(() => acompanhaTroca(slug, undefined, conferirAoMontar), [slug, conferirAoMontar]);
  return troca;
}
