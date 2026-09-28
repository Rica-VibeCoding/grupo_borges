'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { CHAVE_DIRECAO, gravaDirecao, leDirecao, type Direcao } from './direcao-da-voz';
import { gravaLigado, leLigado, type ChaveLigada } from './preferencias-da-conversa';
import { CHAVE_VISUAL, gravaVisual, leVisual, type Visual } from './preferencia-visual';

/* Evento local: o `storage` só avisa as OUTRAS abas; esta aba precisa do seu. */
const EVENTO = 'ck-conversa-preferencia';

function inscreve(aviso: () => void) {
  window.addEventListener('storage', aviso);
  window.addEventListener(EVENTO, aviso);
  return () => {
    window.removeEventListener('storage', aviso);
    window.removeEventListener(EVENTO, aviso);
  };
}

/** No servidor não há `localStorage`: renderiza o padrão e o cliente corrige depois. */
const doServidor = () => '';

function usePreferencia(chave: string): [string, (valor: string) => void] {
  const instantaneo = useCallback(() => {
    try {
      return window.localStorage.getItem(chave) ?? '';
    } catch {
      return '';
    }
  }, [chave]);
  const bruto = useSyncExternalStore(inscreve, instantaneo, doServidor);
  const grava = useCallback(
    (valor: string) => {
      try {
        window.localStorage.setItem(chave, valor);
      } catch {
        // Safari em navegação privada pode recusar; a escolha vale só até recarregar.
      }
      window.dispatchEvent(new Event(EVENTO));
    },
    [chave],
  );
  return [bruto, grava];
}

export function useVisualConversa(): [Visual, (visual: Visual) => void] {
  const [bruto, grava] = usePreferencia(CHAVE_VISUAL);
  const visual = useMemo(() => leVisual(bruto), [bruto]);
  const escolhe = useCallback((novo: Visual) => grava(gravaVisual(novo)), [grava]);
  return [visual, escolhe];
}

export function useChaveDaConversa(chave: ChaveLigada): [boolean, (ligado: boolean) => void] {
  const [bruto, grava] = usePreferencia(chave);
  const muda = useCallback((ligado: boolean) => grava(gravaLigado(ligado)), [grava]);
  return [leLigado(bruto), muda];
}

export function useDirecaoDaVoz(): [Direcao, (direcao: Direcao) => void] {
  const [bruto, grava] = usePreferencia(CHAVE_DIRECAO);
  const escolhe = useCallback((nova: Direcao) => grava(gravaDirecao(nova)), [grava]);
  return [leDirecao(bruto), escolhe];
}
