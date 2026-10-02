'use client';

import { useEffect, useRef } from 'react';

import type { Estado, Evento } from '@/lib/conversa/tipos';

/**
 * A espera pelo subagente (Rica, 02/10): o toque retomou com o turno dele já fechado e o trabalho
 * seguindo fora dele (`retomadaDaTela`, `segundoPlano`). Enquanto vale, o toque não freia; e se o
 * trabalho acaba sem turno novo dele — a frota sossega com o stream parado —, a vez volta ao Rica.
 * Cai assim que o turno dele abre ou a conversa sai da espera.
 */
export function useEsperaDoSubagente({
  estado,
  rodando,
  ocupado,
  despacha,
  fechaTurno,
}: {
  estado: Estado;
  rodando: boolean;
  ocupado: boolean;
  despacha: (evento: Evento) => void;
  fechaTurno: () => void;
}) {
  const segundoPlanoRef = useRef(false);
  useEffect(() => {
    if (!segundoPlanoRef.current) return;
    // A voz do que ficou por tocar ainda é a mesma espera; qualquer outro estado já é outra vez.
    if (rodando || (estado !== 'esperandoZe' && estado !== 'falando')) {
      segundoPlanoRef.current = false;
      return;
    }
    if (estado !== 'esperandoZe' || ocupado) return;
    segundoPlanoRef.current = false;
    despacha({ tipo: 'zeTerminou' });
    fechaTurno();
  }, [despacha, estado, fechaTurno, ocupado, rodando]);
  return segundoPlanoRef;
}
