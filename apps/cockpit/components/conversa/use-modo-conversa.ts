'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { postAgentInput, postAgentInterromper, postAgentTranscription } from '@grupo_borges/cockpit-core/api';

import { destravaNoGesto } from '@/components/feed/reprodutor-unico';
import { avanca, inicial, turnoDescartado } from '@/lib/conversa/maquina';
import { type Conversa, type Efeito, type Evento } from '@/lib/conversa/tipos';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';

import { entregaFala } from './envio-da-conversa';
import { ferramentaEmCurso } from './estado-da-vez';
import { comParcial, FALA_VAZIA, falaDepois, type FalaDaVez } from './fala-da-vez';
import { mensagemDeErro } from './mensagem-de-erro';
import { criaSonsLocais, type SonsLocais } from './sons-locais';
import { executaGestoDeInicio, reduzAviso } from './politicas-da-conversa';
import { zeOcupado } from './toque-da-conversa';
import { transcreveFala } from './transcricao-da-fala';
import { useAbaEscondida } from './use-aba-escondida';
import { useCanalDaFala } from './use-canal-da-fala';
import { useDetectorDeFala } from './use-detector-de-fala';
import { useFilaDeVoz } from './use-fila-de-voz';
import { useRetomadaDaConversa } from './use-retomada-da-conversa';
import { useSegurarAVez } from './use-segurar-a-vez';
import { useTurnoDoZe } from './use-turno-do-ze';
import { useVozDeApoio } from './use-voz-de-apoio';
import { useWakeLock } from './use-wake-lock';

