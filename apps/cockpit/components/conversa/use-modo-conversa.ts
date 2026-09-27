'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { postAgentInput, postAgentTranscription } from '@grupo_borges/cockpit-core/api';

import { destravaNoGesto } from '@/components/feed/reprodutor-unico';
import { avanca, inicial } from '@/lib/conversa/maquina';
import { type Conversa, type Efeito, type Evento } from '@/lib/conversa/tipos';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';

import { criaSonsLocais, type SonsLocais } from './sons-locais';
import { executaGestoDeInicio, reduzAviso } from './politicas-da-conversa';
import { maiorIdDasMensagens, textosDoZeDepoisDe } from './textos-do-ze';
import { useDetectorDeFala } from './use-detector-de-fala';
import { useFilaDeVoz } from './use-fila-de-voz';
import { useWakeLock } from './use-wake-lock';

const FRASE_PONTE = 'Estou pensando. Já te respondo.';
const FRASE_DEMORA = 'Ainda estou trabalhando nisso.';

function mensagemDeErro(motivo: Conversa['motivo']): string {
  switch (motivo) {
    case 'microfoneNegado':
      return 'O microfone não foi liberado. Autorize o acesso e tente novamente.';
    case 'capturaCaiu':
      return 'O microfone parou. Toque para retomar a conversa.';
    case 'transcricaoFalhou':
      return 'Não consegui entender o áudio. Toque para tentar novamente.';
    case 'transcricaoVazia':
      return 'Não ouvi uma frase completa.';
    case 'envioFalhou':
      return 'A mensagem não chegou ao agente. Toque para tentar novamente.';
    case 'agenteOcupado':
      return 'O agente já está atendendo outro turno. Tente novamente quando ele terminar.';
    default:
      return 'A conversa foi interrompida.';
  }
}

