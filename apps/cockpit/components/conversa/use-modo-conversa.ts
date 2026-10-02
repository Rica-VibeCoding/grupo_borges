'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { destravaNoGesto, estaTocando } from '@/components/feed/reprodutor-unico';
import { avanca, inicial } from '@/lib/conversa/maquina';
import { type Conversa, type Efeito, type Evento } from '@/lib/conversa/tipos';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';

import { freiaZe, ligaDetector } from './efeitos-assincronos';
import { ferramentaEmCurso } from './estado-da-vez';
import { comParcial, FALA_VAZIA, falaDepois, type FalaDaVez } from './fala-da-vez';
import { criaFalaDevolvida } from './fala-devolvida';
import { mensagemDeErro } from './mensagem-de-erro';
import { criaSonsLocais, type SonsLocais } from './sons-locais';
import { executaGestoDeInicio, reduzAviso } from './politicas-da-conversa';
import { transcreveCaptura } from './transcricao-da-captura';
import { useMudoDaCaptura } from './use-mudo-da-captura';
import { useAbaEscondida, useEscondida } from './use-aba-escondida';
import { useCanalDaFala } from './use-canal-da-fala';
import { useDetectorDeFala } from './use-detector-de-fala';
import { useEncerraAoSair } from './use-encerra-ao-sair';
import { useFilaDaFala } from './use-fila-da-fala';
import { useFilaDeVoz } from './use-fila-de-voz';
import { useRetomadaDaConversa } from './use-retomada-da-conversa';
import { useSegurarAVez } from './use-segurar-a-vez';
import { useTurnoDoZe } from './use-turno-do-ze';
import { useApoioDaFerramenta } from './use-apoio-da-ferramenta';
import { useWakeLock } from './use-wake-lock';

/** `fone` vem da folha de configurações (guardado no aparelho); a máquina recebe cada troca.
 *  `fora`: a tela saiu de vista — o microfone fecha e o Zé segue falando (`useMudoDaCaptura`).
 *  A aba escondida (tela bloqueada) soma ao `fora`; na vez do Rica ela derruba antes (`use-aba-escondida`). */
