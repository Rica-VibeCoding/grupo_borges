'use client';

import { useSyncExternalStore } from 'react';

import { assinaPesquisa, pesquisaEstaAtiva } from './pesquisa-canario.ts';

/** O toggle do `/pesquisa` deste agente, vivo — gaveta e composer leem o mesmo. */
export function usaPesquisaAtiva(agentSlug: string): boolean {
  return useSyncExternalStore(
    assinaPesquisa,
    () => pesquisaEstaAtiva(agentSlug),
    () => false,
  );
}