export function useModoConversa(slug: string) {
  const [conversa, setConversa] = useState<Conversa>(() => inicial());
  const [aviso, setAviso] = useState<string | null>(null);
  const [ultimaTranscricao, setUltimaTranscricao] = useState<string | null>(null);

  const conversaRef = useRef(conversa);
  const sessaoAtivaRef = useRef(false);
  const iniciandoRef = useRef(false);
  const cicloRef = useRef(0);
  const sonsRef = useRef<SonsLocais | null>(null);
  const despachaRef = useRef<(evento: Evento) => void>(() => {});
  const executaEfeitoRef = useRef<(efeito: Efeito) => void>(() => {});

  const stream = useCanarioStream({ slug, limit: 500, recentes: true });
  const isRunningRef = useRef(stream.isRunning);
  isRunningRef.current = stream.isRunning;

  const {
    abreTurno,
    enfileira: enfileiraFala,
    fechaTurno,
    cancela: cancelaFala,
  } = useFilaDeVoz({
    slug,
    aoTerminar: () => despachaRef.current({ tipo: 'vozTerminou' }),
    aoFalhar: (mensagem) => {
      setAviso((atual) => reduzAviso(atual, { tipo: 'vozFalhou', mensagem }));
      try {
        sonsRef.current?.tocaTique();
      } catch {
        // O aviso visual permanece mesmo quando o áudio local não está disponível.
      }
      despachaRef.current({ tipo: 'vozTerminou' });
    },
  });
  const wakeLock = useWakeLock(sessaoAtivaRef);
  const detector = useDetectorDeFala({ eventoRef: despachaRef, sessaoAtivaRef });

  const sons = useCallback(() => {
    sonsRef.current ??= criaSonsLocais();
    return sonsRef.current;
  }, []);

  const despacha = useCallback((evento: Evento) => {
    const resultado = avanca(conversaRef.current, evento, performance.now());
    conversaRef.current = resultado.conversa;
    setConversa(resultado.conversa);
    for (const efeito of resultado.efeitos) executaEfeitoRef.current(efeito);
  }, []);
  despachaRef.current = despacha;

  executaEfeitoRef.current = (efeito) => {
    switch (efeito.tipo) {
      case 'ligarDetector':
        void detector
          .liga()
          .then(() => {
            iniciandoRef.current = false;
            setAviso((atual) => reduzAviso(atual, { tipo: 'detectorLigou' }));
          })
          .catch((erro: unknown) => {
            iniciandoRef.current = false;
            const nome = erro instanceof DOMException ? erro.name : '';
            despachaRef.current({
              tipo: 'falhou',
              motivo: nome === 'NotAllowedError' || nome === 'SecurityError'
                ? 'microfoneNegado'
                : 'capturaCaiu',
            });
          });
        return;
      case 'desligarDetector':
        detector.desliga();
        return;
      case 'transcrever': {
        const audio = detector.criaWav(efeito.audio);
        if (audio === null) {
          despachaRef.current({ tipo: 'falhou', motivo: 'transcricaoFalhou' });
          return;
        }
        const ciclo = cicloRef.current;
        void postAgentTranscription(slug, audio)
          .then(({ text }) => {
            if (ciclo !== cicloRef.current) return;
            setUltimaTranscricao(text.trim() || null);
            despachaRef.current({ tipo: 'transcreveu', texto: text });
          })
          .catch(() => {
            if (ciclo === cicloRef.current) {
              despachaRef.current({ tipo: 'falhou', motivo: 'transcricaoFalhou' });
            }
          });
        return;
      }
      case 'enviar': {
        if (isRunningRef.current) {
          despachaRef.current({ tipo: 'falhou', motivo: 'agenteOcupado' });
          return;
        }
        const ciclo = cicloRef.current;
        void postAgentInput(slug, efeito.texto, { origin: 'stt' })
          .then(() => {
            if (ciclo === cicloRef.current) despachaRef.current({ tipo: 'enviou' });
          })
          .catch((erro: unknown) => {
            if (ciclo !== cicloRef.current) return;
            const status = (erro as { status?: number }).status;
            despachaRef.current({
              tipo: 'falhou',
              motivo: status === 409 ? 'agenteOcupado' : 'envioFalhou',
            });
          });
        return;
      }
      case 'falar':
        sons().cancelaFala();
        enfileiraFala(efeito.texto);
        return;
      case 'tocarTique':
        sons().tocaTique();
        return;
      case 'falarPonte':
        sons().fala(FRASE_PONTE);
        return;
      case 'avisarDemora':
        sons().fala(FRASE_DEMORA);
        return;
      case 'avisarErro': {
        const mensagem = mensagemDeErro(efeito.motivo);
        sons().fala(mensagem);
        setAviso((atual) => reduzAviso(atual, { tipo: 'erro', mensagem }));
        return;
      }
    }
  };

  const cursorRef = useRef(0);
  const replayConcluidoRef = useRef(false);
  const rodandoAntesRef = useRef(false);
  useEffect(() => {
    const maiorId = maiorIdDasMensagens(stream.messages, cursorRef.current);
    if (stream.status !== 'live') {
      cursorRef.current = maiorId;
      return;
    }
    if (!replayConcluidoRef.current) {
      replayConcluidoRef.current = true;
      cursorRef.current = maiorId;
      rodandoAntesRef.current = stream.isRunning;
      return;
    }

    const textos = textosDoZeDepoisDe(stream.messages, cursorRef.current);
    const rodava = rodandoAntesRef.current;
    if (stream.isRunning && !rodava) abreTurno();
    if (textos.length > 0 && !rodava && !stream.isRunning) abreTurno();
    for (const { texto } of textos) despacha({ tipo: 'textoDoZe', texto });
    cursorRef.current = maiorId;

    if ((rodava && !stream.isRunning) || (textos.length > 0 && !stream.isRunning)) {
      despacha({ tipo: 'zeTerminou' });
      fechaTurno();
    }
    rodandoAntesRef.current = stream.isRunning;
  }, [abreTurno, despacha, fechaTurno, stream.isRunning, stream.messages, stream.status]);

  useEffect(() => {
    if (conversa.estado !== 'esperandoZe') return;
    const timer = window.setInterval(() => despacha({ tipo: 'tique' }), 250);
    return () => window.clearInterval(timer);
  }, [conversa.estado, despacha]);

  useEffect(() => {
    const aoMudarVisibilidade = () => {
      if (
        document.visibilityState === 'hidden' &&
        sessaoAtivaRef.current &&
        conversaRef.current.estado === 'ouvindo'
      ) {
        despachaRef.current({ tipo: 'capturaCaiu' });
      }
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoMudarVisibilidade);
  }, []);

  const comecar = useCallback(() => {
    if (detector.preparacao !== 'pronto' || iniciandoRef.current) return;
    if (conversaRef.current.estado !== 'parado' && conversaRef.current.estado !== 'erro') return;
    iniciandoRef.current = true;
    cicloRef.current += 1;
    sessaoAtivaRef.current = true;
    setAviso((atual) => reduzAviso(atual, { tipo: 'novoGesto' }));
    executaGestoDeInicio({
      cancelaFalaLocal: () => sons().cancelaFala(),
      destravaReprodutor: destravaNoGesto,
      destravaSons: () => sons().destrava(),
      pedeWakeLock: wakeLock.pede,
      comeca: () => despacha({ tipo: 'comecar' }),
    });
  }, [despacha, detector.preparacao, sons, wakeLock]);

  const parar = useCallback(() => {
    cicloRef.current += 1;
    sessaoAtivaRef.current = false;
    iniciandoRef.current = false;
    cancelaFala();
    sons().cancelaFala();
    wakeLock.solta();
    despacha({ tipo: 'parar' });
  }, [cancelaFala, despacha, sons, wakeLock]);

  useEffect(
    () => () => {
      sessaoAtivaRef.current = false;
      sonsRef.current?.encerra();
    },
    [],
  );

  return {
    conversa,
    preparacao: detector.preparacao,
    erroPreparacao: detector.erroPreparacao,
    tempoCargaMs: detector.tempoCargaMs,
    falaDetectada: detector.falaDetectada,
    abrindoMicrofone: detector.abrindoMicrofone,
    nivel: detector.nivel,
    aviso,
    ultimaTranscricao,
    streamStatus: stream.status,
    wakeLockAtivo: wakeLock.ativo,
    wakeLockSuportado: wakeLock.suportado,
    wakeLockFalhou: wakeLock.falhou,
    comecar,
    parar,
  };
}
