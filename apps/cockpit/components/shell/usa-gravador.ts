'use client';

/**
 * O gravador — a parte que toca no hardware. Toda a REGRA mora em `voz.ts`,
 * que é puro e testado; aqui só ficam `getUserMedia`, `MediaRecorder`,
 * `AudioContext` e os eventos de ponteiro, que não dá pra testar sem browser.
 *
 * Portado de `apps/web/lib/use-voice-recorder.ts` (v1), com as correções que a
 * peça exige:
 *
 * 1. **Gesto em vez de toggle.** O v1 alterna com um toque e CANCELA no
 *    segundo toque do mesmo botão — o áudio some quando a mão esperava parar.
 *    Aqui é segurar, e as duas saídas são gestos com rótulo na tela.
 *
 * 2. **O diálogo de permissão não come a gravação.** Na primeira vez o
 *    `getUserMedia` abre um diálogo do sistema; o dedo solta pra tocar em
 *    "Permitir" e o `pointerup` chega ANTES do stream. O v1 não tem esse
 *    problema porque não usa gesto contínuo — nós usamos, então tratamos: se o
 *    dedo já soltou quando o stream chega, encerramos o stream na hora (nunca
 *    deixa o microfone aberto) e a tela pede pra segurar de novo. Sem isso, a
 *    primeira tentativa gravaria zero segundo e pareceria um botão morto.
 *
 * 3. **Piso de duração.** Toque acidental vira `stt_empty` (502) no back e a
 *    tela mostraria falha de sistema para o que foi um dedo escorregando.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  aoSoltar,
  diagnosticaMicrofone,
  escolheMime,
  extensaoDe,
  gestoDe,
  impedimentoDeContexto,
  normalizaMime,
  progressoDoGesto,
  type FaseVoz,
  type Gesto,
  type Impedimento,
} from './voz';

export const BARRAS = 24;

type Opcoes = {
  /** Recebe o áudio pronto. Quem chama decide o que fazer com ele (subir,
   *  descartar, guardar) — o gravador não conhece rede. */
  aoGravar: (audio: Blob) => void | Promise<void>;
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

