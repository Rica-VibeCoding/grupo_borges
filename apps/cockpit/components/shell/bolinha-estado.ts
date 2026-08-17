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

/** `falando` existe no vocabulário visual mas ainda não tem produtor: exigiria o
 *  feed publicar "o texto do assistente está crescendo agora", que hoje só vive
 *  dentro dele (`cursorNoFim`). Fica declarado para o dia em que esse sinal sair
 *  do feed — o CSS já sabe desenhá-lo. */
export type EstadoBolinha = 'offline' | 'parado' | 'pensando' | 'falando' | 'pronto' | 'atencao';

export type EntradaDaBolinha = {
  /** `status` do agente em `/api/fleet`; `undefined` = a frota ainda não respondeu. */
  status: AgentStatus | undefined;
  /** `isRunning` do stream, publicado pelo feed. */
  turnoVivo: boolean;
};

/** A palavra que a legenda anuncia — o `aria-label` do SVG é estável de
 *  propósito (rótulo que muda em `role="img"` não é lido por leitor de tela). */
export const FALA_DA_BOLINHA: Record<EstadoBolinha, string> = {
  offline: 'desligado',
  parado: 'ocioso',
  pensando: 'pensando',
  falando: 'respondendo',
  pronto: 'terminou',
  atencao: 'esperando você',
};

export function estadoDaBolinha({ status, turnoVivo }: EntradaDaBolinha): EstadoBolinha {
  if (status === undefined || status === 'offline') return 'offline';
  // Quem chama uma pessoa vence quem está ocupado: é o único estado que precisa
  // de humano, e a bolinha não pode escondê-lo atrás de um turno em voo.
  if (status === 'aguardando') return 'atencao';
  if (turnoVivo || status === 'trabalhando') return 'pensando';
  return 'parado';
}
