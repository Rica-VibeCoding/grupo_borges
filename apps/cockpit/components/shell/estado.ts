/**
 * O vocabulário de estado do agente — cor, palavra e prioridade, num lugar só.
 *
 * Mora fora dos componentes porque é consumido pela tropa E pelo cabeçalho do
 * chat. Duas cópias da mesma tabela é como "aguardando" vira âmbar numa tela e
 * amarelo na outra.
 *
 * A palavra ao lado da cor não é redundância: cor nunca é portadora única de
 * significado (contrato §3). Vale para daltonismo e vale para o Rica olhando o
 * celular de relance no sol.
 *
 * Módulo neutro de propósito — sem `'use client'`. Função importada de módulo
 * cliente vira referência não-chamável dentro de Server Component, e isso passa
 * no tsc e no build: só quebra ao renderizar.
 */
import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';

export type DescricaoEstado = {
  rotulo: string;
  cor: string;
  /** Quem precisa de humano sobe. O único estado quente é o único que chama o
   *  Rica — se o âmbar é o sinal, ele não pode nascer no meio de uma lista. */
  ordem: number;
};

export const ESTADO: Record<AgentStatus, DescricaoEstado> = {
  aguardando: { rotulo: 'aguarda você', cor: 'var(--ck-state-attention)', ordem: 0 },
  trabalhando: { rotulo: 'trabalhando', cor: 'var(--ck-state-running)', ordem: 1 },
  ocioso: { rotulo: 'ocioso', cor: 'var(--ck-text-secondary)', ordem: 2 },
  offline: { rotulo: 'offline', cor: 'var(--ck-text-tertiary)', ordem: 3 },
};

export function estadoDe(status: AgentStatus | null | undefined): DescricaoEstado {
  return (status && ESTADO[status]) || ESTADO.offline;
}