export function usaGravador({ aoGravar }: Opcoes): Gravador {
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
      setNiveis(
        Array.from({ length: BARRAS }, (_, i) => {
          let soma = 0;
          for (let j = 0; j < passo; j++) soma += dados[i * passo + j] ?? 0;
          return Math.round((soma / passo / 255) * 100);
        }),
      );
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
        solta();
        setFase('ociosa');
      }
    },
    [solta],
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
      setImpedimento(diagnosticaMicrofone(erro));
      setFase('impedida');
      return;
    }

    // O dedo soltou enquanto o diálogo estava aberto (ou antes do stream vir).
    // Encerrar AGORA: microfone aberto sem gravação é o pior dos dois mundos.
    if (!pressionadoRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      setFase('ociosa');
      return;
    }

    let gravador: MediaRecorder;
    let contexto: AudioContext;
    let analisador: AnalyserNode;
    try {
      contexto = new AudioContext();
      if (contexto.state === 'suspended') void contexto.resume().catch(() => {});
      analisador = contexto.createAnalyser();
      analisador.fftSize = 256;
      contexto.createMediaStreamSource(stream).connect(analisador);

      const mime =
        typeof MediaRecorder !== 'undefined'
          ? escolheMime((m) => MediaRecorder.isTypeSupported(m))
          : null;
      try {
        gravador = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      } catch {
        // Alguns WebKit recusam o mimeType pedido mesmo respondendo `true` no
        // `isTypeSupported`. Deixar o browser escolher é pior (pode devolver
        // `video/mp4`), mas é melhor que não gravar — `normalizaMime` conserta
        // o rótulo na hora de subir.
        gravador = new MediaRecorder(stream);
      }
    } catch (erro) {
      stream.getTracks().forEach((t) => t.stop());
      setImpedimento(diagnosticaMicrofone(erro));
      setFase('impedida');
      return;
    }

    streamRef.current = stream;
    contextoRef.current = contexto;
    gravadorRef.current = gravador;
    pedacosRef.current = [];
    descartarRef.current = false;

    gravador.ondataavailable = (ev) => {
      if (ev.data.size > 0) pedacosRef.current.push(ev.data);
    };

    gravador.onstop = () => {
      const descartar = descartarRef.current;
      const pedacos = pedacosRef.current;
      const bruto = gravador.mimeType || '';
      solta();

      if (descartar || pedacos.length === 0) {
        setFase('ociosa');
        return;
      }

      const mime = normalizaMime(bruto);
      if (!mime) {
        // Sem tipo reconhecível o `FormData` mandaria octet-stream e o back
        // recusaria com 422. Dizer aqui é honesto; deixar subir seria mentir
        // sobre onde a coisa quebrou.
        setImpedimento({
          resumo: 'o navegador gravou num formato que o servidor não aceita',
          saida: 'use o teclado por enquanto — me avise que eu vejo o formato',
          definitivo: true,
        });
        setFase('impedida');
        return;
      }

      const audio = new File([new Blob(pedacos, { type: mime })], `voz.${extensaoDe(mime)}`, {
        type: mime,
      });
      // O hook fecha o próprio ciclo: entra em `transcrevendo` e só sai quando
      // a promessa de quem recebeu o áudio resolve. Se o composer tivesse que
      // avisar de volta, ele precisaria referenciar o gravador de dentro do
      // callback que o cria — e um esquecimento ali travaria a tela em
      // "transcrevendo…" para sempre, sem erro nenhum aparecendo.
      setFase('transcrevendo');
      void Promise.resolve(aoGravar(audio)).finally(() => setFase('ociosa'));
    };

    try {
      gravador.start(100);
    } catch {
      try {
        gravador.start();
      } catch (erro) {
        solta();
        setImpedimento(diagnosticaMicrofone(erro));
        setFase('impedida');
        return;
      }
    }

    setFase('gravando');
    desenhaOnda(analisador);
    let contados = 0;
    timerRef.current = setInterval(() => {
      contados += 1;
      segundosRef.current = contados;
      setSegundos(contados);
    }, 1000);
  }, [aoGravar, desenhaOnda, solta]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (fase === 'transcrevendo' || fase === 'pedindo') return;
      // Trava aberta: o gesto acabou, quem manda são os botões.
      if (fase === 'travada') return;
      e.preventDefault();
      // Sem captura, o `pointermove` para de chegar assim que o dedo sai do
      // botão — e sair do botão É o gesto de cancelar.
      e.currentTarget.setPointerCapture?.(e.pointerId);
      pressionadoRef.current = true;
      origemRef.current = { x: e.clientX, y: e.clientY };
      gestoRef.current = 'segurando';
      setGesto('segurando');
      setProgresso(0);
      setImpedimento(null);
      void comeca();
    },
    [comeca, fase],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const origem = origemRef.current;
      if (!origem || !pressionadoRef.current) return;
      const dx = e.clientX - origem.x;
      const dy = e.clientY - origem.y;
      const atual = gestoDe(dx, dy);
      gestoRef.current = atual;
      setGesto(atual);
      setProgresso(progressoDoGesto(dx, dy));
      // `cancelando` é fase, não só rótulo: a tela inteira muda de cor, que é o
      // aviso de que soltar agora joga fora.
      setFase((anterior) =>
        anterior === 'gravando' || anterior === 'cancelando'
          ? atual === 'cancelar'
            ? 'cancelando'
            : 'gravando'
          : anterior,
      );
    },
    [],
  );

  const finaliza = useCallback(
    (e: React.PointerEvent, cancelado: boolean) => {
      if (!pressionadoRef.current) return;
      pressionadoRef.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);

      // `pointercancel` (chamada chegando, gesto do sistema) sempre descarta:
      // ninguém decidiu enviar.
      const desfecho = cancelado
        ? 'descartar-cancelado'
        : aoSoltar(gestoRef.current, segundosRef.current);

      if (desfecho === 'continuar') {
        setFase('travada');
        setGesto('segurando');
        setProgresso(0);
        return;
      }
      if (desfecho === 'enviar') {
        encerra(false);
        return;
      }
      if (desfecho === 'descartar-curto') {
        encerra(true);
        setImpedimento({
          resumo: 'muito curto',
          saida: 'segure o botão enquanto fala',
          definitivo: false,
        });
        setFase('impedida');
        return;
      }
      encerra(true);
    },
    [encerra],
  );

  return {
    fase,
    segundos,
    niveis,
    gesto,
    progresso,
    impedimento,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => finaliza(e, false),
      onPointerCancel: (e) => finaliza(e, true),
    },
    enviarTravada: () => encerra(false),
    descartarTravada: () => encerra(true),
    limparImpedimento: () => {
      setImpedimento(null);
      setFase('ociosa');
    },
  };
}
