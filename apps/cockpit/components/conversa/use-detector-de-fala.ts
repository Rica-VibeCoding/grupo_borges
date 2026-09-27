'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { MicVAD } from '@ricky0123/vad-web';

import { TEMPOS, type Evento, type Conversa } from '@/lib/conversa/tipos';

import {
  criaControladorDetector,
  type ControladorDetector,
} from './controlador-detector';

type Preparacao = 'preparando' | 'pronto' | 'falhou';
type VadUtils = typeof import('@ricky0123/vad-web')['utils'];

const ASSET_VAD = '/vad/';

export function useDetectorDeFala({
  eventoRef,
  sessaoAtivaRef,
  conversaRef,
}: {
  eventoRef: RefObject<(evento: Evento) => void>;
  sessaoAtivaRef: RefObject<boolean>;
  conversaRef: RefObject<Conversa>;
}) {
  const [preparacao, setPreparacao] = useState<Preparacao>('preparando');
  const [erroPreparacao, setErroPreparacao] = useState<string | null>(null);
  const [tempoCargaMs, setTempoCargaMs] = useState<number | null>(null);
  const [falaDetectada, setFalaDetectada] = useState(false);
  const [abrindoMicrofone, setAbrindoMicrofone] = useState(false);
  /* Volume do microfone em ref: quem desenha lê no requestAnimationFrame, sem render. */
  const nivelRef = useRef(0);

  const controladorRef = useRef<ControladorDetector | null>(null);
  const utilsRef = useRef<VadUtils | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausandoRef = useRef(false);
  const detectorRef = useRef<MicVAD | null>(null);
  const ajustaDetector = useCallback(() => {
    const porCima = conversaRef.current.estado === 'falando' || conversaRef.current.estado === 'interrompendo';
    detectorRef.current?.setOptions({
      minSpeechMs: porCima ? TEMPOS.confirmaFalaPorCima : TEMPOS.falaMinima,
      redemptionMs: porCima ? TEMPOS.desclassificaFalaPorCima : TEMPOS.silencioFimDeFala,
    });
  }, [conversaRef]);

  useEffect(() => {
    let vivo = true;
    const inicio = performance.now();

    const abreMicrofone = async () => {
      const captura = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        },
      });
      if (!vivo) {
        captura.getTracks().forEach((track) => track.stop());
        throw new DOMException('Tela encerrada', 'AbortError');
      }
      streamRef.current = captura;
      for (const track of captura.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (!pausandoRef.current && sessaoAtivaRef.current) {
            eventoRef.current({ tipo: 'capturaCaiu' });
          }
        });
      }
      return captura;
    };

    void (async () => {
      try {
        const vad = await import('@ricky0123/vad-web');
        const worklet = fetch(`${ASSET_VAD}vad.worklet.bundle.min.js`).then(async (res) => {
          if (!res.ok) throw new Error(`worklet HTTP ${res.status}`);
          await res.arrayBuffer();
        });
        const criaDetector = async (): Promise<MicVAD> => {
          const instancia = await vad.MicVAD.new({
            model: 'v5',
            startOnLoad: false,
            baseAssetPath: ASSET_VAD,
            onnxWASMBasePath: ASSET_VAD,
            redemptionMs: TEMPOS.silencioFimDeFala,
            preSpeechPadMs: TEMPOS.preGravacao,
            minSpeechMs: TEMPOS.falaMinima,
            getStream: abreMicrofone,
            pauseStream: async (captura) => {
              pausandoRef.current = true;
              captura.getTracks().forEach((track) => track.stop());
              if (streamRef.current === captura) streamRef.current = null;
              queueMicrotask(() => {
                pausandoRef.current = false;
            });
          },
          resumeStream: abreMicrofone,
          onSpeechStart: () => {
            setFalaDetectada(true);
            eventoRef.current({ tipo: 'falaIniciou' });
          },
          onSpeechRealStart: () => eventoRef.current({ tipo: 'falaConfirmada' }),
          onSpeechEnd: (audio) => {
            setFalaDetectada(false);
            eventoRef.current({ tipo: 'falaTerminou', audio });
          },
          onVADMisfire: () => {
            setFalaDetectada(false);
            eventoRef.current({ tipo: 'falaDescartada' });
          },
          onFrameProcessed: (_probabilidades, quadro) => {
            let soma = 0;
            for (const amostra of quadro) soma += amostra * amostra;
            nivelRef.current = Math.min(1, Math.sqrt(soma / quadro.length) * 8);
          },
          });
          detectorRef.current = instancia;
          ajustaDetector();
          return instancia;
        };
        const detector = await criaDetector();
        try {
          await worklet;
        } catch (erro) {
          void detector.destroy().catch(() => {});
          throw erro;
        }
        if (!vivo) {
          void detector.destroy().catch(() => {});
          return;
        }
        controladorRef.current = criaControladorDetector(detector, criaDetector);
        utilsRef.current = vad.utils;
        setTempoCargaMs(Math.round(performance.now() - inicio));
        setPreparacao('pronto');
      } catch (erro) {
        if (!vivo) return;
        setErroPreparacao(erro instanceof Error ? erro.message : 'o motor não carregou');
        setPreparacao('falhou');
      }
    })();

    return () => {
      vivo = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void controladorRef.current?.encerra();
    };
  }, [eventoRef, sessaoAtivaRef, ajustaDetector]);

  const liga = useCallback(async () => {
    const controlador = controladorRef.current;
    if (controlador === null) throw new Error('detector ainda não está pronto');
    setAbrindoMicrofone(true);
    ajustaDetector();
    try {
      await controlador.liga();
    } catch (erro) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      throw erro;
    } finally {
      setAbrindoMicrofone(false);
    }
  }, [ajustaDetector]);

  const desliga = useCallback(() => {
    setFalaDetectada(false);
    nivelRef.current = 0;
    void controladorRef.current?.desliga().catch(() => {});
  }, []);

  const criaWav = useCallback((audio: Float32Array) => {
    const utilitarios = utilsRef.current;
    if (utilitarios === null) return null;
    return new Blob([utilitarios.encodeWAV(audio)], { type: 'audio/wav' });
  }, []);

  return {
    preparacao,
    erroPreparacao,
    tempoCargaMs,
    falaDetectada,
    abrindoMicrofone,
    nivelRef,
    liga,
    desliga,
    criaWav,
    ajustaDetector,
  };
}
