'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { CHAVE_VISUAL, gravaVisual, leVisual, type Visual } from './preferencia-visual';

/* Evento local: o `storage` só avisa as OUTRAS abas; esta aba precisa do seu. */
const EVENTO = 'ck-conversa-visual';

function inscreve(aviso: () => void) {
  window.addEventListener('storage', aviso);
  window.addEventListener(EVENTO, aviso);
  return () => {
    window.removeEventListener('storage', aviso);
    window.removeEventListener(EVENTO, aviso);
  };
}

function instantaneo(): string {
  try {
    return window.localStorage.getItem(CHAVE_VISUAL) ?? '';
  } catch {
    return '';
  }
}

/** No servidor não há `localStorage`: renderiza o padrão e o cliente corrige depois. */
const doServidor = () => '';

export function useVisualConversa(): [Visual, (visual: Visual) => void] {
  const bruto = useSyncExternalStore(inscreve, instantaneo, doServidor);
  const visual = useMemo(() => leVisual(bruto), [bruto]);
  const escolhe = useCallback((novo: Visual) => {
    try {
      window.localStorage.setItem(CHAVE_VISUAL, gravaVisual(novo));
    } catch {
      // Safari em navegação privada pode recusar; a escolha vale só até recarregar.
    }
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return [visual, escolhe];
}