/** `fone` vem da folha de configurações (guardado no aparelho); a máquina recebe cada troca. */
export function useModoConversa(slug: string, fone: boolean) {
  const [conversa, setConversa] = useState<Conversa>(() => inicial());
  const [aviso, setAviso] = useState<string | null>(null);
  /* O texto da vez do Rica na tela: as palavras ao vivo e o firme que a máquina aceitou. */
  const [fala, setFala] = useState<FalaDaVez>(FALA_VAZIA);

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
  const ferramenta = useMemo(() => ferramentaEmCurso(stream.messages), [stream.messages]);
  const retomada = useRetomadaDaConversa({ slug, stream, estado: conversa.estado, sessaoAtivaRef }); // sobrevive à recarga

  const {
    abreTurno,
    enfileira: enfileiraFala,
    fechaTurno,
    cancela: cancelaFala,
    pausa: pausaFala,
    retoma: retomaFala,
    nivelRef: nivelVozRef,
    fala: falaDoZe,
    tocando,
    limpaLegenda,
  } = useFilaDeVoz({
    slug,
    aoTerminar: () => despachaRef.current({ tipo: 'vozTerminou' }),
    aoOuvir: retomada.ouviu,
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
  const canal = useCanalDaFala(slug, conversa.estado, (texto) => {
    const estado = conversaRef.current.estado;
    setFala((atual) => comParcial(atual, estado, texto));
  });
  const detector = useDetectorDeFala({ eventoRef: despachaRef, sessaoAtivaRef, conversaRef, falaRef: canal.ouvinteRef });

  const sons = useCallback(() => {
    sonsRef.current ??= criaSonsLocais();
    return sonsRef.current;
  }, []);
  const somDeSegurar = useCallback(() => sons().sinalizaSegurar(), [sons]);
  const apoio = useVozDeApoio({ slug, sons, cancelaTurno: cancelaFala });
  const vez = useSegurarAVez({ estado: conversa.estado, conversaRef, seguraDetector: detector.segura, somDeSegurar,
    aoMudar: (ligado) => despachaRef.current({ tipo: 'segurou', ligado }) });

  const despacha = useCallback((evento: Evento) => {
    const antes = conversaRef.current.estado;
    const resultado = avanca(conversaRef.current, evento, performance.now());
    conversaRef.current = resultado.conversa;
    setConversa(resultado.conversa);
    setFala((atual) => falaDepois(atual, antes, evento, resultado.conversa.estado));
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
        retomada.descartou();
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
            limpaLegenda();
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
          posta: () => postAgentInput(slug, efeito.texto, { origin: 'voz' }),
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
        apoio.cala(); // a resposta chegou: a frase de apoio some, na síntese ou tocando
        enfileiraFala(efeito.texto, retomada.virouVoz());
        return;
      case 'tocarTique':
        sons().tocaTique();
        return;
      case 'falarPonte':
        apoio.ponte();
        return;
      case 'avisarDemora':
        apoio.demora();
        return;
      case 'avisarErro': {
        const mensagem = mensagemDeErro(efeito.motivo);
        apoio.erro(mensagem);
        setAviso((atual) => reduzAviso(atual, { tipo: 'erro', mensagem }));
        return;
      }
    }
  };

  const entregaTexto = (texto: string, id: number) => retomada.entrega(id, () => despacha({ tipo: 'textoDoZe', texto }));
  useTurnoDoZe(stream, {
    abre: abreTurno,
    texto: entregaTexto,
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

  useEffect(() => detector.acompanhaEstado(), [conversa.estado, detector.acompanhaEstado]);

  // A máquina nasce sem fone; só uma troca de verdade vira evento.
  const foneDaMaquinaRef = useRef(false);
  useEffect(() => {
    if (foneDaMaquinaRef.current === fone) return;
    foneDaMaquinaRef.current = fone;
    despacha({ tipo: 'fone', ligado: fone });
  }, [despacha, fone]);

  useAbaEscondida({ fone, sessaoAtivaRef, conversaRef, despachaRef });

  const comecar = useCallback(() => {
    if (detector.preparacao !== 'pronto' || iniciandoRef.current) return;
    if (conversaRef.current.estado !== 'parado' && conversaRef.current.estado !== 'erro') return;
    const r = retomada.retomada; // voltou da recarga com a conversa aberta: o toque retoma
    iniciandoRef.current = true;
    cicloRef.current += 1;
    sessaoAtivaRef.current = true;
    setAviso((atual) => reduzAviso(atual, { tipo: 'novoGesto' }));
    executaGestoDeInicio({
      cancelaFalaLocal: apoio.cala,
      destravaReprodutor: destravaNoGesto,
      destravaSons: () => {
        sons().destrava();
        sons().sinalizaInicio();
      },
      pedeWakeLock: wakeLock.pede,
      comeca: () => {
        if (!r) return void (retomada.comeca(), despacha({ tipo: 'comecar' }));
        const fecha = () => (despacha({ tipo: 'zeTerminou' }), fechaTurno());
        const retomar = () => (detector.destrava(), despacha({ tipo: 'retomar' }), abreTurno());
        retomada.retoma(r, { retomar, texto: entregaTexto, fecha });
      },
    });
  }, [apoio, despacha, detector, sons, wakeLock, retomada, abreTurno, fechaTurno, entregaTexto]);

  const parar = useCallback(() => {
    cicloRef.current += 1;
    sessaoAtivaRef.current = false;
    iniciandoRef.current = false;
    cancelaFala();
    apoio.cala();
    sons().sinalizaFim();
    wakeLock.solta();
    retomada.apaga(); // parou: a recarga depois abre em "parado"
    despacha({ tipo: 'parar' });
  }, [apoio, cancelaFala, despacha, sons, wakeLock, retomada]);

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
    fala,
    falaDoZe,
    tocando,
    ferramenta,
    streamStatus: stream.status,
    wakeLockAtivo: wakeLock.ativo,
    wakeLockSuportado: wakeLock.suportado,
    wakeLockFalhou: wakeLock.falhou,
    segurando: vez.segurando,
    segura: vez.segura,
    retomada: retomada.retomada,
    descartaRetomada: retomada.apaga,
    comecar,
    parar,
  };
}
