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
  aoOuvir,
  aoSilenciar,
}: {
  slug: string;
  aoTerminar(): void;
  aoFalhar(mensagem: string): void;
  /** O texto dele com esse id (do stream) tocou inteiro — a marca que a recarga usa para não repetir. */
  aoOuvir?(id: number): void;
  aoSilenciar?(): void;
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
  /* O id no stream do texto de cada áudio, na mesma ordem (`null` = sem id). */
  const idsRef = useRef<(number | null)[]>([]);
  const tocandoRef = useRef(-1);
  const duracaoRef = useRef(0);
  const filaRef = useRef<{ texto: string; id: number | null }[]>([]);
  const falaRef = useRef<FalaEmCurso | null>(null);
  const sequenciaRef = useRef<Sequencia | null>(null);
  const turnoFechadoRef = useRef(false);
  /* Uma bolha do chat tomou o alto-falante: o resto deste turno não fala (fica no chat de texto). */
  const caladaRef = useRef(false);
  const urlsRef = useRef<string[]>([]);
  const callbacksRef = useRef({ aoTerminar, aoFalhar, aoOuvir, aoSilenciar });
  callbacksRef.current = { aoTerminar, aoFalhar, aoOuvir, aoSilenciar };
  /* Os textos antes de `ate` (índice de áudio) que não são o que toca agora já tocaram inteiros. */
  const ouviuAte = useCallback((ate: number) => {
    const atual = idsRef.current[ate];
    let maior: number | null = null;
    for (const id of idsRef.current.slice(0, ate)) if (id !== null && id !== atual) maior = Math.max(maior ?? id, id);
    if (maior !== null) callbacksRef.current.aoOuvir?.(maior);
  }, []);
  const calou = useCallback(() => {
    window.clearTimeout(caladoRef.current);
    setTocando(false);
  }, []);

  const limpaUrls = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
    envelopesRef.current = [];
    audiosRef.current = [];
    idsRef.current = [];
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
        ouviuAte(audio);
        setFala(falaDoZe(audiosRef.current, audio));
      },
      aoSilenciar: () => {
        if (geracao !== geracaoRef.current) return;
        calou();
        callbacksRef.current.aoSilenciar?.();
      },
      aoTerminar: () => {
        if (geracao !== geracaoRef.current) return;
        sequenciaRef.current = null;
        ouviuAte(idsRef.current.length);
        limpaUrls();
        callbacksRef.current.aoTerminar();
      },
      aoFalhar: () => {
        if (geracao !== geracaoRef.current) return;
        sequenciaRef.current = null;
        limpaUrls();
        callbacksRef.current.aoFalhar('O navegador impediu a reprodução da resposta.');
      },
      aoPerderAVez: () => {
        if (geracao !== geracaoRef.current) return;
        cancelaRef.current();
        caladaRef.current = true;
        callbacksRef.current.aoTerminar(); // para a conversa, a voz acabou: ela não fica presa em "falando"
      },
    });
    if (pausadaRef.current) sequencia.pausa();
    sequenciaRef.current = sequencia;
    return sequencia;
  }, [limpaUrls, ouviuAte, calou]);

  const processaRef = useRef<() => void>(() => {});
  processaRef.current = () => {
    if (falaRef.current !== null) return;
    const proximo = filaRef.current.shift();
    if (proximo === undefined) {
      if (turnoFechadoRef.current) sequenciaRef.current?.fecha();
      return;
    }

    const { texto, id: idDoTexto } = proximo;
    const geracao = geracaoRef.current;
    const sequencia = garanteSequencia();
    falaRef.current = pedeFala(texto, slug, {
      aoMeta: () => {},
      aoPeaks: (id, duracao, peaks) => {
        if (geracao !== geracaoRef.current) return;
        envelopesRef.current.push({ inicio: duracaoRef.current, duracao, peaks });
        audiosRef.current.push({ texto, frase: id, duracao });
        idsRef.current.push(idDoTexto);
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
    caladaRef.current = false;
    setFala(null);
  }, []);
  const limpaLegenda = useCallback(() => setFala(null), []);

  const enfileira = useCallback((texto: string, id: number | null = null) => {
    // Calada, o texto não vira voz; o fim vem logo, como se ela tivesse tocado.
    if (caladaRef.current) { queueMicrotask(() => callbacksRef.current.aoTerminar()); return; }
    filaRef.current.push({ texto, id });
    processaRef.current();
  }, []);

  const fechaTurno = useCallback(() => {
    turnoFechadoRef.current = true;
    processaRef.current();
  }, []);

  const cancela = useCallback(() => {
    caladaRef.current = false;
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

  const cancelaRef = useRef(cancela);
  cancelaRef.current = cancela;
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
  const preparaApoio = useCallback(() => {
    if (pausadaRef.current || turnoFechadoRef.current || falaRef.current || filaRef.current.length) return false;
    return sequenciaRef.current === null || (sequenciaRef.current.cedeSeVazia?.() ?? false);
  }, []);
  return { abreTurno, enfileira, fechaTurno, cancela, pausa, retoma, preparaApoio, nivelRef, fala, tocando, limpaLegenda };
}
