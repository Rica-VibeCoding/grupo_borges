'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { iniciaSequencia, type Sequencia } from '@/components/feed/reprodutor-unico';
import { pedeFala, type FalaEmCurso } from '@/components/feed/stream-voz';
import { audioTocando, falaDoZe, type AudioDaFrase, type FalaDoZe } from './frases-da-voz';
import { nivelDaVoz, type EnvelopeVoz } from './nivel-da-voz';

/** O áudio calado por mais que isto (ms) não é mais "falando": o `timeupdate` vem a cada ~250 ms. */
const CALADO_MS = 450;

export function useFilaDeVoz({
  slug,
  aoTerminar,
  aoFalhar,
}: {
  slug: string;
  aoTerminar(): void;
  aoFalhar(mensagem: string): void;
}) {
  /* A legenda dele: a frase do áudio que toca e o que já foi dito. Parada ou cancelada, fica. */
  const [fala, setFala] = useState<FalaDoZe | null>(null);
  /* Som saindo agora — a verdade do "falando". Sem progresso por CALADO_MS, calou. */
  const [tocando, setTocando] = useState(false);
  const caladoRef = useRef<number | undefined>(undefined);
  /* Volume da voz do Zé em ref: lido no requestAnimationFrame, sem render. */
  const nivelRef = useRef(0);
  const geracaoRef = useRef(0);
  const pausadaRef = useRef(false);
  const envelopesRef = useRef<EnvelopeVoz[]>([]);
  /* De que texto e sentença é cada envelope: o índice do áudio que toca vira a frase da legenda. */
  const audiosRef = useRef<AudioDaFrase[]>([]);
  const tocandoRef = useRef(-1);
  const duracaoRef = useRef(0);
  const filaRef = useRef<string[]>([]);
  const falaRef = useRef<FalaEmCurso | null>(null);
  const sequenciaRef = useRef<Sequencia | null>(null);
  const turnoFechadoRef = useRef(false);
  const urlsRef = useRef<string[]>([]);
  const callbacksRef = useRef({ aoTerminar, aoFalhar });
  callbacksRef.current = { aoTerminar, aoFalhar };
  const calou = useCallback(() => {
    window.clearTimeout(caladoRef.current);
    setTocando(false);
  }, []);

  const limpaUrls = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
    envelopesRef.current = [];
    audiosRef.current = [];
    tocandoRef.current = -1;
    duracaoRef.current = 0;
    nivelRef.current = 0;
  }, []);

  const garanteSequencia = useCallback(() => {
    if (sequenciaRef.current !== null) return sequenciaRef.current;
    const geracao = geracaoRef.current;
    const sequencia = iniciaSequencia({
      aoProgredir: (segundos) => {
        if (geracao !== geracaoRef.current || pausadaRef.current) return;
        nivelRef.current = nivelDaVoz(envelopesRef.current, segundos);
        // O relógio só anda com som: entre frases com a próxima pronta ele nem para.
        window.clearTimeout(caladoRef.current);
        setTocando(true);
        caladoRef.current = window.setTimeout(() => setTocando(false), CALADO_MS);
        const audio = audioTocando(envelopesRef.current.map((e) => e.inicio), segundos);
        if (audio === tocandoRef.current) return;
        tocandoRef.current = audio;
        setFala(falaDoZe(audiosRef.current, audio));
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
      aoPeaks: (id, duracao, peaks) => {
        if (geracao !== geracaoRef.current) return;
        envelopesRef.current.push({ inicio: duracaoRef.current, duracao, peaks });
        audiosRef.current.push({ texto, frase: id, duracao });
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
    setFala(null);
  }, []);
  const limpaLegenda = useCallback(() => setFala(null), []);

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
    calou();
  }, [calou, limpaUrls]);

  useEffect(() => cancela, [cancela]);

  const pausa = useCallback(() => {
    pausadaRef.current = true;
    sequenciaRef.current?.pausa();
    nivelRef.current = 0;
    calou();
  }, [calou]);
  const retoma = useCallback(() => {
    pausadaRef.current = false;
    sequenciaRef.current?.retoma();
  }, []);
  return { abreTurno, enfileira, fechaTurno, cancela, pausa, retoma, nivelRef, fala, tocando, limpaLegenda };
}
