'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { postAgentInput, postAgentInterromper, postAgentTranscription } from '@grupo_borges/cockpit-core/api';

import { destravaNoGesto } from '@/components/feed/reprodutor-unico';
import { avanca, inicial, turnoDescartado } from '@/lib/conversa/maquina';
import { type Conversa, type Efeito, type Evento } from '@/lib/conversa/tipos';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';

import { entregaFala } from './envio-da-conversa';
import { mensagemDeErro } from './mensagem-de-erro';
import { criaSonsLocais, type SonsLocais } from './sons-locais';
import { executaGestoDeInicio, reduzAviso } from './politicas-da-conversa';
import { zeOcupado } from './toque-da-conversa';
import { transcreveFala } from './transcricao-da-fala';
import { useCanalDaFala } from './use-canal-da-fala';
import { useDetectorDeFala } from './use-detector-de-fala';
import { useFilaDeVoz } from './use-fila-de-voz';
import { useSegurarAVez } from './use-segurar-a-vez';
import { useTurnoDoZe } from './use-turno-do-ze';
import { useWakeLock } from './use-wake-lock';

const FRASE_PONTE = 'Estou pensando. Já te respondo.';
const FRASE_DEMORA = 'Ainda estou trabalhando nisso.';

/** `fone` vem da folha de configurações (guardado no aparelho); a máquina recebe cada troca. */
export function useModoConversa(slug: string, fone: boolean) {
  const [conversa, setConversa] = useState<Conversa>(() => inicial());
  const [aviso, setAviso] = useState<string | null>(null);
  const [ultimaTranscricao, setUltimaTranscricao] = useState<string | null>(null);
  const [respostaDoZe, setRespostaDoZe] = useState<string | null>(null);

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
    pausa: pausaFala,
    retoma: retomaFala,
    nivelRef: nivelVozRef,
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
  const canal = useCanalDaFala(slug, conversa.estado);
  const detector = useDetectorDeFala({ eventoRef: despachaRef, sessaoAtivaRef, conversaRef, falaRef: canal.ouvinteRef });

  const sons = useCallback(() => {
    sonsRef.current ??= criaSonsLocais();
    return sonsRef.current;
  }, []);
  const somDeSegurar = useCallback(() => sons().sinalizaSegurar(), [sons]);
  const vez = useSegurarAVez({ estado: conversa.estado, conversaRef, seguraDetector: detector.segura, somDeSegurar });

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
            const negado = nome === 'NotAllowedError' || nome === 'SecurityError';
            despachaRef.current({ tipo: 'falhou', motivo: negado ? 'microfoneNegado' : 'capturaCaiu' });
          });
        return;
      case 'desligarDetector':
        detector.desliga();
        return;
      case 'pausarVoz':
        pausaFala();
        return;
      case 'retomarVoz':
        retomaFala();
        return;
      case 'descartarVoz':
        cancelaFala();
        return;
      case 'transcrever': {
        // O texto do canal ao vivo, já pronto; sem ele a tempo, o WAV sobe como sempre subiu.
        const ciclo = cicloRef.current;
        const fala = canal.terminaFala();
        void transcreveFala({
          aoVivo: fala.texto,
          paciencia: fala.paciencia,
          arquivo: async () => {
            const audio = detector.criaWav(efeito.audio);
            if (audio === null) throw new Error('detector sem utilitários de WAV');
            return (await postAgentTranscription(slug, audio)).text;
          },
          vivo: () => ciclo === cicloRef.current,
          transcreveu: (texto) => {
            setUltimaTranscricao(texto.trim() || null);
            setRespostaDoZe(null);
            despachaRef.current({ tipo: 'transcreveu', texto });
          },
          falhou: () => despachaRef.current({ tipo: 'falhou', motivo: 'transcricaoFalhou' }),
        }).then(fala.fecha);
        return;
      }
      case 'enviar': {
        // Turno descartado (toque ou fala por cima) não é ocupação: o Claude Code enfileira.
        if (zeOcupado(isRunningRef.current, turnoDescartado(conversaRef.current))) {
          despachaRef.current({ tipo: 'falhou', motivo: 'agenteOcupado' });
          return;
        }
        const ciclo = cicloRef.current;
        entregaFala({
          posta: () => postAgentInput(slug, efeito.texto, { origin: 'stt' }),
          vivo: () => ciclo === cicloRef.current,
          enviou: () => despachaRef.current({ tipo: 'enviou' }),
          falhou: (motivo) => despachaRef.current({ tipo: 'falhou', motivo }),
        });
        return;
      }
      case 'frearZe':
        // O `■` do composer, sempre: antes da primeira linha do Zé, o servidor limpa o pedido
        // devolvido à caixa e grava o fim no stream. Falhar não é alarme: a resposta fica no chat de texto.
        void postAgentInterromper(slug).catch(() => {});
        return;
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

  useTurnoDoZe(stream, {
    abre: abreTurno,
    texto: (texto) => {
      despacha({ tipo: 'textoDoZe', texto });
      if (!turnoDescartado(conversaRef.current)) setRespostaDoZe(texto);
    },
    pedidoEntrou: () => despacha({ tipo: 'pedidoEntrou' }),
    fecha: () => {
      despacha({ tipo: 'zeTerminou' });
      fechaTurno();
    },
  });

  useEffect(() => {
    if (conversa.estado !== 'esperandoZe' && conversa.estado !== 'interrompendo') return;
    const timer = window.setInterval(() => despacha({ tipo: 'tique' }), 250);
    return () => window.clearInterval(timer);
  }, [conversa.estado, despacha]);

  useEffect(() => detector.ajustaDetector(), [conversa.estado, detector.ajustaDetector]);

  // A máquina nasce sem fone; só uma troca de verdade vira evento.
  const foneDaMaquinaRef = useRef(false);
  useEffect(() => {
    if (foneDaMaquinaRef.current === fone) return;
    foneDaMaquinaRef.current = fone;
    despacha({ tipo: 'fone', ligado: fone });
  }, [despacha, fone]);

  useEffect(() => {
    const aoMudarVisibilidade = () => {
      if (
        document.visibilityState === 'hidden' &&
        sessaoAtivaRef.current &&
        ['ouvindo', 'interrompendo', ...(fone ? ['falando'] : [])].includes(conversaRef.current.estado)
      ) {
        despachaRef.current({ tipo: 'capturaCaiu' });
      }
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoMudarVisibilidade);
  }, [fone]);

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
      destravaSons: () => {
        sons().destrava();
        sons().sinalizaInicio();
      },
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
    sons().sinalizaFim();
    wakeLock.solta();
    despacha({ tipo: 'parar' });
  }, [cancelaFala, despacha, sons, wakeLock]);

  const nivelMicRef = detector.nivelRef;
  /** Volume para o visual: a voz do Zé enquanto ele fala, o microfone no resto. */
  const leNivel = useCallback(
    () => (conversaRef.current.estado === 'falando' ? nivelVozRef.current : nivelMicRef.current),
    [nivelMicRef, nivelVozRef],
  );

  const pararRef = useRef(parar);
  pararRef.current = parar;
  useEffect(
    () => () => {
      if (sessaoAtivaRef.current) pararRef.current(); // sair da tela é o parar, freio incluso
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
    leNivel,
    aviso,
    ultimaTranscricao,
    respostaDoZe,
    streamStatus: stream.status,
    wakeLockAtivo: wakeLock.ativo,
    wakeLockSuportado: wakeLock.suportado,
    wakeLockFalhou: wakeLock.falhou,
    segurando: vez.segurando,
    segura: vez.segura,
    comecar,
    parar,
  };
}
