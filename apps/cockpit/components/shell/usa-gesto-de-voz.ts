'use client';

/**
 * O gesto do botão de voz: o ponteiro desce, arrasta e solta, e os dois botões da gravação
 * travada. A regra (limiares, o que o soltar decide) mora em `voz.ts`; o hardware, em
 * `usa-gravador.ts`, que passa as peças. Aqui fica só a fiação dos eventos.
 */
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';

import {
  aoEnviarTravada,
  aoSoltar,
  gestoDe,
  progressoDoGesto,
  type FaseVoz,
  type Gesto,
  type Impedimento,
} from './voz';
import type { Gravador } from './usa-gravador';

type Pecas = {
  fase: FaseVoz;
  comeca: () => Promise<void>;
  encerra: (descartar: boolean) => void;
  setFase: Dispatch<SetStateAction<FaseVoz>>;
  setGesto: (gesto: Gesto) => void;
  setProgresso: (progresso: number) => void;
  setImpedimento: (impedimento: Impedimento | null) => void;
  pressionadoRef: RefObject<boolean>;
  travadaRef: RefObject<boolean>;
  origemRef: RefObject<{ x: number; y: number } | null>;
  gestoRef: RefObject<Gesto>;
  segundosRef: RefObject<number>;
};

export function usaGestoDeVoz({
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
}: Pecas): Pick<Gravador, 'handlers' | 'enviarTravada' | 'descartarTravada'> {
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
      // Um gesto anterior pode ter morrido sem passar pelo `solta` — o
      // microfone recusado sai por `setFase('impedida')` e nada mais.
      travadaRef.current = false;
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
        travadaRef.current = true;
        setFase('travada');
        setGesto('segurando');
        setProgresso(0);
        return;
      }
      if (desfecho === 'enviar') {
        encerra(false);
        return;
      }
      encerra(true);
    },
    [encerra],
  );

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => finaliza(e, false),
      onPointerCancel: (e) => finaliza(e, true),
    },
    enviarTravada: () => {
      // Abaixo do piso encerra CALADO. O aviso "muito curto" que morava aqui é
      // metade do pisca que o Rica reprovou: ele acendia em cima da caixa e só
      // apagava no gesto seguinte. Quem tocou em ⏹ um instante depois de abrir
      // já sabe o que fez — e o piso continua impedindo o despacho, que é o
      // trabalho dele.
      encerra(aoEnviarTravada(segundosRef.current) !== 'enviar');
    },
    descartarTravada: () => encerra(true),
  };
}
