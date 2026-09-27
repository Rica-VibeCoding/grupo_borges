'use client';

import { useEffect, useRef } from 'react';

import type { CanarioStreamState } from '@/lib/spike/canario-stream-controller';

import { FOLGA_DO_FIM_MS, maiorIdDasMensagens, passosDoZeDepoisDe, type Voo } from './textos-do-ze';

type AoTurno = {
  abre: () => void;
  texto: (texto: string) => void;
  pedidoEntrou: () => void;
  fecha: () => void;
};

/**
 * O stream do agente lido como turnos do Zé: o replay só posiciona o cursor, e cada lote
 * novo vira passos na ordem (`passosDoZeDepoisDe`). O fim que veio sem fala espera a folga:
 * o texto dele costuma chegar no lote seguinte e entra no mesmo turno — sem ela, a tela ia
 * para "ouvindo" e abria o microfone por ~250 ms logo antes da voz.
 */
export function useTurnoDoZe(stream: Pick<CanarioStreamState, 'messages' | 'isRunning' | 'status'>, ao: AoTurno) {
  const aoRef = useRef(ao);
  aoRef.current = ao;
  const cursorRef = useRef(0);
  const replayConcluidoRef = useRef(false);
  const vooRef = useRef<Voo>(false);
  const folgaRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const maiorId = maiorIdDasMensagens(stream.messages, cursorRef.current);
    if (stream.status !== 'live') {
      cursorRef.current = maiorId;
      return;
    }
    if (!replayConcluidoRef.current) {
      replayConcluidoRef.current = true;
      cursorRef.current = maiorId;
      vooRef.current = stream.isRunning;
      return;
    }
    const passos = passosDoZeDepoisDe(stream.messages, cursorRef.current, vooRef.current, stream.isRunning);
    cursorRef.current = maiorId;
    vooRef.current = passos[passos.length - 1]?.tipo === 'fechaNaFolga' ? 'acabando' : stream.isRunning;
    for (const passo of passos) {
      if (passo.tipo === 'fechaNaFolga') {
        // Já esperando: o prazo é o do primeiro fim, lote vazio não o empurra.
        folgaRef.current ??= window.setTimeout(() => {
          folgaRef.current = undefined;
          vooRef.current = false;
          aoRef.current.fecha();
        }, FOLGA_DO_FIM_MS);
        continue;
      }
      // Qualquer outro passo é o turno que continuou (o texto que faltava) ou o fecha de agora.
      window.clearTimeout(folgaRef.current);
      folgaRef.current = undefined;
      if (passo.tipo === 'abre') aoRef.current.abre();
      if (passo.tipo === 'texto') aoRef.current.texto(passo.texto);
      if (passo.tipo === 'pedidoEntrou') aoRef.current.pedidoEntrou();
      if (passo.tipo === 'fecha') aoRef.current.fecha();
    }
  }, [stream.isRunning, stream.messages, stream.status]);

  useEffect(
    () => () => {
      window.clearTimeout(folgaRef.current);
      folgaRef.current = undefined;
    },
    [],
  );
}
