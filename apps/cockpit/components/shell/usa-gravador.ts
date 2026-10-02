'use client';

/**
 * O gravador — a parte que toca no hardware. Toda a REGRA mora em `voz.ts`,
 * que é puro e testado; aqui ficam o estado, o `getUserMedia` e o relógio, com
 * as pontas do `MediaRecorder` em `ciclo-da-gravacao.ts` e o ponteiro em
 * `usa-gesto-de-voz.ts` — nada disso dá pra testar sem browser.
 *
 * Portado de `apps/web/lib/use-voice-recorder.ts` (v1), com as correções que a
 * peça exige:
 *
 * 1. **Toque e gesto, cada um com um destino.** O v1 alterna com um toque e
 *    CANCELA no segundo toque do mesmo botão — o áudio some quando a mão
 *    esperava parar. Aqui o toque curto ABRE a gravação travada e o segundo
 *    toque DESPACHA; segurar é o push-to-talk, com as duas saídas rotuladas na
 *    tela. Nenhum dos dois joga áudio fora sem alguém ter pedido.
 *
 * 2. **O diálogo de permissão não come a gravação.** Na primeira vez o
 *    `getUserMedia` abre um diálogo do sistema; o dedo solta pra tocar em
 *    "Permitir" e o `pointerup` chega ANTES do stream. O v1 não tem esse
 *    problema porque não usa gesto contínuo — nós usamos, então tratamos: se o
 *    dedo já soltou quando o stream chega, encerramos o stream na hora (nunca
 *    deixa o microfone aberto) e a tela pede pra segurar de novo. Sem isso, a
 *    primeira tentativa gravaria zero segundo e pareceria um botão morto.
 *
 * 3. **Piso de duração.** Áudio de milissegundos vira `stt_empty` (502) no
 *    back e a tela mostraria falha de sistema para o que foi um dedo
 *    escorregando. O piso decide se o áudio PARTE, nunca se a gravação existe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  diagnosticaMicrofone,
  impedimentoDeContexto,
  suavizaNiveis,
  type FaseVoz,
  type Gesto,
  type Impedimento,
} from './voz';
import { despachaGravacao, montaGravador, type GravadorMontado } from './ciclo-da-gravacao';
import type { FalaAoVivo } from './usa-fala-ao-vivo';
import { usaGestoDeVoz } from './usa-gesto-de-voz';

export const BARRAS = 24;

type Opcoes = {
  /** Recebe o áudio pronto. Quem chama decide o que fazer com ele (subir,
   *  descartar, guardar) — o gravador não conhece rede. */
  aoGravar: (audio: Blob) => void | Promise<void>;
  /** Canal de fala ao vivo, opcional. Quando ele entrega o texto, o arquivo
   *  NÃO sobe: seria transcrever a mesma fala duas vezes. Ausente ou falho, o
   *  caminho de arquivo assume inteiro — é a rede de segurança. */
  aoVivo?: FalaAoVivo;
};

export type Gravador = {
  fase: FaseVoz;
  segundos: number;
  niveis: number[];
  gesto: Gesto;
  /** 0→1 rumo ao limiar do gesto em curso. Alimenta o alvo de trava. */
  progresso: number;
  impedimento: Impedimento | null;
  /** Ligar no botão de voz. Já inclui `onPointerCancel` — sem ele, uma
   *  notificação chegando no meio do gesto deixaria o microfone aberto. */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
  /** Botões explícitos que aparecem quando a gravação está travada. */
  enviarTravada: () => void;
  descartarTravada: () => void;
  /** Some com o aviso de microfone indisponível. */
  limparImpedimento: () => void;
};

