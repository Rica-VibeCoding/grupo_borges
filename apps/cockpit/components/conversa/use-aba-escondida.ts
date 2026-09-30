'use client';

import { useEffect, type RefObject } from 'react';

import { ouveNoEstado } from '@/lib/conversa/maquina';
import type { Conversa, Evento } from '@/lib/conversa/tipos';

/**
 * Tela bloqueada ou aba em segundo plano matam o microfone: com a conversa ouvindo (ou falando e
 * esperando, com fone), esconder a aba vira `capturaCaiu`.
 */
export function useAbaEscondida({
  fone,
  sessaoAtivaRef,
  conversaRef,
  despachaRef,
  bloqueadoRef,
}: {
  fone: boolean;
  bloqueadoRef: RefObject<boolean>;
  sessaoAtivaRef: RefObject<boolean>;
  conversaRef: RefObject<Conversa>;
  despachaRef: RefObject<(evento: Evento) => void>;
}) {
  useEffect(() => {
    const aoMudarVisibilidade = () => {
      if (
        document.visibilityState === 'hidden' &&
        sessaoAtivaRef.current &&
        !bloqueadoRef.current && // mudo ou fora da tela: não há captura para cair
        ouveNoEstado(conversaRef.current.estado, fone)
      ) {
        despachaRef.current({ tipo: 'capturaCaiu' });
      }
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoMudarVisibilidade);
  }, [bloqueadoRef, conversaRef, despachaRef, fone, sessaoAtivaRef]);
}
