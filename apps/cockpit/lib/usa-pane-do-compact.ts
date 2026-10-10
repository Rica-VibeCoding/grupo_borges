'use client';

import { useEffect } from 'react';

import { fetchAgentCompact } from '@grupo_borges/cockpit-core/api';

import type { EstadoCompact } from './maquina-do-compact.ts';

/** De quanto em quanto a barra pergunta ao servidor se o pane ainda compacta. */
export const PERGUNTA_COMPACT_MS = 4_000;

/**
 * O PANE DIZ SE AINDA COMPACTA. Sem isto a espera só adivinhava (relógio +
 * resumo no feed) e um agente religado no meio do compact deixava a barra
 * presa até o escape. Só pergunta enquanto a barra espera; falha de rede não
 * conclui nada.
 */
export function usaPaneDoCompact(
  agentSlug: string,
  fase: EstadoCompact['fase'],
  reconciliar: (emAndamento: boolean | null) => void,
): void {
  useEffect(() => {
    if (fase !== 'compactando') return;
    const controlador = new AbortController();
    const perguntar = () =>
      fetchAgentCompact(agentSlug, controlador.signal)
        .then((r) => reconciliar(r.em_andamento))
        .catch(() => undefined);
    const timer = setInterval(perguntar, PERGUNTA_COMPACT_MS);
    return () => {
      clearInterval(timer);
      controlador.abort();
    };
  }, [agentSlug, fase, reconciliar]);
}
