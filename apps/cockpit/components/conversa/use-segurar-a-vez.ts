'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

import type { Conversa, Estado } from '@/lib/conversa/tipos';

import { podeSegurar } from './segurar-a-vez';

/**
 * A vez segura (fase 4): o estado de segurar, o som de quando começa e a regra de que só vale
 * na vez do Rica. Saiu de `ouvindo` com o dedo na tela (parou, caiu a captura), a vez solta
 * sozinha — e o soltar do dedo, depois, não faz nada. Quem para a contagem do silêncio é o
 * detector (`segura` de `useDetectorDeFala`).
 */
export function useSegurarAVez({
  estado,
  conversaRef,
  seguraDetector,
  somDeSegurar,
}: {
  estado: Estado;
  conversaRef: RefObject<Conversa>;
  /** Devolve se mudou: segurar duas vezes não toca o som duas vezes. */
  seguraDetector: (ligado: boolean) => boolean;
  somDeSegurar: () => void;
}) {
  const [segurando, setSegurando] = useState(false);

  const segura = useCallback(
    (ligado: boolean) => {
      const vale = ligado && podeSegurar(conversaRef.current.estado);
      if (!seguraDetector(vale)) return;
      setSegurando(vale);
      if (!vale) return;
      try {
        somDeSegurar();
      } catch {
        // Sem áudio local, a luz ainda diz que segurou.
      }
    },
    [conversaRef, seguraDetector, somDeSegurar],
  );

  useEffect(() => {
    if (!podeSegurar(estado)) segura(false);
  }, [estado, segura]);

  return { segurando, segura };
}
