'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { iniciaSequencia, type Sequencia } from '@/components/feed/reprodutor-unico';
import { pedeFala, type FalaEmCurso } from '@/components/feed/stream-voz';
import { nivelDaVoz, type EnvelopeVoz } from './nivel-da-voz';

export function useFilaDeVoz({
  slug,
  aoTerminar,
  aoFalhar,
}: {
  slug: string;
  aoTerminar(): void;
  aoFalhar(mensagem: string): void;
}) {
  const [nivel, setNivel] = useState(0);
  const geracaoRef = useRef(0);
  const pausadaRef = useRef(false);
  const envelopesRef = useRef<EnvelopeVoz[]>([]);
  const duracaoRef = useRef(0);
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
    envelopesRef.current = [];
    duracaoRef.current = 0;
    setNivel(0);
  }, []);

  const garanteSequencia = useCallback(() => {
    if (sequenciaRef.current !== null) return sequenciaRef.current;
    const geracao = geracaoRef.current;
    const sequencia = iniciaSequencia({
      aoProgredir: (segundos) => {
        if (geracao !== geracaoRef.current || pausadaRef.current) return;
        setNivel(nivelDaVoz(envelopesRef.current, segundos));
      },
      aoTerminar: () => {
        if (geracao !== geracaoRef.current) return;
        sequenciaRef.current = null;
        limpaUrls();
        callbacksRef.current.aoTerminar();
      },
      aoFalhar: () => {
        if (geracao !== geracaoRef.current) return;
        sequenciaRef.current = null;
        limpaUrls();
        callbacksRef.current.aoFalhar('O navegador impediu a reprodução da resposta.');
      },
    });
    if (pausadaRef.current) sequencia.pausa();
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

    const geracao = geracaoRef.current;
    const sequencia = garanteSequencia();
    falaRef.current = pedeFala(texto, slug, {
      aoMeta: () => {},
      aoPeaks: (_id, duracao, peaks) => {
        if (geracao !== geracaoRef.current) return;
        envelopesRef.current.push({ inicio: duracaoRef.current, duracao, peaks });
        duracaoRef.current += duracao;
      },
      aoAudio: (_id, url) => {
        if (geracao !== geracaoRef.current) { URL.revokeObjectURL(url); return; }
        urlsRef.current.push(url);
        sequencia.enfileira(url);
      },
      aoFim: () => {
        if (geracao !== geracaoRef.current) return;
        falaRef.current = null;
        processaRef.current();
      },
      aoErro: (mensagem) => {
        if (geracao !== geracaoRef.current) return;
        geracaoRef.current += 1;
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
    geracaoRef.current += 1;
    pausadaRef.current = false;
    falaRef.current?.cancela();
    falaRef.current = null;
    filaRef.current = [];
    turnoFechadoRef.current = false;
    sequenciaRef.current?.para();
    sequenciaRef.current = null;
    limpaUrls();
  }, [limpaUrls]);

  useEffect(() => cancela, [cancela]);

  const pausa = useCallback(() => {
    pausadaRef.current = true;
    sequenciaRef.current?.pausa();
    setNivel(0);
  }, []);
  const retoma = useCallback(() => {
    pausadaRef.current = false;
    sequenciaRef.current?.retoma();
  }, []);
  return { abreTurno, enfileira, fechaTurno, cancela, pausa, retoma, nivel };
}
