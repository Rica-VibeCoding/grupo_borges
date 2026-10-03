'use client';

import { useEffect, useRef } from 'react';

import type { Conversa, Evento } from '@/lib/conversa/tipos';

import { esperaSegue } from './espera-do-subagente';

/**
 * A espera pelo subagente (Rica, 02/10): o toque retomou com o turno dele já fechado e o trabalho
 * seguindo fora dele (`retomadaDaTela`, `segundoPlano`). Enquanto vale, o toque não freia; e se o
 * trabalho acaba sem turno novo dele — a frota sossega com o stream parado —, a vez volta ao Rica.
 * Cai assim que o turno dele abre ou a conversa sai da espera (`espera-do-subagente.ts`).
 */
export function useEsperaDoSubagente({
  conversa,
  rodando,
  ocupado,
  despacha,
  fechaTurno,
}: {
  conversa: Conversa;
  rodando: boolean;
  ocupado: boolean;
  despacha: (evento: Evento) => void;
  fechaTurno: () => void;
}) {
  const segundoPlanoRef = useRef(false);
  useEffect(() => {
    if (!segundoPlanoRef.current) return;
    if (!esperaSegue(conversa, rodando)) {
      segundoPlanoRef.current = false;
      return;
    }
    if (conversa.estado !== 'esperandoZe' || ocupado) return;
    segundoPlanoRef.current = false;
    despacha({ tipo: 'zeTerminou' });
    fechaTurno();
  }, [conversa, despacha, fechaTurno, ocupado, rodando]);
  return segundoPlanoRef;
}
