/**
 * O estado que a bolinha mostra — derivado do que o composer JÁ sabe.
 *
 * Nada de fonte nova: as duas entradas são as mesmas que decidem o `■` de parar
 * turno (`composer.tsx`), e o motivo de serem essas duas está escrito lá — o
 * `status` da frota cruza sessão e processo e sabe dizer `offline`; o turno vivo
 * é o `isRunning` do stream, republicado pelo feed em `lib/turno-vivo.ts`, e é a
 * fonte RÁPIDA. Uma cobre o que a outra atrasa.
 *
 * `pronto` não sai daqui: ele é uma TRANSIÇÃO (o turno que acabou de terminar),
 * e transição só existe para quem guarda o valor anterior — quem faz isso é o
 * componente, com um timer. Aqui só moram os estados estáveis.
 *
 * Módulo neutro de propósito — sem `'use client'`, para poder ser chamado de
 * Server Component sem virar referência não-chamável.
 */
import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';

export type EstadoBolinha =
  | 'offline'
  | 'parado'
  | 'pensando'
  | 'executando'
  | 'pronto'
  | 'atencao';

export type EntradaDaBolinha = {
  /** `status` do agente em `/api/fleet`; `undefined` = a frota ainda não respondeu. */
  status: AgentStatus | undefined;
  /** `isRunning` do stream, publicado pelo feed. */
  turnoVivo: boolean;
  /** Tem output saindo no fim do feed — ferramenta em voo OU texto crescendo
   *  (`lib/escrita-viva.ts`). É a mesma régua que escolhe entre a linha
   *  "Executando <cmd>" e a "Pensando há 12 s". */
  produzindo: boolean;
};

/** A palavra que a legenda anuncia — o `aria-label` do SVG é estável de
 *  propósito (rótulo que muda em `role="img"` não é lido por leitor de tela). */
export const FALA_DA_BOLINHA: Record<EstadoBolinha, string> = {
  offline: 'desligado',
  parado: 'ocioso',
  pensando: 'pensando',
  executando: 'executando',
  pronto: 'terminou',
  atencao: 'esperando você',
};

export function estadoDaBolinha({
  status,
  turnoVivo,
  produzindo,
}: EntradaDaBolinha): EstadoBolinha {
  if (status === undefined || status === 'offline') return 'offline';
  // Quem chama uma pessoa vence quem está ocupado: é o único estado que precisa
  // de humano, e a bolinha não pode escondê-lo atrás de um turno em voo.
  if (status === 'aguardando') return 'atencao';
  // Executar é um caso PARTICULAR de estar em turno, então vem antes: quem já
  // está rodando ferramenta ou escrevendo não pode ficar com cara de quem
  // ainda pensa — e é aí que o turno passa quase todo o tempo.
  if (produzindo) return 'executando';
  if (turnoVivo || status === 'trabalhando') return 'pensando';
  return 'parado';
}
