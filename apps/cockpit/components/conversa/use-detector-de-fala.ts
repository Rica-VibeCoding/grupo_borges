'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { MicVAD } from '@ricky0123/vad-web';

import { TEMPOS, type Evento, type Conversa } from '@/lib/conversa/tipos';

import {
  criaControladorDetector,
  type ControladorDetector,
} from './controlador-detector';
import { criaVigiaDaEscuta, type VigiaDaEscuta } from './vigia-da-escuta';

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
  /* A escuta vigiada (a que emudecia no iPhone): o contexto de áudio do detector, a hora do
     último quadro processado e a da última ligação. `geracaoRef` descarta ligação superada. */
  const contextoRef = useRef<AudioContext | null>(null);
  const ultimoQuadroRef = useRef(0);
  const ligouEmRef = useRef(0);
  const geracaoRef = useRef(0);
  const vigiaRef = useRef<VigiaDaEscuta | null>(null);
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
        // Faixa muda não é faixa encerrada: o iOS entrega silêncio e só avisa por aqui.
        track.addEventListener('mute', () => vigiaRef.current?.confere());
        track.addEventListener('unmute', () => vigiaRef.current?.confere());
      }
      return captura;
    };

    const vigia = criaVigiaDaEscuta({
      leSinais: () => ({
        contexto: contextoRef.current?.state ?? null,
        faixaMuda: streamRef.current?.getAudioTracks().some((faixa) => faixa.muted) ?? false,
        semQuadroHaMs: performance.now() - Math.max(ultimoQuadroRef.current, ligouEmRef.current),
      }),
      retoma: () => void contextoRef.current?.resume().catch(() => {}),
      reabre: async () => {
        const controlador = controladorRef.current;
        if (controlador === null) throw new Error('detector encerrado');
        await controlador.reabre();
        ligouEmRef.current = performance.now();
      },
      desiste: () => eventoRef.current({ tipo: 'falhou', motivo: 'escutaMuda' }),
      agora: () => performance.now(),
      bate: (fn, ms) => {
        const id = window.setInterval(fn, ms);
        return () => window.clearInterval(id);
      },
    });
    vigiaRef.current = vigia;

    void (async () => {
      try {
        const vad = await import('@ricky0123/vad-web');
        const worklet = fetch(`${ASSET_VAD}vad.worklet.bundle.min.js`).then(async (res) => {
          if (!res.ok) throw new Error(`worklet HTTP ${res.status}`);
          await res.arrayBuffer();
        });
        const criaDetector = async (): Promise<MicVAD> => {
          let instancia: MicVAD | null = null;
          // O contexto nasce onde o MicVAD o criaria (logo depois do microfone), mas é nosso: é
          // nele que a vigia confere o estado e que o toque retoma. O do detector anterior, já
          // destruído numa reabertura, fecha aqui — com contexto de fora, o MicVAD não fecha.
          const abreComContexto = async () => {
            const captura = await abreMicrofone();
            void contextoRef.current?.close().catch(() => {});
            const contexto = new AudioContext();
            contexto.addEventListener('statechange', () => {
              if (contextoRef.current === contexto) vigiaRef.current?.confere();
            });
            void contexto.resume().catch(() => {});
            contextoRef.current = contexto;
            if (instancia !== null) instancia.options.audioContext = contexto;
            return captura;
          };
          instancia = await vad.MicVAD.new({
            model: 'v5',
            startOnLoad: false,
            baseAssetPath: ASSET_VAD,
            onnxWASMBasePath: ASSET_VAD,
            redemptionMs: TEMPOS.silencioFimDeFala,
            preSpeechPadMs: TEMPOS.preGravacao,
            minSpeechMs: TEMPOS.falaMinima,
            getStream: abreComContexto,
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
            ultimoQuadroRef.current = performance.now();
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
      vigia.para();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void Promise.resolve(controladorRef.current?.encerra())
        .then(() => contextoRef.current?.close())
        .catch(() => {});
    };
  }, [eventoRef, sessaoAtivaRef, ajustaDetector]);

  const liga = useCallback(async () => {
    const controlador = controladorRef.current;
    if (controlador === null) throw new Error('detector ainda não está pronto');
    const geracao = ++geracaoRef.current;
    // No toque ("Parei de te ouvir" → tentar de novo), o gesto é o que o iOS aceita para
    // destravar o áudio: por isso o resume é síncrono, antes de qualquer await.
    const contexto = contextoRef.current;
    if (contexto !== null && contexto.state !== 'running') void contexto.resume().catch(() => {});
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
    if (geracao !== geracaoRef.current) return;
    // Voltando de "falando" para "ouvindo", confere já que o áudio chega — e segue vigiando.
    ligouEmRef.current = performance.now();
    vigiaRef.current?.comeca();
  }, [ajustaDetector]);

  const desliga = useCallback(() => {
    geracaoRef.current += 1;
    vigiaRef.current?.para();
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