export function useModoConversa(slug: string, fone: boolean, mudo = false, foraDaTela = false) {
  const escondida = useEscondida();
  const fora = foraDaTela || escondida;
  const [conversa, setConversa] = useState<Conversa>(() => inicial());
  const [aviso, setAviso] = useState<string | null>(null);
  /* O texto da vez do Rica na tela: as palavras ao vivo e o firme que a máquina aceitou. */
  const [fala, setFala] = useState<FalaDaVez>(FALA_VAZIA);

  const conversaRef = useRef(conversa);
  const sessaoAtivaRef = useRef(false);
  const iniciandoRef = useRef(false);
  const cicloRef = useRef(0);
  const [devolvida] = useState(criaFalaDevolvida); // a fala que o freio apagou vai na frente da próxima
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
    preparaApoio,
  } = useFilaDeVoz({
    slug,
    aoTerminar: () => despachaRef.current({ tipo: 'vozTerminou' }),
    aoOuvir: retomada.ouviu,
    aoSilenciar: (vazia) => {
      apoio.silenciou();
      // A voz calou com ele ainda trabalhando: a máquina volta a esperar.
      if (vazia) despachaRef.current({ tipo: 'vozTerminou' });
    },
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
  const captura = useMudoDaCaptura({ mudo, fora, fone, conversaRef, sessaoAtivaRef,
    emudece: () => { vez.segura(false); detector.emudece(); }, liga: () => executaEfeitoRef.current({ tipo: 'ligarDetector' }),
    despacha: (evento) => despachaRef.current(evento) });
  // Fora da tela, o canal ao vivo só termina a fala que já transcrevia; não abre outro sem microfone.
  const canalParado = mudo || (fora && conversa.estado !== 'transcrevendo');
  const canal = useCanalDaFala(slug, canalParado ? 'parado' : conversa.estado, (texto) => {
    const estado = conversaRef.current.estado;
    setFala((atual) => comParcial(atual, estado, texto));
  });
  // A espera ouve. Sem fone, a frase de apoio toca no alto-falante e volta pelo microfone: a fala
  // que começa com ela tocando é eco e fica de fora.
  const falaValeRef = useRef<() => boolean>(() => true);
  falaValeRef.current = () => fone || conversaRef.current.estado !== 'esperandoZe' || !estaTocando();
  const detector = useDetectorDeFala({ eventoRef: despachaRef, sessaoAtivaRef, conversaRef, falaRef: canal.ouvinteRef, bloqueadoRef: captura.bloqueadoRef, falaValeRef });

  const sons = useCallback(() => {
    sonsRef.current ??= criaSonsLocais();
    return sonsRef.current;
  }, []);
  const somDeSegurar = useCallback(() => sons().sinalizaSegurar(), [sons]);
  const apoio = useApoioDaFerramenta({ slug, cancelaTurno: cancelaFala, preparaApoio,
    conversaRef, sessaoAtivaRef, despachaRef, mensagens: stream.messages });
  const vez = useSegurarAVez({ estado: conversa.estado, conversaRef, seguraDetector: detector.segura, somDeSegurar,
    aoMudar: (ligado) => despachaRef.current({ tipo: 'segurou', ligado }) });

  const fila = useFilaDaFala({ slug, geracao: stream.geracao, isRunningRef, cicloRef, despachaRef, devolvida, preparaEnvio: apoio.preparaEnvio });
  const apoioRef = useRef(apoio);
  apoioRef.current = apoio;
  const despacha = useCallback((evento: Evento) => {
    apoioRef.current.evento(evento);
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
        ligaDetector({ detector, captura, iniciandoRef, setAviso, despachaRef });
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
        const ciclo = cicloRef.current;
        const vigente = captura.vigente();
        transcreveCaptura({ slug, audio: efeito.audio, canal, detector, limpaLegenda,
          vivo: () => ciclo === cicloRef.current && vigente(),
          despacha: (evento) => despachaRef.current(evento) });
        return;
      }
      case 'enviar': // com o Zé no turno, a fala espera o fim dele (`fila-da-fala.ts`)
        fila.envia(efeito.texto);
        return;
      case 'frearZe': // o `■` do composer (`efeitos-assincronos.ts`)
        freiaZe({ slug, cicloRef, sessaoAtivaRef, devolvida });
        return;
      case 'falar':
        apoio.cala(); // a resposta chegou: a frase de apoio some, na síntese ou tocando
        enfileiraFala(efeito.texto, retomada.virouVoz());
        return;
      case 'tocarTique':
        sons().tocaTique();
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
    abre: () => { fila.abriu(); abreTurno(); apoio.inicia(); },
    texto: entregaTexto,
    pedidoEntrou: () => (devolvida.descarta(), despacha({ tipo: 'pedidoEntrou' })), // já está no histórico
    fecha: () => {
      apoio.encerra();
      despacha({ tipo: 'zeTerminou' });
      fechaTurno();
      fila.fechou();
    },
  });

  useEffect(() => detector.acompanhaEstado(), [conversa.estado, detector.acompanhaEstado]);

  // A máquina nasce sem fone; só uma troca de verdade vira evento.
  const foneDaMaquinaRef = useRef(false);
  useEffect(() => {
    if (foneDaMaquinaRef.current === fone) return;
    foneDaMaquinaRef.current = fone;
    despacha({ tipo: 'fone', ligado: fone });
  }, [despacha, fone]);

  useAbaEscondida({ sessaoAtivaRef, conversaRef, despachaRef, bloqueadoRef: captura.bloqueadoRef });

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
        fila.tenta(); // a fila que a recarga recuperou
        if (!r) return void (retomada.comeca(), despacha({ tipo: 'comecar' }));
        const fecha = () => (despacha({ tipo: 'zeTerminou' }), fechaTurno());
        const retomar = () => (detector.destrava(), despacha({ tipo: 'retomar' }), abreTurno());
        retomada.retoma(r, { retomar, texto: entregaTexto, fecha });
      },
    });
  }, [apoio, despacha, detector, sons, wakeLock, retomada, abreTurno, fechaTurno, entregaTexto, fila]);

  const encerra = useCallback((semFreio: boolean) => {
    cicloRef.current += 1;
    sessaoAtivaRef.current = false;
    iniciandoRef.current = false;
    cancelaFala();
    apoio.cala();
    sons().sinalizaFim();
    wakeLock.solta();
    retomada.apaga(); // parou: a recarga depois abre em "parado"
    devolvida.descarta();
    fila.descarta();
    despacha({ tipo: 'parar', semFreio });
  }, [apoio, cancelaFala, despacha, sons, wakeLock, retomada, devolvida, fila]);
  /** O toque que para: com o turno do Zé em voo, freia. */
  const parar = useCallback(() => encerra(false), [encerra]);

  // O toque durante o turno do Zé: freia e corta a voz, mas a conversa segue ouvindo.
  const interromper = useCallback(() => despacha({ tipo: 'interromper', rodando: isRunningRef.current }), [despacha]);

  const nivelMicRef = detector.nivelRef;
  /** Volume para o visual: a voz do Zé enquanto ele fala, o microfone no resto. */
  const leNivel = useCallback(
    () => (conversaRef.current.estado === 'falando' ? nivelVozRef.current : nivelMicRef.current),
    [nivelMicRef, nivelVozRef],
  );

  useEncerraAoSair(encerra, sessaoAtivaRef, sonsRef); // sair da página não freia o Zé

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
    naFila: fila.naFila,
    falaDoZe,
    tocando,
    ferramenta,
    streamStatus: stream.status,
    rodando: stream.isRunning,
    wakeLockAtivo: wakeLock.ativo,
    wakeLockSuportado: wakeLock.suportado,
    wakeLockFalhou: wakeLock.falhou,
    segurando: vez.segurando,
    segura: vez.segura,
    retomada: retomada.retomada,
    descartaRetomada: retomada.apaga,
    comecar,
    interromper,
    parar,
  };
}
