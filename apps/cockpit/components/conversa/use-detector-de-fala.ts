'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { MicVAD } from '@ricky0123/vad-web';

import { TEMPOS, type Evento, type Conversa } from '@/lib/conversa/tipos';

import {
  criaControladorDetector,
  opcoesDoDetector,
  seguraNoDetector,
  type ControladorDetector,
} from './controlador-detector';
import { criaMicrofone, ganchosDoMicrofone, soltaOMicrofone, type Microfone } from './microfone-da-conversa';
import { criaVigiaDaEscuta, type VigiaDaEscuta } from './vigia-da-escuta';

type Preparacao = 'preparando' | 'pronto' | 'falhou';
type VadUtils = typeof import('@ricky0123/vad-web')['utils'];

const ASSET_VAD = '/vad/';

/** Quem acompanha a fala quadro a quadro — o canal ao vivo (`use-canal-da-fala.ts`). */
export type OuvinteDaFala = {
  quadro(quadro: Float32Array): void;
  inicio(): void;
  /** Curta demais, ou o detector parou no meio: a fala some. */
  descarte(): void;
  fim(): void;
};

export function useDetectorDeFala({
  eventoRef,
  sessaoAtivaRef,
  conversaRef,
  falaRef,
}: {
  eventoRef: RefObject<(evento: Evento) => void>;
  sessaoAtivaRef: RefObject<boolean>;
  conversaRef: RefObject<Conversa>;
  falaRef: RefObject<OuvinteDaFala | null>;
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
  /* Um `getUserMedia` por conversa: na vez dele, surdo sem soltar (`microfone-da-conversa.ts`). */
  const microfoneRef = useRef<Microfone<MediaStream> | null>(null);
  const detectorRef = useRef<MicVAD | null>(null);
  /* A escuta vigiada (a que emudecia no iPhone): o contexto de áudio do detector, a hora do
     último quadro processado e a da última ligação. `geracaoRef` descarta ligação superada. */
  const contextoRef = useRef<AudioContext | null>(null);
  const ultimoQuadroRef = useRef(0);
  const ligouEmRef = useRef(0);
  const geracaoRef = useRef(0);
  const vigiaRef = useRef<VigiaDaEscuta | null>(null);
  /* O dedo parado na tela, na vez do Rica: o silêncio não encerra a fala enquanto ele segura. */
  const segurandoRef = useRef(false);
  const ajustaDetector = useCallback(() => {
    detectorRef.current?.setOptions(opcoesDoDetector(conversaRef.current.estado, segurandoRef.current));
  }, [conversaRef]);
  /** A cada troca de estado: as opções do detector e, com a conversa parada, o microfone solto. */
  const acompanhaEstado = useCallback(() => {
    ajustaDetector();
    if (soltaOMicrofone(conversaRef.current.estado)) microfoneRef.current?.solta();
  }, [ajustaDetector, conversaRef]);

  /** Segura ou solta a vez; devolve se mudou. Soltar recomeça os 2 s do zero, a partir de agora. */
  const segura = useCallback(
    (ligado: boolean) => {
      if (segurandoRef.current === ligado) return false;
      segurandoRef.current = ligado;
      seguraNoDetector(detectorRef.current, conversaRef.current.estado, ligado);
      return true;
    },
    [conversaRef],
  );

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
      for (const track of captura.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (!microfoneRef.current?.surdo() && sessaoAtivaRef.current) {
            eventoRef.current({ tipo: 'capturaCaiu' });
          }
        });
        // Faixa muda não é faixa encerrada: o iOS entrega silêncio e só avisa por aqui.
        track.addEventListener('mute', () => vigiaRef.current?.confere());
        track.addEventListener('unmute', () => vigiaRef.current?.confere());
      }
      return captura;
    };
    const microfone = criaMicrofone(abreMicrofone);
    microfoneRef.current = microfone;

    const vigia = criaVigiaDaEscuta({
      leSinais: () => ({
        contexto: contextoRef.current?.state ?? null,
        faixaMuda: microfone.atual()?.getAudioTracks().some((faixa) => faixa.muted) ?? false,
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
            const captura = await microfone.abre();
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
            ...ganchosDoMicrofone(microfone, () => conversaRef.current.estado),
          onSpeechStart: () => {
            setFalaDetectada(true);
            falaRef.current?.inicio();
            eventoRef.current({ tipo: 'falaIniciou' });
          },
          onSpeechRealStart: () => eventoRef.current({ tipo: 'falaConfirmada' }),
          onSpeechEnd: (audio) => {
            setFalaDetectada(false);
            falaRef.current?.fim(); // antes da máquina: a confirmação sai já, junto com o fim
            eventoRef.current({ tipo: 'falaTerminou', audio });
          },
          onVADMisfire: () => {
            setFalaDetectada(false);
            falaRef.current?.descarte();
            eventoRef.current({ tipo: 'falaDescartada' });
          },
          onFrameProcessed: (_probabilidades, quadro) => {
            ultimoQuadroRef.current = performance.now();
            falaRef.current?.quadro(quadro);
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
      microfone.solta();
      void Promise.resolve(controladorRef.current?.encerra())
        .then(() => contextoRef.current?.close())
        .catch(() => {});
    };
  }, [eventoRef, sessaoAtivaRef, conversaRef, falaRef, ajustaDetector]);

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
      microfoneRef.current?.solta();
      throw erro;
    } finally {
      setAbrindoMicrofone(false);
    }
    if (geracao !== geracaoRef.current) return;
    // Voltando de "falando" para "ouvindo", confere já que o áudio chega — e segue vigiando.
    ligouEmRef.current = performance.now();
    vigiaRef.current?.comeca();
  }, [ajustaDetector]);

  /** Só o áudio, sem abrir o microfone: o toque que retoma depois da recarga (o iOS só destrava no gesto). */
  const destrava = useCallback(() => {
    const contexto = contextoRef.current;
    if (contexto !== null && contexto.state !== 'running') void contexto.resume().catch(() => {});
  }, []);

  const desliga = useCallback(() => {
    geracaoRef.current += 1;
    vigiaRef.current?.para();
    setFalaDetectada(false);
    nivelRef.current = 0;
    // O `pause()` do MicVAD zera a fala em curso sem avisar: o canal descarta junto.
    falaRef.current?.descarte();
    void controladorRef.current?.desliga().catch(() => {});
  }, [falaRef]);

  const criaWav = useCallback((audio: Float32Array) => {
    const utilitarios = utilsRef.current;
    if (utilitarios === null) return null;
    // PCM de 16 bits, não o float de 32 do padrão: 32 KB/s, metade do tamanho. A fala segura
    // cabe ~5 min nos 10 MB da rota (em float, 2 min 44 s); o servidor converte com ffmpeg.
    return new Blob([utilitarios.encodeWAV(audio, 1, 16000, 1, 16)], { type: 'audio/wav' });
  }, []);

  return {
    preparacao,
    erroPreparacao,
    tempoCargaMs,
    falaDetectada,
    abrindoMicrofone,
    nivelRef,
    liga,
    destrava,
    desliga,
    criaWav,
    acompanhaEstado,
    segura,
  };
}
