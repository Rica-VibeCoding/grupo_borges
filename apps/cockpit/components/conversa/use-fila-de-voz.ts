'use client';

import { useCallback, useEffect, useRef } from 'react';

import { iniciaSequencia, type Sequencia } from '@/components/feed/reprodutor-unico';
import { pedeFala, type FalaEmCurso } from '@/components/feed/stream-voz';

export function useFilaDeVoz({
  slug,
  aoTerminar,
  aoFalhar,
}: {
  slug: string;
  aoTerminar(): void;
  aoFalhar(mensagem: string): void;
}) {
  const filaRef = useRef<string[]>([]);
  const falaRef = useRef<FalaEmCurso | null>(null);
  const sequenciaRef = useRef<Sequencia | null>(null);
  const turnoFechadoRef = useRef(false);
  const urlsRef = useRef<string[]>([]);
  const callbacksRef = useRef({ aoTerminar, aoFalhar });
  callbacksRef.current = { aoTerminar, aoFalhar };

  const limpaUrls = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }, []);

  const garanteSequencia = useCallback(() => {
    if (sequenciaRef.current !== null) return sequenciaRef.current;
    const sequencia = iniciaSequencia({
      aoProgredir: () => {},
      aoTerminar: () => {
        sequenciaRef.current = null;
        limpaUrls();
        callbacksRef.current.aoTerminar();
      },
      aoFalhar: () => {
        sequenciaRef.current = null;
        limpaUrls();
        callbacksRef.current.aoFalhar('O navegador impediu a reprodução da resposta.');
      },
    });
    sequenciaRef.current = sequencia;
    return sequencia;
  }, [limpaUrls]);

  const processaRef = useRef<() => void>(() => {});
  processaRef.current = () => {
    if (falaRef.current !== null) return;
    const texto = filaRef.current.shift();
    if (texto === undefined) {
      if (turnoFechadoRef.current) sequenciaRef.current?.fecha();
      return;
    }

    const sequencia = garanteSequencia();
    falaRef.current = pedeFala(texto, slug, {
      aoMeta: () => {},
      aoPeaks: () => {},
      aoAudio: (_id, url) => {
        urlsRef.current.push(url);
        sequencia.enfileira(url);
      },
      aoFim: () => {
        falaRef.current = null;
        processaRef.current();
      },
      aoErro: (mensagem) => {
        falaRef.current = null;
        filaRef.current = [];
        sequencia.para();
        sequenciaRef.current = null;
        limpaUrls();
        callbacksRef.current.aoFalhar(mensagem);
      },
    });
  };

  const abreTurno = useCallback(() => {
    turnoFechadoRef.current = false;
  }, []);

  const enfileira = useCallback((texto: string) => {
    filaRef.current.push(texto);
    processaRef.current();
  }, []);

  const fechaTurno = useCallback(() => {
    turnoFechadoRef.current = true;
    processaRef.current();
  }, []);

  const cancela = useCallback(() => {
    falaRef.current?.cancela();
    falaRef.current = null;
    filaRef.current = [];
    turnoFechadoRef.current = false;
    sequenciaRef.current?.para();
    sequenciaRef.current = null;
    limpaUrls();
  }, [limpaUrls]);

  useEffect(() => cancela, [cancela]);

  return { abreTurno, enfileira, fechaTurno, cancela };
}