export function usaGravador({ aoGravar, aoVivo }: Opcoes): Gravador {
  const [fase, setFase] = useState<FaseVoz>('ociosa');
  const [segundos, setSegundos] = useState(0);
  const [niveis, setNiveis] = useState<number[]>(() => Array(BARRAS).fill(0));
  const [gesto, setGesto] = useState<Gesto>('segurando');
  const [progresso, setProgresso] = useState(0);
  const [impedimento, setImpedimento] = useState<Impedimento | null>(null);

  const gravadorRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextoRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const pressionadoRef = useRef(false);
  const origemRef = useRef<{ x: number; y: number } | null>(null);
  const gestoRef = useRef<Gesto>('segurando');
  const segundosRef = useRef(0);
  /** Decidido no `onstop`: sem isto o handler não sabe se veio de um envio ou
   *  de um descarte, e mandaria o áudio cancelado assim mesmo. */
  const descartarRef = useRef(false);
  /** O dedo soltou e a gravação FICOU. Existe porque num clique curto o
   *  `pointerup` chega ANTES do `getUserMedia` voltar, e `comeca` precisa
   *  saber que aquele soltar travou em vez de abortar — senão a gravação que
   *  acabou de nascer seria desligada pela continuação do próprio gesto. */
  const travadaRef = useRef(false);

  const solta = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    contextoRef.current?.close().catch(() => {});
    contextoRef.current = null;
    gravadorRef.current = null;
    pedacosRef.current = [];
    origemRef.current = null;
    pressionadoRef.current = false;
    travadaRef.current = false;
    gestoRef.current = 'segurando';
    segundosRef.current = 0;
    setNiveis(Array(BARRAS).fill(0));
    setSegundos(0);
    setProgresso(0);
    setGesto('segurando');
  }, []);

  useEffect(() => () => solta(), [solta]);

  const desenhaOnda = useCallback((analisador: AnalyserNode) => {
    const dados = new Uint8Array(analisador.frequencyBinCount);
    const passo = Math.floor(dados.length / BARRAS) || 1;
    const tick = () => {
      analisador.getByteFrequencyData(dados);
      const atuais = Array.from({ length: BARRAS }, (_, i) => {
        let soma = 0;
        for (let j = 0; j < passo; j++) soma += dados[i * passo + j] ?? 0;
        return Math.round((soma / passo / 255) * 100);
      });
      setNiveis((anteriores) => suavizaNiveis(anteriores, atuais));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const encerra = useCallback(
    (descartar: boolean) => {
      descartarRef.current = descartar;
      const gravador = gravadorRef.current;
      if (gravador && gravador.state !== 'inactive') {
        gravador.stop(); // o `onstop` cuida do resto
      } else {
        // Nunca chegou a gravar (stream recusado, gesto morto no meio): o
        // canal ao vivo pode ter aberto assim mesmo, e ninguém o fecharia.
        void aoVivo?.fecha(true);
        solta();
        setFase('ociosa');
      }
    },
    [aoVivo, solta],
  );

  const comeca = useCallback(async () => {
    // `mediaDevices` não existe fora de contexto seguro. No nosso caso isso
    // acontece de verdade: abrir o cockpit pelo IP 100.x em vez do nome
    // .ts.net serve a mesma tela em HTTP puro, e o microfone some sem aviso.
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setImpedimento(impedimentoDeContexto());
      setFase('impedida');
      return;
    }

    setFase('pedindo');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (erro) {
      const diagnostico = diagnosticaMicrofone(erro);
      // MÁQUINA SEM MICROFONE não escreve nada. É o único dos diagnósticos
      // que não descreve um contratempo com saída — descreve uma máquina que
      // não tem a peça, e a frase `nenhum microfone encontrado` o Rica mandou
      // tirar em 21/08. O botão FICA: ele pediu a frase de volta ao chão, não
      // o controle fora da tela, e a primeira tentativa minha de resolver isso
      // retirando o botão foi recusada na hora.
      if (diagnostico.semAparelho) {
        setFase('ociosa');
        return;
      }
      setImpedimento(diagnostico);
      setFase('impedida');
      return;
    }

    // O dedo soltou enquanto o diálogo estava aberto (ou antes do stream vir).
    // Encerrar AGORA: microfone aberto sem gravação é o pior dos dois mundos.
    //
    // `travadaRef` é a exceção, e é ela que faz o CLIQUE CURTO existir: num
    // clique de 120ms o `pointerup` chega antes do stream, e sem esta guarda o
    // gesto que acabou de pedir "grava sem segurar" desligaria o microfone que
    // ele mesmo abriu. Vale também para o primeiro uso, quando o dedo solta
    // para tocar em "Permitir": permissão dada, gravação travada, e ninguém
    // precisa fazer o gesto de novo.
    if (!pressionadoRef.current && !travadaRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      setFase('ociosa');
      return;
    }

    let montado: GravadorMontado;
    try {
      montado = montaGravador(stream);
    } catch (erro) {
      stream.getTracks().forEach((t) => t.stop());
      setImpedimento(diagnosticaMicrofone(erro));
      setFase('impedida');
      return;
    }
    const { gravador, contexto, analisador } = montado;

    streamRef.current = stream;
    contextoRef.current = contexto;
    gravadorRef.current = gravador;
    pedacosRef.current = [];
    descartarRef.current = false;

    gravador.ondataavailable = (ev) => {
      if (ev.data.size > 0) pedacosRef.current.push(ev.data);
    };

    gravador.onstop = async () => {
      const descartar = descartarRef.current;
      const pedacos = pedacosRef.current;
      const bruto = gravador.mimeType || '';
      // `solta` PRIMEIRO: o microfone fecha no instante em que o dedo sai, e
      // não fica aberto os segundos que o texto definitivo leva pra chegar. O
      // preço é o último bloco do worklet (~43ms) ficar pra trás.
      solta();
      await despachaGravacao({ descartar, pedacos, bruto, aoVivo, aoGravar, setFase, setImpedimento });
    };

    // SEM timeslice de propósito. Com `start(100)` o browser entrega o áudio em
    // dezenas de pedaços e quem monta o blob final é este hook — e em gravação
    // longa o muxer pode largar/atrasar um pedaço, às vezes o primeiro, o que
    // carrega o header EBML: o "webm" que sobe começa no meio da fala, o ffprobe
    // do back devolve "Invalid data found" e o STT morre com 502. Sem timeslice
    // o browser muxa o arquivo INTEIRO e entrega num `dataavailable` único,
    // finalizado, com duração no header. A onda não depende dos pedaços — usa o
    // AnalyserNode — então nada se perde.
    try {
      gravador.start();
    } catch (erro) {
      solta();
      setImpedimento(diagnosticaMicrofone(erro));
      setFase('impedida');
      return;
    }

    // Depois do `start` de propósito: os caminhos de erro acima saem sem ter
    // aberto canal nenhum, então não precisam desfazer nada.
    void aoVivo?.liga(stream, contexto);

    setFase(travadaRef.current ? 'travada' : 'gravando');
    desenhaOnda(analisador);
    let contados = 0;
    timerRef.current = setInterval(() => {
      contados += 1;
      segundosRef.current = contados;
      setSegundos(contados);
    }, 1000);
  }, [aoGravar, aoVivo, desenhaOnda, solta]);

  const gestoDeVoz = usaGestoDeVoz({
    fase,
    comeca,
    encerra,
    setFase,
    setGesto,
    setProgresso,
    setImpedimento,
    pressionadoRef,
    travadaRef,
    origemRef,
    gestoRef,
    segundosRef,
  });

  return {
    fase,
    segundos,
    niveis,
    gesto,
    progresso,
    impedimento,
    ...gestoDeVoz,
    limparImpedimento: () => {
      setImpedimento(null);
      setFase('ociosa');
    },
  };
}
