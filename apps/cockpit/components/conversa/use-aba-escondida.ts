'use client';

import { useEffect, useSyncExternalStore, type RefObject } from 'react';

import { esconderDerruba } from '@/lib/conversa/maquina';
import type { Conversa, Evento } from '@/lib/conversa/tipos';

const assina = (avisa: () => void) => {
  document.addEventListener('visibilitychange', avisa);
  return () => document.removeEventListener('visibilitychange', avisa);
};

/**
 * Tela bloqueada ou aba em segundo plano matam o microfone. Na vez do Rica, esconder a aba vira
 * `capturaCaiu`; no turno do Zé, a aba escondida conta como fora da tela — o microfone fecha e a
 * resposta segue (`useEscondida`, que `use-modo-conversa` soma ao `fora`).
 */
export function useAbaEscondida({
  sessaoAtivaRef,
  conversaRef,
  despachaRef,
  bloqueadoRef,
}: {
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
        esconderDerruba(conversaRef.current)
      ) {
        despachaRef.current({ tipo: 'capturaCaiu' });
      }
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoMudarVisibilidade);
  }, [bloqueadoRef, conversaRef, despachaRef, sessaoAtivaRef]);
}

/** A aba está escondida agora (tela bloqueada ou segundo plano). */
export const useEscondida = (): boolean =>
  useSyncExternalStore(assina, () => document.visibilityState === 'hidden', () => false);
