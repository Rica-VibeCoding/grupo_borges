'use client';

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import { cortaParaVoz } from './frases-da-voz';

import {
  CHAVE_MOTOR,
  CHAVE_RESPOSTA,
  gravaLigado,
  leLigado,
  leMotor,
  leResposta,
  type ChaveLigada,
  type Motor,
  type Resposta,
} from './preferencias-da-conversa';
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

export function useRespostaConversa(): [Resposta, (resposta: Resposta) => void] {
  const [bruto, grava] = usePreferencia(CHAVE_RESPOSTA);
  return [leResposta(bruto), grava];
}

export function useMotorConversa(): [Motor, (motor: Motor) => void] {
  const [bruto, grava] = usePreferencia(CHAVE_MOTOR);
  return [leMotor(bruto), grava];
}

/** O corte da resposta falada, estável entre renders: lê a escolha da hora em que a fala sai. */
export function useCorteDaResposta(): (texto: string) => string {
  const [resposta] = useRespostaConversa();
  const respostaRef = useRef(resposta);
  respostaRef.current = resposta;
  return useCallback((texto: string) => (respostaRef.current === 'curta' ? cortaParaVoz(texto) : texto), []);
}
