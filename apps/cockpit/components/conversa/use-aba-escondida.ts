'use client';

import { useEffect, type RefObject } from 'react';

import type { Conversa, Evento } from '@/lib/conversa/tipos';

/**
 * Tela bloqueada ou aba em segundo plano matam o microfone: com a conversa ouvindo (ou falando,
 * com fone), esconder a aba vira `capturaCaiu`.
 */
export function useAbaEscondida({
  fone,
  sessaoAtivaRef,
  conversaRef,
  despachaRef,
}: {
  fone: boolean;
  sessaoAtivaRef: RefObject<boolean>;
  conversaRef: RefObject<Conversa>;
  despachaRef: RefObject<(evento: Evento) => void>;
}) {
  useEffect(() => {
    const aoMudarVisibilidade = () => {
      if (
        document.visibilityState === 'hidden' &&
        sessaoAtivaRef.current &&
        ['ouvindo', 'interrompendo', ...(fone ? ['falando'] : [])].includes(conversaRef.current.estado)
      ) {
        despachaRef.current({ tipo: 'capturaCaiu' });
      }
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoMudarVisibilidade);
  }, [conversaRef, despachaRef, fone, sessaoAtivaRef]);
}
